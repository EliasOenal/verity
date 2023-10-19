import { AddressError, SupportedTransports } from './networkDefinitions';
import { fibonacci } from './helpers';
import { Settings, VerityError } from './settings';

import { EventEmitter } from 'events';
import { logger } from './logger';

import axios from 'axios';
import { decode } from 'bencodec';
import { Buffer } from 'buffer';
import { Multiaddr, multiaddr } from '@multiformats/multiaddr'

// Maybe TODO: Move tracker handling out of PeerDB, maybe into a new TorrentTrackerClient?

interface TrackerResponse {
    interval: number;
    peers: Buffer;
    peers6?: Buffer;
}

export class AddressAbstraction {
    public addr: WebSocketAddress | Multiaddr;
    public type: SupportedTransports;

    static CreateAddress(address: string, type?: SupportedTransports): AddressAbstraction {
        if (!address?.length) return undefined;
        if (!type) {
            // guess type
            if (address[0] == '/') type = SupportedTransports.libp2p;
            else type = SupportedTransports.ws;
        }
        if (!address.length) return undefined;
        if (type == SupportedTransports.ws) {
            const [peerIp, peerPort] = address.split(':');
            if (!peerIp || !peerPort) return undefined;  // ignore invalid
            return new AddressAbstraction(new WebSocketAddress(peerIp, parseInt(peerPort)));
        } else if (type == SupportedTransports.libp2p) {
            return new AddressAbstraction(multiaddr(address));
        }
        else { // invalid
            return undefined;
        }
    }

    constructor(
        addr: WebSocketAddress | Multiaddr | AddressAbstraction | string,
        typeHint?: SupportedTransports
    ) {
        if (!addr) {
            throw new AddressError("AddressAbstraction.constructor: Cannot construct abstraction around falsy address: " + addr);
        } else if (addr instanceof AddressAbstraction) {
            this.type = addr.type;
            this.addr = addr.addr;
        } else if (typeof addr === 'string' || addr instanceof String) {
            this.addr = AddressAbstraction.CreateAddress(addr as string, typeHint).addr;
        } else if (addr instanceof WebSocketAddress) {
            this.addr = addr;
            this.type = SupportedTransports.ws;
        } else if ('getPeerId' in addr) {  // "addr typeof Multiaddr"
            this.addr = addr;
            this.type = SupportedTransports.libp2p;
        } else {
            throw new AddressError("AddressAbstraction.constructor: Cannot construct abstraction around unknown address type: " + addr);
        }
        if (!this.addr) {
            throw new AddressError(
                "AddressAbstraction.constructor: Cannot construct abstraction around invalid address " + addr);
        }
    }

    equals(other: AddressAbstraction) {
        if (this.addr.constructor.name != other.addr.constructor.name ) {
            return false;  // not of same type
        }
        // @ts-ignore It's fine... both sides are either WebSocketAddress or Multiaddr, and they compare well with each other
        else return this.addr.equals(other.addr);
    }

    get ip(): string {
        try {
            if (this.addr instanceof WebSocketAddress) return this.addr.ip;
            else return this.addr.nodeAddress().address;
        } catch(error) {
            logger.error("AddressAbstraction.ip: Error getting address: " + error);
            return undefined;
        }
    }

    get port(): number {
        try {
            if (this.addr instanceof WebSocketAddress) return this.addr.port;
            else return this.addr.nodeAddress().port;
        } catch(error) {
            logger.error("AddressAbstraction.port: Error getting address: " + error);
            return undefined;
        }
    }

    toString(): string {
        try {
            return this.addr.toString();
        } catch(error) {
            logger.error("AddressAbstraction.toString(): Error printing address: " + error);
            return undefined;
        }
    }
}

/**
 * Address notation used for native/legacy WebSocket connections,
 * in contrast to libp2p connections and their multiaddrs.
 */
// TODO: get rid of this crap and just use Multiaddr
export class WebSocketAddress {
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

    equals(other: WebSocketAddress): boolean {
        return (this.ip === other.ip && this.port === other.port);
    }

    toString(wsPrefix: boolean = false): string {
        let str = "";
        if (wsPrefix) str += "ws://";
        str += this.ip + ":" + this.port;
        return str;
    }
}

