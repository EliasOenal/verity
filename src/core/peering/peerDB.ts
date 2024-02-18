import { AddressError, SupportedTransports } from '../networking/networkDefinitions';
import { fibonacci, unixtime } from '../helpers';
import { Settings, VerityError } from '../settings';

import { WebSocketAddress } from './addressing';
import { Peer } from './peer';
import { logger } from '../logger';

import axios from 'axios';
import { decode } from 'bencodec';
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';

export interface PeerDbOptions {
    ourPort?: number,
    maxListeners?: number,
    badPeerRehabilitationChance?: number,
}

// Maybe TODO: Move tracker handling out of PeerDB, maybe into a new TorrentTrackerClient?
interface TrackerResponse {
    interval: number;
    peers: Buffer;
    peers6?: Buffer;
}

// TODO: We should persist known peers locally, at least the verified ones.
/**
 * Stores all of our known peers, non-persistantly (for now).
 * Every peer is either considered unverified, verified, exchangeable or blocklisted
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
     * Uses the peer's address string as key, as we might blocklist peers without
     * actually knowing their ID.
     * TODO: Blocklist is currently checked on connection attempts.
     * TODO: Should allow for un-blocklisting after some amount of time.
     */
    private _peersBlocklisted: Map<string,Peer> = new Map();
    get peersBlocklisted(): Map<string,Peer> { return this._peersBlocklisted }
    private announceTimer?: NodeJS.Timeout;
    private static trackerUrls: string[] = ['http://tracker.opentrackr.org:1337/announce',
        'http://tracker.openbittorrent.com:80/announce',
        'http://tracker2.dler.org/announce',
        'http://open.acgtracker.com:1096/announce',];
    private static infoHash: string = '\x4d\x69\x6e\x69\x73\x74\x72\x79\x20\x6f\x66\x20\x54\x72\x75\x74\x68\x00\x00\x00';  // wtf is this? :D

    private ourPort: number;  // param always gets supplied by VerityNode
    // TODO refactor: Port should be supplied by NetworkManager by querying
    // one of its WebSocketServers, if any. Currently VerityNode does that instead.
    // Maybe we should allow announcing multiple servers, i.e. multiple ports, too?

    /** @member When selecting a peer to connect to, this is the chance a peer
     *  with bad local trust score does NOT get skipped over
     */
    private badPeerRehabilitationChance;

    constructor(
        options: PeerDbOptions = {},
    ){
        super();
        this.setMaxListeners(options?.maxListeners ?? Settings.MAXIMUM_CONNECTIONS*1000);
        // set options
        this.ourPort = options?.ourPort ?? 1984;
        this.badPeerRehabilitationChance = options?.badPeerRehabilitationChance ?? Settings.BAD_PEER_REHABILITATION_CHANCE;
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

    getPeer(id: Buffer | string): Peer {
        if (id instanceof Buffer) id = id.toString('hex');
        let ret: Peer = undefined;
        ret = this.peersExchangeable.get(id);
        if (ret) return ret;
        ret = this.peersVerified.get(id);
        if (ret) return ret;
        ret = this.peersUnverified.get(id);
        return ret;
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
    // TODO: Currently, peers can easily spam us with so many dead addresses
    // that we'll never find a life one to connect to.
    // To counter that, for each peer store who we learned it from (the source).
    // For all sources, keep a reputation value that increases for each connectable
    // peer and decreases for each dead peer received. When selecting a new peer
    // for a connection attempt, prefer reputable sources.
    // To prevent Sybil nodes into tricking us to to only connect to more and more
    // Sybils, have the source reputation value depend on something hard to fake,
    // e.g. total Cube difficulty received. This is effectively a proof-of-work
    // barrier as a Sybil node will need to invest network bandwidth to transmit
    // valid cubes and will additionally need to invest CPU power to sculpt new
    // valid Cubes when they run out of existing ones.
    // Has the added benefit of incentivising Sybils to actually exchange valid
    // cubes :D
    selectPeerToConnect(exclude: Peer[] = []) {
        // first, find out which peers are even eligible to auto-connect to
        const now: number = unixtime();
        const eligible: Peer[] =
            [...this.peersUnverified.values(), ...this.peersVerified.values(), ...this.peersExchangeable.values()].  // this is not efficient
            filter((candidate: Peer) =>
                candidate.lastConnectAttempt <= now -
                    fibonacci(Math.max(
                        candidate.connectionAttempts, Settings.RECONNECT_MAX_FIBONACCI_FACTOR
                        )) * (Settings.RECONNECT_INTERVAL / 1000) &&
                exclude.every((tobeExcluded: Peer) =>
                    !candidate.equals(tobeExcluded)));
        // now, split them by their reputation
        const goodPeers: Peer[] = [], badPeers: Peer[] = [];
        for (const peer of eligible) {
            if (!peer.isTrusted) badPeers.push(peer);
            else goodPeers.push(peer);
        }
        // logger.trace(`PeerDB: Eligible peers are ${eligible}`)
        // shall we select a good peer or give a bad peer the chance to rehabilitate?
        let peerList: Peer[];
        if (badPeers.length > 0) {  // are there even any bad peers?
            const goodOrBad: number = Math.random();
            if (goodOrBad < this.badPeerRehabilitationChance) peerList = badPeers;
            else peerList = goodPeers;
        } else peerList = goodPeers;
        // now select a random peer
        if (peerList.length) {
            const rnd = Math.floor(Math.random() * peerList.length);
            return peerList[rnd];
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

    blocklistPeer(peer: Peer): void {
        // delete from any lists this peer might be in
        this.removeUnverifiedPeer(peer);
        this.removeVerifiedPeer(peer);
        this.removeExchangeablePeer(peer);
        // blocklist all of this peer's addresses
        for (const address of peer.addresses) {
            this.peersBlocklisted.set(address.toString(), peer);
            logger.info('PeerDB: Blocklisting peer ' + peer.toString() + ' using address ' + address.toString());
        }
    }

    verifyPeer(peer: Peer): void {
        // Remove peer from unverified map.
        for (const address of peer.addresses) {
            const addrString = address.toString();
            this._peersUnverified.delete(address.toString());
            // Abort if peer is found in blocklist.
            if (this.peersBlocklisted.has(addrString)) return;
        }
        // If a peer is already exchangeable, which is a higher status than verified,
        // call markPeerExchangeable instead (this is to ensure we replace any
        // stale Peer objects with fresh ones).
        if (this.peersExchangeable.has(peer.idString)) return this.markPeerExchangeable(peer);
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
        // Also, abort if peer is found in blocklist.
        for (const address of peer.addresses) {
            const addrString = address.toString();
            this._peersUnverified.delete(address.toString());
            if (this.peersBlocklisted.has(addrString)) return;
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

