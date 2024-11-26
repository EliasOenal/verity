import { Settings, VerityError } from '../settings';
import { unixtime } from '../helpers/misc';
import { CubeKey } from '../cube/cube.definitions';

import { MessageClass, NetConstants, SupportedTransports } from './networkDefinitions';
import { NetworkPeer } from './networkPeer';
import { NetworkStats } from './networkPeerIf';
import { NetworkPeerIf } from './networkPeerIf';
import { NetworkTransport, TransportParamMap } from './transport/networkTransport';
import { TransportConnection } from './transport/transportConnection';
import { createNetworkPeerConnection, createNetworkTransport } from './transport/transportFactory';
import { RequestScheduler } from './cubeRetrieval/requestScheduler';

import { CubeStore } from '../cube/cubeStore';
import { CubeInfo } from '../cube/cubeInfo';

import { Peer } from '../peering/peer';
import { AddressAbstraction } from '../peering/addressing';
import { PeerDB } from '../peering/peerDB';

import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

import * as cryptolib from 'crypto';
import { NetworkManagerIf, NetworkManagerOptions, SetNetworkManagerDefaults } from './networkManagerIf';
let crypto;
if (isBrowser || isWebWorker) {
    crypto = window.crypto;
} else {
    crypto = cryptolib;
}

/**
 * The NetworkManager is the central coordinating instance responsible for
 * handling incoming and outgoing connections.
 * Note that NetworkManager does not automatically start after construction;
 * please call and await start() before actually using it.
 */
export class NetworkManager extends EventEmitter implements NetworkManagerIf {
    // Components
    transports: Map<SupportedTransports, NetworkTransport> = new Map();
    scheduler: RequestScheduler;

    /** List of currently connected peers to which we initiated the connection */
    // TODO improve encapsulation
    outgoingPeers: NetworkPeerIf[] = [];

    /** List of current remote-initiated peer connections */
    // TODO improve encapsulation
    incomingPeers: NetworkPeerIf[] = [];

    /** Sliding window of recent keys */
    /* The ideal implementation would likely be a circular buffer, with a hash map.
     * The hash map would allow for O(1) lookups to find a key in the window,
     * and the circular buffer would allow for O(1) removal of the oldest key.
     * For now it's just a simple array, as the window size is reasonably small.
     */
    private recentKeysWindow: CubeKey[] = [];

    get onlinePeers(): NetworkPeerIf[] {
        return this.outgoingPeers.concat(this.incomingPeers).filter(
            peer => peer.online);
        // note: this is not efficient as it creates two copies:
        // first in concat, then in filter
    }

    /**
     * Handle the 'cubeAdded' event from CubeStore
     * @param cubeInfo The CubeInfo of the newly added cube
     */
    private handleCubeAdded(cubeInfo: CubeInfo): void {
        this.addRecentKey(cubeInfo.key);
    }
    get onlinePeerCount(): number {
        return this.onlinePeers.length;  // note: this is not efficient
    }

    /**
     * Check if the recent keys window is full
     * @returns True if the window is full, false otherwise
     */
    isRecentKeysWindowFull(): boolean {
        return this.recentKeysWindow.length >= this.options.recentKeyWindowSize;
    }

    /**
     * Get the current number of keys in the recent keys window
     * @returns The number of keys in the window
     */
    getRecentKeysWindowSize(): number {
        return this.recentKeysWindow.length;
    }

    /**
     * Internal flag indicating that connectPeers() is currently running
     * and should therefore not be re-run.
     */
    private isConnectingPeers: boolean = false;

    /** Timer used by connectPeers() to respect connection intervals. */
    private connectPeersInterval: NodeJS.Timeout = undefined;

    /**
     *  True if we have at least one fully connected peer,
     *  i.e. from which we received a correct hello.
     */
    private _online: boolean = false;

    private shutdownPromiseResolve: () => void;
    shutdownPromise: Promise<void> =
        new Promise(resolve => this.shutdownPromiseResolve = resolve);

    /** Local ephemeral peer ID, generated at random each start */
    protected _id?: Buffer = undefined;
    get id(): Buffer { return this._id }
    get idString(): string { return this._id?.toString('hex') }

