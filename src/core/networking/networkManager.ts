import { Settings, VerityError } from '../settings';
import { unixtime } from '../helpers';
import { MessageClass, NetConstants, SupportedTransports } from './networkDefinitions';
import { NetworkTransport, TransportParamMap } from './networkTransport';
import { createNetworkPeerConnection, createNetworkTransport } from './networkFactory';
import { CubeStore } from '../cube/cubeStore';
import { Peer } from '../peering/peer';
import { PeerDB } from '../peering/peerDB';
import { NetworkPeer, NetworkStats } from './networkPeer';

import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

import * as cryptolib from 'crypto';
let crypto;
if (isBrowser || isWebWorker) {
    crypto = window.crypto;
} else {
    crypto = cryptolib;
}

export interface NetworkManagerOptions {
    announceToTorrentTrackers?: boolean;
    lightNode?: boolean;  // TODO: move this once we have a scheduler
    autoConnect?: boolean;
    peerExchange?: boolean;
    publicAddress?: string;  // TODO: move this to new TransportOptions
    useRelaying?: boolean;  // TODO: move this to new TransportOptions
    newPeerInterval?: number;
    connectRetryInterval?: number,
    reconnectInterval?: number,
    maximumConnections?: number,
}

/**
 * Class representing a network manager, responsible for handling incoming and outgoing connections.
 */
export class NetworkManager extends EventEmitter {
    // overridable values from Settings
    newPeerInterval: number;
    connectRetryInterval: number;
    reconnectInterval: number;
    maximumConnections: number;

    // instance behaviour
    readonly announceToTorrentTrackers?: boolean;
    private _lightNode?: boolean;
    public autoConnect: boolean;
    private _peerExchange?: boolean;

    /**  */
    transports: Map<SupportedTransports, NetworkTransport> = new Map();

    /** List of currently connected peers to which we initiated the connection */
    outgoingPeers: NetworkPeer[] = []; // maybe TODO: This should probably be a Set

    /** List of current remote-initiated peer connections */
    incomingPeers: NetworkPeer[] = []; // maybe TODO: This should probably be a Set

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
     * @param lightNode Whether to run the node in light mode.
     *
     * @remarks
     * The callbacks are called with the peer and the error as arguments.
     *  */
    constructor(
            private _cubeStore: CubeStore,
            private _peerDB: PeerDB,
            transports: TransportParamMap = new Map(),
            options: NetworkManagerOptions = {},
) {
        super();
        // set overridable options
        this.newPeerInterval = options?.newPeerInterval ?? Settings.NEW_PEER_INTERVAL;
        this.connectRetryInterval = options?.connectRetryInterval ?? Settings.CONNECT_RETRY_INTERVAL;
        this.reconnectInterval = options?.reconnectInterval ?? Settings.RECONNECT_INTERVAL;
        this.maximumConnections = options?.maximumConnections ?? Settings.MAXIMUM_CONNECTIONS;

        // set instance behavior
        this.announceToTorrentTrackers = options?.announceToTorrentTrackers ?? true;
        this._lightNode = options?.lightNode ?? false;
        this.autoConnect = options?.autoConnect ?? true;
        this._peerExchange = options?.peerExchange ?? true;

        // Create NetworkTransport objects for all requested transport types.
        this.transports = createNetworkTransport(this, transports, options);

        // Set a random peer ID
        // Maybe TODO: try to use the same peer ID for transports that themselves
        // require a peer ID, i.e. libp2p
        this._id = Buffer.from(crypto.getRandomValues(new Uint8Array(NetConstants.PEER_ID_SIZE)));
    }

    get online(): boolean { return this._online }

    get cubeStore(): CubeStore { return this._cubeStore; }
    get lightNode(): boolean { return this._lightNode; }
    get peerExchange(): boolean { return this._peerExchange }

    public get peerDB() { return this._peerDB; }
    public getCubeStore() { return this.cubeStore; }

