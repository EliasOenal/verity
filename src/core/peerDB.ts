import { decode } from 'bencodec';
import { EventEmitter } from 'events';
import { Settings } from './config';
import { logger } from './logger';
import { log } from 'console';

import axios from 'axios';
import { Buffer } from 'buffer';

// Maybe TODO: Move tracker handling out of PeerDB, maybe into a new TorrentTrackerClient?

interface TrackerResponse {
    interval: number;
    peers: Buffer;
    peers6?: Buffer;
}

export class Address {
    // There is a point to be made to use IPv6 notation for all IPs
    // however for now this serves the purpose of being able to
    // prevent connecting to the same peer twice
    static convertIPv6toIPv4(ip: string): string {
        if ( ip.startsWith('::ffff:') ) {
            return ip.replace('::ffff:', '');
        }
        return ip;
    }

    constructor(
        public ip: string,  // could be IPv4, IPv6 or even a DNS name
        public port: number
    ) {}

    equals(other: Address): boolean {
        return (this.ip === other.ip && this.port === other.port);
    }
}

export class Peer {
    /** The 16 byte node ID. We usually only learn this upen successfull HELLO exchange. */
    id?: Buffer = undefined;

    /**
     * A peer can have multiple addresses, e.g. an IPv4 one, an IPv6 one
     * and one or multiple domain names.
     * Server-capable incoming peers always have at least two addresses:
     * one using the client port from which they connected to us and
     * one using their server port.
     */
    addresses: Address[] = [];
    /**
     * We arbitrarily define one address as primary, usually the first one we
     * learn. It's the one we connect to.
     * TODO: On incoming connections, capable nodes should expose their server
     * port. When they do, their server address should be marked as primary.
     * Will not implement this until we switched to WebRTC.
    */
    private primaryAddressIndex: number = undefined;
    /** Shortcut to get the primary address object */
    get address() { return this.addresses[this.primaryAddressIndex]; }
    /** Shortcut to get the primary IP */
    get ip() { return this.addresses[this.primaryAddressIndex].ip; }
    /** Shortcut to get the primary port */
    get port() { return this.addresses[this.primaryAddressIndex].port; }

    constructor(ip: string, port: number, id?: Buffer) {
        this.addresses.push(new Address(ip, port));
        this.id = id;
        this.primaryAddressIndex = 0;
    }

    /** Two peers are equal if they either have the same ID or have a common address. */
    equals(other: Peer): boolean {
        const addressEquals: boolean = this.addresses.some(myaddress =>
            other.addresses.some(othersaddress => myaddress.equals(othersaddress)));
        if (addressEquals) return true;
        else if (this.id && other.id && this.id.equals(other.id)) return true;
        else return false;
    }

    addAddress(address: Address);
    addAddress(ip: string, port: number);
    /** Leans a new address for this peer, if it's actually a new one. */
    addAddress(address: Address | string, port?: number) {
        if ( !(address instanceof Address) ) {
            address = new Address(address, port);
        }
        // @ts-ignore Somehow Typescript doesn't realize address is now guarantueed to be instanceof Address
        if (!this.addresses.some(existingaddr => address.equals(existingaddr))) {
            this.addresses.push(address);
        }
    }

    /** Shortcut to get the primary address string */
    get addressString(): string { return `${this.ip}:${this.port}`}

    toString() {
        return `${this.ip}:${this.port}(ID#${this.id?.toString('hex')})`;
    }
}

export class PeerDB extends EventEmitter {
    /** A peer is verified if we have received a HELLO and learned their ID */
    private peersVerified: Peer[];  // these should probably all be Sets
    private peersUnverified: Peer[];
    private peersBlacklisted: Peer[];
    private ourPort: number;
    private announceTimer?: NodeJS.Timeout;
    private static trackerUrls: string[] = ['http://tracker.opentrackr.org:1337/announce',
        'http://tracker.openbittorrent.com:80/announce',
        'http://tracker2.dler.org/announce',
        'http://open.acgtracker.com:1096/announce',];
    private static infoHash: string = '\x4d\x69\x6e\x69\x73\x74\x72\x79\x20\x6f\x66\x20\x54\x72\x75\x74\x68\x00\x00\x00';