    /**
     * Create a new NetworkManager.
     * @param port The port to listen on for incoming connections.
     *             If 0, the node will not listen for incoming connections.
     * @param cubeStore The CubeStore to use.
     * @param _peerDB The PeerDB to use.
     * @param announce Whether to announce the node to the network.
     *
     * @remarks
     * The callbacks are called with the peer and the error as arguments.
     *  */
    constructor(
            private _cubeStore: CubeStore,
            private _peerDB: PeerDB,
            readonly options: NetworkManagerOptions = {},
    ) {
        super();
        SetNetworkManagerDefaults(options);

        // set default options
        this.options.announceToTorrentTrackers ??= Settings.ANNOUNCE_TO_TORRENT_TRACKERS,
        this.options.autoConnect ??= Settings.AUTO_CONNECT_PEERS,
        this.options.peerExchange ??= Settings.PEER_EXCHANGE,
        this.options.newPeerInterval ??= Settings.NEW_PEER_INTERVAL,
        this.options.connectRetryInterval ??= Settings.CONNECT_RETRY_INTERVAL,
        this.options.maximumConnections ??= Settings.MAXIMUM_CONNECTIONS,
        this.options.acceptIncomingConnections ??= Settings.ACCEPT_INCOMING_CONNECTIONS,
        this.options.recentKeyWindowSize ??= Settings.RECENT_KEY_WINDOW_SIZE,
        // set default network peer options for them to grab from us
        this.options.peerExchange ??= Settings.PEER_EXCHANGE,
        this.options.networkTimeoutMillis ??= Settings.NETWORK_TIMEOUT,
        this.options.closeOnTimeout ??= Settings.CLOSE_PEER_ON_TIMEOUT,

        // Create components
        this.scheduler = new RequestScheduler(this, options);

        // Create NetworkTransport objects for all requested transport types.
        this.transports = createNetworkTransport(options.transports, options);

        // Set a random peer ID
        // Maybe TODO: try to use the same peer ID for transports that themselves
        // require a peer ID, i.e. libp2p
        this._id = Buffer.from(crypto.getRandomValues(new Uint8Array(NetConstants.PEER_ID_SIZE)));

        // Set up event listener for cubeAdded event
        this._cubeStore.on('cubeAdded', this.handleCubeAdded.bind(this));

        // Add cube key 0 of store to window, so it's not empty. A random key would be better,
        // but we don't have a good way to do this without incurring O(n) cost.
        // This is so Sliding Window Mode can return it to a KeyRequest and in turn
        // Sequential Store Sync Mode can use it as a starting point.
        this._cubeStore.readyPromise.then(() => {
            this._cubeStore.getKeyAtPosition(0)?.then(key => {
                if (key) {
                    this.addRecentKey(key);
                }
            });
        });
    }

    /**
     * Add a new key to the sliding window of recent keys
     * @param key The new key to add
     */
    addRecentKey(key: CubeKey): void {
        // print stack trace if key is undefined
        if (!key) {
            logger.error("NetworkManager.addRecentKey() called with undefined key");
            return;
        }
        if (this.isRecentKeysWindowFull()) {
            this.recentKeysWindow.shift(); // Remove the oldest key
        }
        this.recentKeysWindow.push(key);
    }

    /**
     * Get the current content of the sliding window
     * @returns An array of recent keys
     */
    getRecentKeys(): CubeKey[] {
        return [...this.recentKeysWindow]; // Return a copy to prevent external modifications
    }

    /**
     * Check if a key is in the sliding window
     * @param key The key to check
     * @returns True if the key is in the sliding window, false otherwise
     */
    isKeyRecent(key: CubeKey): boolean {
        return this.recentKeysWindow.some(recentKey => recentKey.equals(key));
    }

    /**
     * Get a specified number of keys succeeding a given input key from the recent keys window.
     * If the key is not found, it returns the requested number of keys from the start of the window.
     * If the requested key is already the last key in the window, return an empty array.
     * @param startKey The key to start from (exclusive).
     * @param count The number of keys to retrieve.
     * @returns An array of keys succeeding the input key or from the start of the window.
     */
    getRecentSucceedingKeys(startKey: CubeKey, count: number): CubeKey[] {
        const startIndex = this.recentKeysWindow.findIndex(key => key.equals(startKey));

        // If the key is not found, start from the beginning
        const beginIndex = (startIndex === -1) ? 0 : startIndex + 1;

        // Return empty array if startIndex is the last index in the window
        if (beginIndex >= this.recentKeysWindow.length) {
            return [];
        }

        // Calculate the number of elements we can retrieve
        const availableCount = Math.min(count, this.recentKeysWindow.length - beginIndex);

        // Return the slice of keys starting from beginIndex
        return this.recentKeysWindow.slice(beginIndex, beginIndex + availableCount);
    }