export class Peer {
    /** The 16 byte node ID. We usually only learn this upon successfull HELLO exchange. */
    protected _id?: Buffer = undefined;
    get id(): Buffer { return this._id }
    get idString(): string { return this._id?.toString('hex') }

    /**
     * A peer can have multiple addresses, e.g. an IPv4 one, an IPv6 one
     * and one or multiple domain names.
     * Server-capable incoming peers always have at least two addresses:
     * one using the client port from which they connected to us and
     * one using their server port.
     */
    addresses: Array<AddressAbstraction> = [];
    /**
     * We arbitrarily define one address as primary, usually the first one we
     * learn. It's the one we connect to.
     * TODO: On incoming connections, capable nodes should expose their server
     * port. When they do, their server address should be marked as primary.
     * Will not implement this until we switch to WebRTC.
    */
    protected _primaryAddressIndex: number = undefined;
    get primaryAddressIndex(): number { return this._primaryAddressIndex }
    /** Shortcut to get the primary address object */
    get address() { return this.addresses[this._primaryAddressIndex]; }
    /** Shortcut to get the primary IP */
    get ip() { return this.addresses[this._primaryAddressIndex].ip; }
    /** Shortcut to get the primary port */
    get port() { return this.addresses[this._primaryAddressIndex].port; }

    /**
     * Unix timestamp showing when we last tried to initiate a connection to
     * this peer.
     * This is required to honor Settings.RECONNECT_INTERVAL.
     */
    lastConnectAttempt: number = 0;
    /**
     * Number of (unsuccessful) connection attempts.
     * Gets reset to 0 on successful connection.
     */
    connectionAttempts: number = 0;

    constructor(
            address: WebSocketAddress | Multiaddr | AddressAbstraction | AddressAbstraction[] | string,
            id?: Buffer) {
        if (address instanceof Array) this.addresses = address;
        else this.addresses = [new AddressAbstraction(address)];
        this._id = id;
        this._primaryAddressIndex = 0;
    }

    /** Two peers are equal if they either have the same ID or have a common address. */
    equals(other: Peer): boolean {
        const addressEquals: boolean = this.addresses.some(myaddress =>
            other.addresses.some(othersaddress => myaddress.equals(othersaddress)));
        if (addressEquals) return true;
        else if (this._id && other._id && this._id.equals(other._id)) return true;
        else return false;
    }

    /**
     * Leans a new address for this peer, if it's actually a new one.
     * @param [makePrimary=false] Mark the specified address as this node's new
     *   primary address (even if we knew it already).
     * @returns Whether the address was added, which is equivalent to whether it was new
     */
    addAddress(
            address: WebSocketAddress | Multiaddr | AddressAbstraction,
            makePrimary: boolean = false) {
        const abstracted = new AddressAbstraction(address);
        // is this address actually new?
        let alreadyExists: boolean = false;
        for (let i=0; i<this.addresses.length; i++) {
            if (abstracted.equals(this.addresses[i])) {
                alreadyExists = true;
                if (makePrimary) {
                    logger.trace(`Peer ${this.toString()}: Setting existing address ${this.addresses[i]} primary`);
                    this._primaryAddressIndex = i;
                }
            }
        }
        if (!alreadyExists){
            this.addresses.push(abstracted);
            if (makePrimary) {
                logger.trace(`Peer ${this.toString()}: Setting newly added address ${abstracted} primary`);
                this._primaryAddressIndex = this.addresses.length-1;
            }
        }
        return !alreadyExists;
    }

    /** Shortcut to get the primary address string */
    get addressString(): string { return this.address.toString(); }

    /** Print a string containing all of my addresses */
    get allAddressesString(): string {
        let ret: string = "";
        for (let i=0; i<this.addresses.length; i++) {
            ret += this.addresses[i].toString();
            if (i<this.addresses.length-1) ret += " | ";
        }
        return ret;
    }

    toString() {
        return `${this.addressString} (ID#${this._id?.toString('hex')})`;
    }
    toLongString() {
        let ret: string = "";
        ret += "Peer ID#" + this.idString;
        if (this.addresses.length) {
            ret += ", addresses:\n";
            for (let i=0; i<this.addresses.length; i++) {
                ret += ` ${i}) ${this.addresses[i].toString()}`;
                if (i == this._primaryAddressIndex) ret += " (primary)\n";
                else ret += '\n';
            }
        }
        return ret;
    }
}