    constructor(ourPort: number = 1984) {
        super();
        this.peersVerified = [];
        this.peersUnverified = [];
        this.peersBlacklisted = [];
        this.ourPort = ourPort;
    }

    public shutdown(): void {
        this.stopAnnounceTimer();
        this.removeAllListeners();
    }

    getPeersVerified(): Peer[] {
        return this.peersVerified;
    }

    getPeersUnverified(): Peer[] {
        return this.peersUnverified;
    }

    getPeersBlacklisted(): Peer[] {
        return this.peersBlacklisted;
    }

    isPeerKnown(peer): boolean {
        const knownPeers = this.peersUnverified.concat(this.peersVerified).concat(this.peersBlacklisted);
        return knownPeers.some(knownPeer => knownPeer.equals(peer));
    }

    /**
     * Returns a random verified or unverified peer.
     * If exclude is specified, no peer equal to one of the exclude list will
     * be eligible.
     * This is primarily used by NetworkManager when selecting a peer to connect to.
     */
    getRandomPeer(exclude: Peer[] = []) {
        const eligible: Peer[] = this.peersVerified.concat(this.peersUnverified).
            filter((candidate: Peer) =>
                exclude.every((tobeExcluded: Peer) =>
                    !candidate.equals(tobeExcluded)));
        if (eligible.length) {
            const rnd = Math.floor(Math.random() * eligible.length);
            return eligible[rnd];
        } else {
            return undefined;  // no eligible peers available
        }
    }

    learnPeer(peer: Peer) {
        // Do nothing if we know this peer already
        const knownPeers = this.peersUnverified.concat(this.peersVerified).concat(this.peersBlacklisted);
        if (knownPeers.some(knownPeer => knownPeer.equals(peer))) return;
        // Otherwise, add it to the list of unverified peers and let our listeners know
        this.peersUnverified.push(peer);
        this.emit('newPeer', peer)
    }

    setPeersBlacklisted(peers: Peer[]): void;
    setPeersBlacklisted(peers: Peer): void;
    setPeersBlacklisted(peers: Peer[] | Peer): void {
        if ( !(peers instanceof Array) ) peers = [peers];
        logger.info('PeerDB: Blacklisting peers ' + peers + '; my peers are: ' + [...this.peersVerified, ...this.peersUnverified]);
        // Add the peers to the blacklist
        peers = peers.filter(peer => !this.peersBlacklisted.some(blacklistedPeer => blacklistedPeer.equals(peer)));
        this.peersBlacklisted.push(...peers);

        // Remove the peers from the verified and unverified lists
        // @ts-ignore Typescript seems to have forgotten that peers is now guaranteed to be an Array
        this.peersVerified = this.peersVerified.filter(verifiedPeer => !peers.some(peer => peer.equals(verifiedPeer)));
        // @ts-ignore Typescript seems to have forgotten that peers is now guaranteed to be an Array
        this.peersUnverified = this.peersUnverified.filter(unverifiedPeer => !peers.some(peer => peer.equals(unverifiedPeer)));
    }

    setPeersVerified(peers: Peer[]): void;
    setPeersVerified(peers: Peer): void;
    setPeersVerified(peers: Peer[] | Peer): void {
        if ( !(peers instanceof Array) ) peers = [peers];
        logger.info(`PeerDB: setting peer(s) ${peers.join(", ")} verified.`);
        // Check blacklisted peers
        peers = peers.filter(peer => !this.peersBlacklisted.some(blacklistedPeer => blacklistedPeer.equals(peer)));

        // Add the peers to the verified list
        this.peersVerified.push(...peers);

        // Remove the peers from the unverified list
        // @ts-ignore Typescript seems to have forgotten that peers is now guaranteed to be an Array
        this.peersUnverified = this.peersUnverified.filter(unverifiedPeer => !peers.some(peer => peer.equals(unverifiedPeer)));
    }