    get cubeStore(): CubeStore { return this._cubeStore; }
    get peerDB(): PeerDB { return this._peerDB; }

    get online(): boolean { return this._online }

    public async start(): Promise<void> {
        const transportPromises: Promise<void>[] = [];
        await this._cubeStore.readyPromise;
        for (const [type, transport] of this.transports) {
            try {  // start transports
                transportPromises.push(transport.start());
                logger.trace("NetworkManager: requested start of transport " + transport.toString());
            } catch(err) {
                logger.error("NetworkManager: Error requesting a transport to start, will continue without it: " + err?.toString() ?? err);
            }
            transport.on("serverAddress",
                (addr: AddressAbstraction) => this.learnServerAddress(addr));
            for (const server of transport.servers) {
                try {  // subscribe to incoming connections
                    server.on("incomingConnection",
                    (conn: TransportConnection) => this.handleIncomingPeer(conn));
                } catch(err) {
                    logger.error("NetworkManager: Error subscribing to incoming connections: " + err.toString());
                }
            }
        }
        for (const promise of transportPromises) {
            try {
                await promise;
            } catch(err) {
                logger.error("NetworkManager: Error waiting for a transport to start, will continue without it: " + err?.toString() ?? err);
            }
        }

        if (this.options.announceToTorrentTrackers) {
            this._peerDB.startAnnounceTimer();
            this._peerDB.announce();
        }
        this._peerDB.on('newPeer', (newPeer: Peer) => this.autoConnectPeers());
        this.autoConnectPeers();

        this.emit('listening');
        logger.trace("NetworkManager: start() completed, all transports up: " + Array.from(this.transports.values()).map(transport => transport.toString() + "; "));
    }

    private closePeers(): Promise<void> {
        const closedPromises: Promise<void>[] = [];
        this.outgoingPeers.concat(this.incomingPeers).forEach(peer =>
            closedPromises.push(peer.close()));
        return Promise.all(closedPromises) as unknown as Promise<void>;
    }

    /**
    * Will try to connect more peers until we either run out of eligible peers
    * or the connection limit is reached.
    * You never need to call this manually. It will automatically be called when
    * a peer disconnects and when we learn new peers.
    * @param existingRun Be nice and never set this! connectPeers() will re-call
    * itself observing newPeerInterval. These re-calls to self represent
    * a contiguous run, during which this.isConnectingPeers will be set.
    * To distinguish its continuous run from further external calls, automatic
    * re-calls to self will set existingRun, and nobody else should.
    */
    autoConnectPeers(existingRun: boolean = false): void {
        if (!this.options.autoConnect) return;
        // Don't do anything if we're already in the process of connecting new peers
        // or if we're shutting down.
        if (!existingRun && this.isConnectingPeers) {
            // logger.trace("NetworkManager: Somebody called connectPeers(), but this is just not the time.");
            return;
        }
        clearInterval(this.connectPeersInterval);  // will re-set if necessary
        // Only connect a new peer if we're not over the maximum,
        // and if we're not already in the process of connecting new peers
        if (this.outgoingPeers.length + this.incomingPeers.length <
                this.options.maximumConnections) {
            const connectTo: Peer = this._peerDB.selectPeerToConnect(
                this.outgoingPeers.concat(this.incomingPeers));  // this is not efficient -- severity: low (run only while connecting new peers and max once per second)
            // logger.trace(`NetworkManager: autoConnectPeers() running, next up is ${connectTo?.toString()}`);
            if (connectTo){
                // Suitable peer found, start connecting.
                // Return here after a short while to connect further peers
                // if possible and required.
                this.isConnectingPeers = true;
                connectTo.connectionAttempts++;
                connectTo.lastConnectAttempt = unixtime();
                try {
                    this.connect(connectTo);
                    // TODO: We should distinguish between successful and unsuccessful
                    // connection attempts and use a much smaller interval when
                    // unsuccessful. In case of getting spammed with fake nodes,
                    // this currently takes forever till we even try a legit one.
                    this.connectPeersInterval = setInterval(() =>
                        this.autoConnectPeers(true), this.options.newPeerInterval);
                } catch (error) {
                    logger.trace("NetworkManager: Connection attempt failed, retrying in " + this.options.connectRetryInterval/1000 + " seconds");
                    // Note this does not actually catch failed connections,
                    // it just catched failed *connect calls*.
                    // Actual connection failure usually happens much later down
                    // the line (async) and does not get detected here.
                    this.connectPeersInterval = setInterval(() =>
                        this.autoConnectPeers(true), this.options.connectRetryInterval);
                }
            } else {  // no suitable peers found, so stop trying
                // TODO HACKHACK:
                // We currently re-call this method every reconnectInterval
                // as we won't otherwise notice when a reconnect interval has passed.
                // This is not really elegant but it's what we currently do.
                this.connectPeersInterval = setInterval(() =>
                    this.autoConnectPeers(), this.options.reconnectInterval);
                this.isConnectingPeers = false;
            }
        } else {  // we're done, enough peers connected
            this.isConnectingPeers = false;
        }
    }