// TODO: We should persist known peers locally, at least the verified ones.
/**
 * Stores all of our known peers, non-persistantly (for now).
 * Every peer is either considered unverified, verified, exchangeable or blacklisted
 * (and will be stored in the appropriate array).
 * A peer starts out as unverified and gets verified once we have received a
 * HELLO and learned their ID. It gets promoted to exchangeable if it has a
 * publicly reachable address and we've successfully connected to it.
 * Note only verified peers can get promoted to exchangeable; a reachable peer
 * who never sent us a valid HELLO is still just unverified.
 */
export class PeerDB extends EventEmitter {
    /**
     * Stores peers we have never successfully connected to and therefore don't
     * know the ID of.
     * Uses the peer's address string as key.
     * TODO: Should be pruned regularly and strictly
     */
    private _peersUnverified: Map<string,Peer> = new Map();
    get peersUnverified(): Map<string,Peer> { return this._peersUnverified }

    /**
     * Stores peers we have at least once successfully connected to, but don't
     * know a publicly reachable address of.
     * Uses the peer's ID hex string as key.
     * TODO: Should be pruned after a significant number of connection failures,
     * with the ability of pinning.
     */
    private _peersVerified: Map<string,Peer> = new Map();
    get peersVerified(): Map<string,Peer> { return this._peersVerified }

    /**
     * Store peers we have successfully connected to and know a publicly
     * reachable address of.
     * Uses the peer's ID hex string as key.
     * TODO: Should be pruned after a significant number of connection failures,
     * with the ability of pinning.
     */
    private _peersExchangeable: Map<string,Peer> = new Map();
    get peersExchangeable(): Map<string,Peer> { return this._peersExchangeable }

    /**
     * Stores peers we have deemed unworthy and will not connect to again.
     * Uses the peer's address string as key, as we might blacklist peers without
     * actually knowing their ID.
     * TODO: Blacklist is currently checked on connection attempts.
     * TODO: Should allow for un-blacklisting after some amount of time.
     */
    private _peersBlacklisted: Map<string,Peer> = new Map();
    get peersBlacklisted(): Map<string,Peer> { return this._peersBlacklisted }
    private announceTimer?: NodeJS.Timeout;
    private static trackerUrls: string[] = ['http://tracker.opentrackr.org:1337/announce',
        'http://tracker.openbittorrent.com:80/announce',
        'http://tracker2.dler.org/announce',
        'http://open.acgtracker.com:1096/announce',];
    private static infoHash: string = '\x4d\x69\x6e\x69\x73\x74\x72\x79\x20\x6f\x66\x20\x54\x72\x75\x74\x68\x00\x00\x00';  // wtf is this? :D