    setPeersUnverified(peers: Peer[]): void;
    setPeersUnverified(peers: Peer): void;
    setPeersUnverified(peers: Peer[] | Peer): void {
        if ( !(peers instanceof Array) ) peers = [peers];
        logger.info(`PeerDB: setting peer(s) ${peers.join(", ")} unverified.`);
        // Check blacklisted peers
        peers = peers.filter(peer => !this.peersBlacklisted.some(blacklistedPeer => blacklistedPeer.equals(peer)));

        // Add the peers to the unverified list
        this.peersUnverified.push(...peers);

        // Remove the peers from the verified list
        // @ts-ignore Typescript seems to have forgotten that peers is now guaranteed to be an Array
        this.peersVerified = this.peersVerified.filter(verifiedPeer => !peers.some(peer => peer.equals(verifiedPeer)));
    }

    removeUnverifiedPeer(peer: Peer): void {
        // Remove the peer from the unverified list
        this.peersUnverified = this.peersUnverified.filter(p => !p.equals(peer));
    }

    startAnnounceTimer(): void {
        // If the timer is already running, clear it first
        if (this.announceTimer) {
            clearInterval(this.announceTimer);
        }

        // Start the timer
        this.announceTimer = setInterval(async () => {
            this.announce();
        }, Settings.ANNOUNCEMENT_INTERVAL);
    }

    stopAnnounceTimer(): void {
        if (this.announceTimer) {
            clearInterval(this.announceTimer);
            this.announceTimer = undefined;
        }
    }

    /**
    * Send an announce request to multiple trackers concurrently.
    */
    async announce(testTrackers: string[] | undefined = undefined): Promise<void> {
        logger.trace("PeerDB: announcing we're alive");

        if (testTrackers !== undefined) {
            PeerDB.trackerUrls = testTrackers;
        }

        const tasks = PeerDB.trackerUrls.map(async (trackerUrl) => {
            const params = new URLSearchParams({
                info_hash: String(PeerDB.infoHash),
                port: String(this.ourPort),
            });

            logger.trace(`PeerDB: sending announce request to ${trackerUrl}?${params}`);

            try {
                const res = await axios.get(trackerUrl + '?' + params, { timeout: 5000, responseType: 'arraybuffer' });
                const decoded = decode(res.data) as TrackerResponse;
                logger.trace(`PeerDB: received announce response from ${trackerUrl}: ${JSON.stringify(decoded)}`);

                if (!decoded.peers) {
                    logger.error('PeerDB: No peers field in tracker response');
                    return;
                }

                const peers: Peer[] = PeerDB.parsePeers(decoded.peers, decoded.peers6);
                logger.debug(`PeerDB: Got ${peers.length} peers from trackers: ${peers.map(peer => `${peer.ip}:${peer.port}`).join(', ')}`);
                for (const peer of peers) this.learnPeer(peer);  // add peers
            } catch (err) {
                logger.warn(`Error occurred while announcing to ${trackerUrl}: ${err}`);
                throw err;  // Re-throw the error
            }
        });
        // Wait for all requests to finish
        const results = await Promise.allSettled(tasks);

        // Check if all promises were rejected
        const allRejected = results.every(result => result.status === 'rejected');

        if (allRejected) {
            logger.warn("All tracker requests failed");
            return;
        }
    }


    /**
     * Parse the peers from the tracker response.
     * @param {Buffer} peers - The peers in IPv4 format.
     * @param {Buffer} peers6 - The peers in IPv6 format.
     * @returns {Array<Peer>} - The parsed list of peers.
     */
    static parsePeers(peers: Buffer, peers6?: Buffer): Peer[] {
        const peerList: Peer[] = [];

        for (let i = 0; i < peers.length; i += 6) {
            const ip = Array.from(peers.slice(i, i + 4)).join('.');
            const port = peers.readUInt16BE(i + 4);
            peerList.push(new Peer(ip, port));
        }

        if (peers6) {
            for (let i = 0; i < peers6.length; i += 18) {
                const ip = Array.from(peers6.slice(i, i + 16)).map(b => b.toString(16)).join(':');
                const port = peers6.readUInt16BE(i + 16);
                peerList.push(new Peer(ip, port));
            }
        }

        return peerList;
    }


}