    /*
     * Manually connect to a specific peer.
     * This should not normally be called manually in regular operation.
     * We usually auto-connect peers thorugh connectPeers() instead.
     * @returns A NetworkPeer object
     */
    connect(peer: Peer): NetworkPeerIf {
        logger.info(`NetworkManager: Connecting to ${peer.toString()}...`);
        // Create a new NetworkPeer and its associated NetworkPeerConnection
        const conn = createNetworkPeerConnection(peer.address, this.transports);

        // TODO HACKHACK: Cloning the object here to promote it from Peer to
        // NetworkPeer. Also doing this if it already is a NetworkPeer.
        // This is ugly. NetworkPeer should encapsulate Peer rather than
        // inheriting from it.
        const networkPeer = new NetworkPeer(
            this,
            conn,
            this.cubeStore,
            { extraAddresses: peer.addresses },
        );
        networkPeer.lastConnectAttempt = peer.lastConnectAttempt;
        networkPeer.lastSuccessfulConnection = peer.lastSuccessfulConnection;
        networkPeer.connectionAttempts = peer.connectionAttempts;
        networkPeer._trustScore = peer._trustScore;

        this.outgoingPeers.push(networkPeer);
        this.emit('newpeer', networkPeer);
        return networkPeer;
    }

    private stopConnectingPeers(): void {
        logger.trace('NetworkManager: stopConnectingPeers()');
        if (this.connectPeersInterval) {
            clearInterval(this.connectPeersInterval);
        }
    }

    public shutdown(): Promise<void> {
        logger.trace('NetworkManager: shutdown()');
        // stop auto-connection
        this.stopConnectingPeers();
        this.options.autoConnect = false;
        // shut down components
        this.scheduler.shutdown();
        this._peerDB.removeListener('newPeer',
            (newPeer: Peer) => this.autoConnectPeers());
        this._peerDB.shutdown();
        const closedPromises: Promise<void>[] = [];
        closedPromises.push(this.closePeers());  // shut down peers
        // shut down transports
        for (const [transportType, transport] of this.transports) {
            // remove listeners first
            transport.removeListener("serverAddress",
            (addr: AddressAbstraction) => this.learnServerAddress(addr));
            for (const server of transport.servers) {
                server.removeListener("incomingConnection",
                    (conn: TransportConnection) => this.handleIncomingPeer(conn));
            }
            // then shut down transport
            logger.trace("NetworkManager: Shutting down server " + transport.toString());
            closedPromises.push(transport.shutdown());
        }
        // promise a complete shutdown when all components have shut down
        const closedPromise: Promise<void> =
            Promise.all(closedPromises) as unknown as Promise<void>;
        closedPromise.then(() => {
            this.emit('shutdown');
            this.shutdownPromiseResolve();
        });
        return closedPromise;
    }

    /** Called by NetworkServer only, should never be called manually. */
    handleIncomingPeer(conn: TransportConnection) {
        if (!this.options.acceptIncomingConnections) {
            logger.trace("NetworkManager: Refused an incoming connection as I was told not to accept any.");
            conn.close();
            // TODO: We should probably let the peer know that we're not
            // currently accepting incoming connections so they don't try again
            // and also stop including us in their peer exchanges.
            return;
        }
        const networkPeer = new NetworkPeer(this, conn, this.cubeStore);
        this.incomingPeers.push(networkPeer);
        this._peerDB.learnPeer(networkPeer);
        this.emit("incomingPeer", networkPeer);  // used for tests only
    }

    learnServerAddress(addr: AddressAbstraction): void {
        // TODO: this is very crude and should be handled more selectively
        for (const peer of this.outgoingPeers.concat(this.incomingPeers)) {
            if (peer.online) peer.sendMyServerAddress();
          }
    }

