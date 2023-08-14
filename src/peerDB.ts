import http from 'http';
import { decode } from 'bencodec';
import { EventEmitter } from 'events';
import { Settings } from './config';
import { logger } from './logger';
import { log } from 'console';
import axios from 'axios';

interface TrackerResponse {
    interval: number;
    peers: Buffer;
    peers6?: Buffer;
}

export class Peer {
    ip: string;
    port: number;
    id?: string;

    constructor(ip: string, port: number, id?: string) {
        this.ip = ip;
        this.port = port;
        this.id = id;
    }

    equals(other: Peer): boolean {
        if (this.ip === other.ip && this.port === other.port) return true;
        else if (this.id && other.id && this.id == other.id) return true;
        else return false;
    }

    address(): string { return `${this.ip}:${this.port}`}

    toString() {
        return `${this.ip}:${this.port}(ID#${this.id})`;
    }
}

export class PeerDB extends EventEmitter {
    private peersVerified: Peer[];
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
        for (const candidate of this.peersVerified.concat(this.peersUnverified, this.peersBlacklisted)) {
            if ( candidate.equals(peer) ) return true;
        }
        return false;
    }

    setPeersBlacklisted(peers: Peer[]): void {
        logger.info(`PeerDB: setPeersBlacklisted`);
        // Add the peers to the blacklist
        peers = peers.filter(peer => !this.peersBlacklisted.some(blacklistedPeer => blacklistedPeer.equals(peer)));
        this.peersBlacklisted.push(...peers);

        // Remove the peers from the verified and unverified lists
        this.peersVerified = this.peersVerified.filter(verifiedPeer => !peers.some(peer => peer.equals(verifiedPeer)));
        this.peersUnverified = this.peersUnverified.filter(unverifiedPeer => !peers.some(peer => peer.equals(unverifiedPeer)));
    }

    setPeersVerified(peers: Peer[]): void {
        logger.info(`PeerDB: setting peer(s) ${peers.join(", ")} verified.`);
        // Check blacklisted peers
        peers = peers.filter(peer => !this.peersBlacklisted.some(blacklistedPeer => blacklistedPeer.equals(peer)));

        // Add the peers to the verified list
        this.peersVerified.push(...peers);

        // Remove the peers from the unverified list
        this.peersUnverified = this.peersUnverified.filter(unverifiedPeer => !peers.some(peer => peer.equals(unverifiedPeer)));
    }

    setPeersUnverified(peers: Peer[]): void {
        logger.info(`PeerDB: setting peer(s) ${peers.join(", ")} unverified.`);
        // Check blacklisted peers
        peers = peers.filter(peer => !this.peersBlacklisted.some(blacklistedPeer => blacklistedPeer.equals(peer)));

        // Add the peers to the unverified list
        this.peersUnverified.push(...peers);

        // Remove the peers from the verified list
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
                    logger.error('No peers field in response');
                    return;
                }

                let peers = PeerDB.parsePeers(decoded.peers, decoded.peers6);
                let knownPeers: Peer[] = [...this.peersVerified, ...this.peersUnverified];

                let newPeers = peers.filter(peer => !knownPeers.some(p => p.ip === peer.ip && p.port === peer.port));
                logger.debug(`Got ${newPeers.length} new peers from trackers: ${newPeers.map(peer => `${peer.ip}:${peer.port}`).join(', ')}`);

                // remove blacklisted peers
                newPeers = newPeers.filter(peer => !this.peersBlacklisted.some(blacklistedPeer => blacklistedPeer.equals(peer)));

                this.peersUnverified.push(...newPeers);
                // emit new peer event for each new peer
                newPeers.forEach(peer => this.emit('newPeer', peer));
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
            throw new Error("All tracker requests failed");
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