    constructor(
            private ourPort: number = 1984  // param always gets supplied by VerityNode
            // TODO refactor: Port should be supplied by NetworkManager by querying
            // one of its WebSocketServers, if any. Currently VerityNode does that instead.
            // Maybe we should allow announcing multiple servers, i.e. multiple ports, too?
    ){
        super();
        this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS + 10);  // one for each peer and a few for ourselves
    }

    public shutdown(): void {
        this.stopAnnounceTimer();
        this.removeAllListeners();
    }

    isPeerKnown(peer: Peer): boolean {
        if (peer.id) {
            if (this.peersVerified.has(peer.idString)) return true;
            if (this.peersExchangeable.has(peer.idString)) return true;
            return false;
        } else {
            for (const address of peer.addresses) {
                if (this.peersUnverified.has(address.toString())) return true;
            }
        }
        return false;  // not found
    }

    /**
     * Returns a random verified or unverified peer.
     * If exclude is specified, no peer equal to one of the exclude list will
     * be eligible.
     * This is primarily used by NetworkManager when selecting a peer to connect to.
     */
    // TODO: Rather than selecting peer purely randomly, we should at least to a
    // certain point prefer verified nodes. Maybe we should even pin our first
    // known good MAXIMUM_CONNECTIONS/2 nodes and always use them first.
    // This seems like a pretty good tradeoff between having stable connection
    // to the network and giving new nodes a chance to join.
    selectPeerToConnect(exclude: Peer[] = []) {
        const now: number = Math.floor(Date.now() / 1000);
        const eligible: Peer[] =
            [...this.peersUnverified.values(), ...this.peersVerified.values(), ...this.peersExchangeable.values()].  // this is not efficient
            filter((candidate: Peer) =>
                candidate.lastConnectAttempt <= now -
                    fibonacci(Math.max(
                        candidate.connectionAttempts, Settings.RECONNECT_MAX_FIBONACCI_FACTOR
                        )) * (Settings.RECONNECT_INTERVAL / 1000) &&
                exclude.every((tobeExcluded: Peer) =>
                    !candidate.equals(tobeExcluded)));
        // logger.trace(`PeerDB: Eligible peers are ${eligible}`)
        if (eligible.length) {
            const rnd = Math.floor(Math.random() * eligible.length);
            return eligible[rnd];
        } else {
            return undefined;  // no eligible peers available
        }
    }

    learnPeer(peer: Peer) {
        // Do nothing if we know this peer already
        if (this.isPeerKnown(peer)) return;
        // Otherwise, add it to the list of unverified peers and let our listeners know
        this.peersUnverified.set(peer.addressString, peer);
        logger.trace(`PeerDB: Learned new peer ${peer.toString()}, emitting newPeer.`)
        this.emit('newPeer', peer)
    }

    blacklistPeer(peer: Peer): void {
        // delete from any lists this peer might be in
        this.removeUnverifiedPeer(peer);
        this.removeVerifiedPeer(peer);
        this.removeExchangeablePeer(peer);
        // blacklist all of this peer object's addresses
        for (const address of peer.addresses) {
            this.peersBlacklisted.set(address.toString(), peer);
            logger.info('PeerDB: Blacklisting peer ' + peer.toString() + ' using address ' + address.toString());
        }
    }

    verifyPeer(peer: Peer): void {
        // Plausibility check:
        // If a peer is already exchangeable, which is a higher status than verified,
        // do nothing.
        if (this.peersExchangeable.has(peer.idString)) return;
        // Remove peer from unverified map.
        // Also, abort if peer is found in blacklist.
        for (const address of peer.addresses) {
            const addrString = address.toString();
            this._peersUnverified.delete(address.toString());
            if (this.peersBlacklisted.has(addrString)) return;
        }
        // Okay, setting peer verified!
        // Note that this silently replaces the currently stored peer object
        // of the stored one has the same peer ID as the supplied one.
        // We actually use this effect as NetworkManager always creates a
        // new NetworkPeer object on creation. On verification, this newly
        // created NetworkPeer also becomes our stored Peer object.
        this.peersVerified.set(peer.idString, peer);
        logger.info(`PeerDB: setting peer ${peer.toString()} verified.`);
        this.emit('verifiedPeer', peer);
    }

    markPeerExchangeable(peer: Peer): void {
        // Remove peer from unverified map.
        // Also, abort if peer is found in blacklist.
        for (const address of peer.addresses) {
            const addrString = address.toString();
            this._peersUnverified.delete(address.toString());
            if (this.peersBlacklisted.has(addrString)) return;
        }
        // Remove from verified list
        this.peersVerified.delete(peer.idString);
        // Add to exchangeable list
        this.peersExchangeable.set(peer.idString, peer);
        logger.info(`PeerDB: setting peer ${peer.toString()} exchangeable.`);
        this.emit('exchangeablePeer', peer);
    }

    removePeer(peer: Peer): void {
        this.removeUnverifiedPeer(peer);
        this.removeVerifiedPeer(peer);
        this.removeExchangeablePeer(peer);
    }
    removeUnverifiedPeer(peer: Peer): void {
        for (const address of peer.addresses) {
            this.peersUnverified.delete(address.toString());
        }
    }
    removeVerifiedPeer(peer: Peer): void {
        this.peersVerified.delete(peer.idString);
    }
    removeExchangeablePeer(peer: Peer): void {
        this.peersExchangeable.delete(peer.idString);
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
            peerList.push(new Peer(new WebSocketAddress(ip, port)));
        }

        if (peers6) {
            for (let i = 0; i < peers6.length; i += 18) {
                const ip = Array.from(peers6.slice(i, i + 16)).map(b => b.toString(16)).join(':');
                const port = peers6.readUInt16BE(i + 16);
                peerList.push(new Peer(new WebSocketAddress(ip, port)));
            }
        }

        return peerList;
    }


}