    /**
     * Event handler that will be called once a NetworkPeer is ready for business
     * @returns True if new peer OK, false if new peer to be disconnected
     */
    handlePeerOnline(peer: NetworkPeerIf): boolean {
        // Verify this peer is valid (just checking if there is an ID for now)
        if (!peer.id) throw new VerityError(`NetworkManager.handlePeerOnline(): Peer ${peer.toString()} cannot be "online" if we don't know its ID. This should never happen.`);

        // Does this peer need to be blocked?
        // Just checking if we're connected to self for now...
        if (peer.id.equals(this.id)) {
            this.closeAndBlockPeer(peer);
            return false;
        }

        // Does this peer need to be closed as duplicate?
        // (Duplicate detection must happen before verification, as verifying
        // a duplicate would mean it replaces the original in the verified map.)
        if (this.closePeerIfDuplicate(peer)) return false;

        // Mark the peer as verified.
        // If this is an outgoing peer, mark it as exchangeable
        // (exchangeable is a strictly higher status than verified).
        // TODO BUGBUG: Using this code, a new incoming NetworkPeer object
        // does not replace a stale outgoing NetworkPeer object in PeerDB
        if (this.outgoingPeers.includes(peer)) {
            this._peerDB.markPeerExchangeable(peer);
        } else {
            this._peerDB.verifyPeer(peer);
        }

        // TODO: If this is a duplicate but outgoing connection, it should still
        // render this peer exchangeable

        // If this is the first successful connection, emit an 'online' event
        if (!this._online) {
            this._online = true;
            this.emit('online');
        }

        // Let out scheduler know -- if it's not already running requests, tell
        // it to do so now.
        this.scheduler.scheduleCubeRequest(0);
        if (!this.options.lightNode) this.scheduler.scheduleKeyRequest(0);

        // Ask peer for node exchange now
        // This is a pure optimisation to enhance startup time; NetworkPeer
        // will periodically ask for it in a short while.
        if (this.options.peerExchange) peer.sendPeerRequest();

        // Relay the online event to our subscribers
        this.emit('peeronline', peer);
        return true;
    }

    /**
     * Callback executed when a NetworkPeer connection is closed.
     */
    handlePeerClosed(peer: NetworkPeerIf): void {
        this.incomingPeers = this.incomingPeers.filter(p => p !== peer);
        this.outgoingPeers = this.outgoingPeers.filter(p => p !== peer);
        logger.trace(`NetworkManager: Connection to peer ${peer.toString()} has been closed. My outgoing peers now are: ${this.outgoingPeers} -- my incoming peers now are: ${this.incomingPeers}`);
        this.emit('peerclosed', peer);
        // If this was our last connection we are now offline
        if (this.incomingPeers.length === 0 && this.outgoingPeers.length === 0) {
            this._online = false;
            this.emit('offline');
        }
        this.autoConnectPeers();  // find a replacement peer
    }

    handlePeerUpdated(peer: NetworkPeerIf): void {
        // TODO: Verify this address is in fact reachable, e.g. by making a test
        // connection.
        this.peerDB.markPeerExchangeable(peer);  // this might be a lie
        this.emit("updatepeer");
    }

    /** Disconnect and blocklist this peer */
    closeAndBlockPeer(peer: NetworkPeerIf): void {
        // disconnect
        peer.close();
        // blocklist
        this._peerDB.blocklistPeer(peer);
        logger.warn(`NetworkManager: Peer ${peer.toString()} has been blocked.`);
        this.emit('blocklist', peer);
    }

    /**
     * Checks if this peer connection is a duplicate, i.e. if were
     */
    private closePeerIfDuplicate(peer: NetworkPeerIf): boolean {
        for (const other of [...this.outgoingPeers, ...this.incomingPeers]) {  // is this efficient or does it copy the array? I don't know, I just watched a YouTube tutorial.
            if (other !== peer) {  // this is required so we don't blocklist this very same connection
                if (other.id && other.id.equals(peer.id)) {
                    this.handleDuplicatePeer(peer, other);
                    return true;
                }
            }
        }
        return false;
    }

    private handleDuplicatePeer(duplicate: NetworkPeerIf, original: Peer): void {
        logger.info(`NetworkManager: Closing connection ${duplicate.addressString} as duplicate to ${original.toString()}.`)
        duplicate.close();  // disconnect the duplicate
        this._peerDB.removeUnverifiedPeer(duplicate);
        original.addAddress(duplicate.address);
        this.emit('duplicatepeer', duplicate);
    }

    private consolidateStats(totalStats: { [key: string]: { count: number, bytes: number } }, peerStats: { [key: string]: { count: number, bytes: number } }) {
        for (const type in peerStats) {
            if (!(type in totalStats)) {
                totalStats[type] = { count: 0, bytes: 0 };
            }
            totalStats[type].count += peerStats[type].count;
            totalStats[type].bytes += peerStats[type].bytes;
        }
    }