    public async start(): Promise<void> {
        const transportPromises: Promise<void>[] = [];
        for (const [type, transport] of this.transports) {
            try {
                transportPromises.push(transport.start());
                logger.trace("NetworkManager: requested start of transport " + transport.toString());
            } catch(err) {
                logger.error("NetworkManager: Error requesting a transport to start, will continue without it. Error was: " + err.toString());
            }
        }
        for (const promise of transportPromises) {
            try {
                await promise;
            } catch(err) {
                logger.error("NetworkManager: Error waiting for a transport to start, will continue without it. Error was: " + err.toString());
            }
        }

        if (this.announceToTorrentTrackers) {
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
        if (!this.autoConnect) return;
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
                this.maximumConnections) {
            const connectTo: Peer = this._peerDB.selectPeerToConnect(
                this.outgoingPeers.concat(this.incomingPeers));  // this is not efficient -- severity: low (run only while connecting new peers and max once per second)
            // logger.trace(`NetworkManager: connectPeers() running, next up is ${connectTo?.toString()}`);
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
                        this.autoConnectPeers(true), this.newPeerInterval);
                } catch (error) {
                    logger.trace("NetworkManager: Connection attempt failed, retrying in " + this.connectRetryInterval/1000 + " seconds");
                    // Note this does not actually catch failed connections,
                    // it just catched failed *connect calls*.
                    // Actual connection failure usually happens much later down
                    // the line (async) and does not get detected here.
                    this.connectPeersInterval = setInterval(() =>
                        this.autoConnectPeers(true), this.connectRetryInterval);
                }
            } else {  // no suitable peers found, so stop trying
                // TODO HACKHACK:
                // We currently re-call this method every reconnectInterval
                // as we won't otherwise notice when a reconnect interval has passed.
                // This is not really elegant but it's what we currently do.
                this.connectPeersInterval = setInterval(() =>
                    this.autoConnectPeers(), this.reconnectInterval);
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
    connect(peer: Peer): NetworkPeer {
        logger.info(`NetworkManager: Connecting to ${peer.toString()}...`);
        // Create a new NetworkPeer and its associated NetworkPeerConnection
        const conn = createNetworkPeerConnection(peer.address, this.transports);

        // TODO HACKHACK: Cloning the object here to promote it from Peer to
        // NetworkPeer. Also doing this if it already is a NetworkPeer.
        // This is ugly. NetworkPeer should encapsulate Peer rather than
        // inheriting from it.
        const networkPeer = new NetworkPeer(
            this,
            peer.addresses,
            this.cubeStore,
            this.id,
            conn,
            this.lightNode,
            this.peerExchange);
        networkPeer.lastConnectAttempt = peer.lastConnectAttempt;
        networkPeer.lastSuccessfulConnection = peer.lastSuccessfulConnection;
        networkPeer.connectionAttempts = peer.connectionAttempts;
        networkPeer.trustScore = peer.trustScore;

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
        this.autoConnect = false;
        this._peerDB.shutdown();
        this.stopConnectingPeers();
        const closedPromises: Promise<void>[] = [];
        closedPromises.push(this.closePeers());
        for (const [transportType, transport] of this.transports) {
            logger.trace("NetworkManager: Shutting down server " + transport.toString());
            closedPromises.push(transport.shutdown());
        }
        const closedPromise: Promise<void> =
            Promise.all(closedPromises) as unknown as Promise<void>;
        closedPromise.then(() => this.emit('shutdown'));
        return closedPromise;
    }

    /** Called by NetworkServer only, should never be called manually. */
    handleIncomingPeer(peer: NetworkPeer) {
        this.incomingPeers.push(peer);
        this._peerDB.learnPeer(peer);
        this.emit("incomingPeer", peer);  // used for tests only
    }

    /**
     * Event handler that will be called once a NetworkPeer is ready for business
     * @returns True if new peer OK, false if new peer to be disconnected
     */
    handlePeerOnline(peer: NetworkPeer): boolean {
        // Verify this peer is valid (just checking if there is an ID for now)
        if (!peer.id) throw new VerityError(`NetworkManager.handlePeerOnline(): Peer ${peer.toString()} cannot be "online" if we don't know its ID. This should never happen.`);

        // Does this peer need to be blacklisted?
        // Just checking if we're connected to self for now...
        if (peer.id.equals(this.id)) {
            this.closeAndBlacklistPeer(peer);
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

        // Ask for cube keys and node exchange now
        // This is a pure optimisation to enhance startup time; NetworkPeer
        // will periodically ask for the same stuff in a short while.
        peer.sendKeyRequest();
        if (this.peerExchange) peer.sendNodeRequest();

        // Relay the online event to our subscribers
        this.emit('peeronline', peer);
        return true;
    }

    /**
     * Callback executed when a NetworkPeer connection is closed.
     */
    handlePeerClosed(peer: NetworkPeer) {
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

    handlePeerUpdated(peer: NetworkPeer) {
        // TODO: Verify this address is in fact reachable, e.g. by making a test
        // connection.
        this.peerDB.markPeerExchangeable(peer);  // this might be a lie
        this.emit("updatepeer");
    }

    /** Disconnect and blacklist this peer */
    closeAndBlacklistPeer(peer: NetworkPeer): void {
        // disconnect
        peer.close();
        // blacklist
        this._peerDB.blacklistPeer(peer);
        logger.warn(`NetworkManager: Peer ${peer.toString()} has been blacklisted.`);
        this.emit('blacklist', peer);
    }

    /**
     * Checks if this peer connection is a duplicate, i.e. if were
     */
    private closePeerIfDuplicate(peer: NetworkPeer): boolean {
        for (const other of [...this.outgoingPeers, ...this.incomingPeers]) {  // is this efficient or does it copy the array? I don't know, I just watched a YouTube tutorial.
            if (other !== peer) {  // this is required so we don't blacklist this very same connection
                if (other.id && other.id.equals(peer.id)) {
                    this.handleDuplicatePeer(peer, other);
                    return true;
                }
            }
        }
        return false;
    }

    private handleDuplicatePeer(duplicate: NetworkPeer, original: Peer): void {
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
        const totalStats: NetworkStats = {
            tx: { sentMessages: 0, messageBytes: 0, messageTypes: {} },
            rx: { receivedMessages: 0, messageBytes: 0, messageTypes: {} },
        };

        for (const peer of this.outgoingPeers.concat(this.incomingPeers)) {
            totalStats.tx.sentMessages += peer.stats.tx.sentMessages;
            totalStats.tx.messageBytes += peer.stats.tx.messageBytes;
            totalStats.rx.receivedMessages += peer.stats.rx.receivedMessages;
            totalStats.rx.messageBytes += peer.stats.rx.messageBytes;

            this.consolidateStats(totalStats.tx.messageTypes, peer.stats.tx.messageTypes);
            this.consolidateStats(totalStats.rx.messageTypes, peer.stats.rx.messageTypes);
        }

        return totalStats;
    }

    prettyPrintStats(): string {
        let output = '\Statistics:\n';
        output += `My (high level) PeerID: ${this.id.toString('hex').toUpperCase()}\n`;
        if (this.transports.size) {
            output += `My network listeners ("servers"):\n`;
            for (const [transportType, transport] of this.transports) {
                for (const server of transport.servers)
                output += server.toLongString() + "\n";  // indent
            }
        } else {
            output += "I am not listening on the network at all.\n\n";
        }

        output += `Local Store\n`;
        output += `Cubes: ${this.cubeStore.getNumberOfStoredCubes()}\n`;
        output += `Memory: ${this.cubeStore.getNumberOfStoredCubes() * NetConstants.CUBE_SIZE}\n`;

        output += `\nNetwork Total\n`;
        const totalStats = this.getNetStatistics();
        output += `Total Packets: TX: ${totalStats.tx.sentMessages}, RX: ${totalStats.rx.receivedMessages}\n`;
        output += `Total Bytes: TX: ${totalStats.tx.messageBytes}, RX: ${totalStats.rx.messageBytes}\n`;
        output += `Connected Peers: ${this.outgoingPeers.length + this.incomingPeers.length}\n`;
        output += `Verified Peers: ${Array.from(this._peerDB.peersVerified.values()).map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Unverified Peers: ${Array.from(this._peerDB.peersUnverified.values()).map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Blacklisted Peers: ${Array.from(this._peerDB.peersBlacklisted.values()).map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
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
            output += `Packets: TX: ${stats.tx.sentMessages}, RX: ${stats.rx.receivedMessages}\n`;
            output += `Bytes: TX: ${stats.tx.messageBytes}, RX: ${stats.rx.messageBytes}\n`;
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