    getNetStatistics(): NetworkStats {
        const totalStats: NetworkStats = new NetworkStats();

        for (const peer of this.outgoingPeers.concat(this.incomingPeers)) {
            totalStats.tx.messages += peer.stats.tx.messages;
            totalStats.tx.bytes += peer.stats.tx.bytes;
            totalStats.rx.messages += peer.stats.rx.messages;
            totalStats.rx.bytes += peer.stats.rx.bytes;

            this.consolidateStats(totalStats.tx.messageTypes, peer.stats.tx.messageTypes);
            this.consolidateStats(totalStats.rx.messageTypes, peer.stats.rx.messageTypes);
        }

        return totalStats;
    }

    async prettyPrintStats(): Promise<string> {
        let output = '\nStatistics:\n';
        output += `My (high level) PeerID: ${this.id.toString('hex').toUpperCase()}\n`;
        if (this.transports.size) {
            output += `\nMy network listeners ("servers"):\n`;
            for (const [transportType, transport] of this.transports) {
                for (const server of transport.servers)
                output += server.toLongString() + "\n";  // indent
            }
        } else {
            output += "I am not listening on the network at all.\n\n";
        }

        output += `\nLocal Store\n`;
        output += `Cubes: ${await this.cubeStore.getNumberOfStoredCubes()}\n`;
        output += `Memory: ${await this.cubeStore.getNumberOfStoredCubes() * NetConstants.CUBE_SIZE}\n`;
        let cacheStats = await this.cubeStore.getCacheStatistics;
        let cacheRatio = cacheStats.hits / (cacheStats.hits + cacheStats.misses);
        output += `Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses, ${cacheRatio.toFixed(2)} hit ratio\n`;

        output += `\nNetwork Total\n`;
        const totalStats = this.getNetStatistics();
        output += `Total Packets: TX: ${totalStats.tx.messages}, RX: ${totalStats.rx.messages}\n`;
        output += `Total Bytes: TX: ${totalStats.tx.bytes}, RX: ${totalStats.rx.bytes}\n`;
        output += `Connected Peers: ${this.outgoingPeers.length + this.incomingPeers.length}\n`;
        output += `Verified Peers: ${Array.from(this._peerDB.peersVerified.values()).map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Unverified Peers: ${Array.from(this._peerDB.peersUnverified.values()).map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Blocked Peers: ${Array.from(this._peerDB.peersBlocked.values()).map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += 'Packet Types:\n';

        for (const type in totalStats.tx.messageTypes) {
            const typeEnum = type as unknown as MessageClass;
            output += `TX ${MessageClass[typeEnum]}: ${totalStats.tx.messageTypes[typeEnum]?.count} packets, ${totalStats.tx.messageTypes[typeEnum]?.bytes} bytes\n`;
        }

        for (const type in totalStats.rx.messageTypes) {
            const typeEnum = type as unknown as MessageClass;
            output += `RX ${MessageClass[typeEnum]}: ${totalStats.rx.messageTypes[typeEnum]?.count} packets, ${totalStats.rx.messageTypes[typeEnum]?.bytes} bytes\n`;
        }

        if (this.outgoingPeers.length || this.incomingPeers.length) {
            output += "\nConnected Peers:";
        }
        for (const peer of this.outgoingPeers.concat(this.incomingPeers)) {
            output += '\n';

            const stats = peer.stats;
            output += `${peer.toLongString()}`;
            output += `Packets: TX: ${stats.tx.messages}, RX: ${stats.rx.messages}\n`;
            output += `Bytes: TX: ${stats.tx.bytes}, RX: ${stats.rx.bytes}\n`;
            output += 'Packet Types:\n';

            for (const type in stats.tx.messageTypes) {
                const typeEnum = type as unknown as MessageClass;
                output += `TX ${MessageClass[typeEnum]}: ${stats.tx.messageTypes[typeEnum]?.count} packets, ${stats.tx.messageTypes[typeEnum]?.bytes} bytes\n`;
            }

            for (const type in stats.rx.messageTypes) {
                const typeEnum = type as unknown as MessageClass;
                output += `RX ${MessageClass[typeEnum]}: ${stats.rx.messageTypes[typeEnum]?.count} packets, ${stats.rx.messageTypes[typeEnum]?.bytes} bytes\n`;
            }
        }
        return output;
    }
}
