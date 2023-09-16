import { CubeStore } from './cubeStore';
import { MessageClass, NetConstants } from './networkDefinitions';
import { PeerDB, Peer, Address } from './peerDB';
import { Settings } from './config';
import { NetworkPeer, NetworkStats } from './networkPeer';
import { logger } from './logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { EventEmitter } from 'events';
import WebSocket from 'isomorphic-ws';
import { Buffer } from 'buffer';

if (isBrowser || isWebWorker) {
    // @ts-ignore
    var crypto = window.crypto;
} else {
    // @ts-ignore
    var crypto = require('crypto').webcrypto;
}
/**
 * Class representing a network manager, responsible for handling incoming and outgoing connections.
 */
export class NetworkManager extends EventEmitter {
    server: WebSocket.Server = undefined; // The WebSocket server for incoming connections
    outgoingPeers: NetworkPeer[] = []; // The peers for outgoing connections
    incomingPeers: NetworkPeer[] = []; // The peers for incoming connections
    private isConnectingPeers: boolean = false;
    private isShuttingDown: boolean = false;
    private connectPeersInterval: NodeJS.Timeout = undefined;
    private static WEBSOCKET_HANDSHAKE_TIMEOUT = 2500;
    private online: boolean = false;
    private server_enabled: boolean;
    public readonly peerID: Buffer;

    /**
     * Create a new NetworkManager.
     * @param port The port to listen on for incoming connections.
     *             If 0, the node will not listen for incoming connections.
     * @param cubeStore The CubeStore to use.
     * @param peerDB The PeerDB to use.
     * @param announce Whether to announce the node to the network.
     * @param lightNode Whether to run the node in light mode.
     *
     * @remarks
     * The callbacks are called with the peer and the error as arguments.
     *  */
    constructor(
            private server_port: number,
            private cubeStore: CubeStore,
            private peerDB: PeerDB,
            private announceToTorrentTrackers: boolean = true,
            private lightNode: boolean = false) {
        super();

        this.peerID = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
        if (isNode) {
        if (server_port !== 0) {
                this.server_enabled = true;
            } else {
                this.server_enabled = false;
                logger.info(`NetworkManager: Client mode is enabled. Listening for incoming connections is disabled.`);
            }
        } else {
            this.server_enabled = false;
        }
    }

    public getPeerDB() { return this.peerDB; }
    public getCubeStore() { return this.cubeStore; }

    public start() {
        if (this.server_enabled) {
            this.server = new WebSocket.Server({ port: this.server_port });
            logger.trace('NetworkManager: Server has been started on port ' + this.server_port);

            // Handle incoming connections
            this.server.on('connection', ws => this.handleIncomingPeer(ws));

            this.server.on('listening', () => {
                this.emit('listening');
                logger.debug(`NetworkManager: Server is listening on port ${this.server_port}.`);
            }
            );
        }
        if (this.announceToTorrentTrackers) {
            this.peerDB.startAnnounceTimer();
            this.peerDB.announce();
        }
        this.connectPeers();
        this.peerDB.on('newPeer', (newPeer: Peer) => this.connectPeers());
    }

    private shutdownPeers() {
        this.outgoingPeers.forEach(peer => peer.close());
        this.incomingPeers.forEach(peer => peer.close());
    }

    /**
    * Will try to connect more peers until we either run out of eligible peers
    * or the connection limit is reached.
    * You never need to call this manually. It will automatically be called when
    * a peer disconnects and when we learn new peers.
    * @param existingRun Be nice and never set this! connectPeers() will re-call
    * itself observing Settings.NEW_PEER_INTERVAL. These re-calls to self represent
    * a contiguous run, during which this.isConnectingPeers will be set.
    * To distinguish its continuous run from further external calls, automatic
    * re-calls to self will set existingRun, and nobody else should.
    */
    private connectPeers(existingRun: boolean = false) {
        // Don't do anything if we're already in the process of connecting new peers
        // or if we're shutting down.
        if (this.isShuttingDown || (!existingRun && this.isConnectingPeers)) {
            logger.trace("NetworkManager: Somebody called connectPeers(), but this is just not the time.");
            return;
        }
        clearInterval(this.connectPeersInterval);  // will re-set if necessary
        // Only connect a new peer if we're not over the maximum,
        // and if we're not already in the process of connecting new peers
        if (this.outgoingPeers.length + this.incomingPeers.length <
                Settings.MAXIMUM_CONNECTIONS) {
            const connectTo: Peer = this.peerDB.getRandomPeer(
                this.outgoingPeers.concat(this.incomingPeers));  // I'm almost certain this is not efficient.
            logger.trace(`NetworkManager: connectPeers() running, next up is ${connectTo?.toString()}`);
            if (connectTo){
                // Suitable peer found, start connecting.
                // Return here after a short while to connect further peers
                // if possible and required.
                this.isConnectingPeers = true;
                this.connect(connectTo);
                // TODO: We should distinguish between successful and unsuccessful
                // connection attempts and use a much smaller interval when
                // unsuccessful. In case of getting spammed with fake nodes,
                // this currently takes forever till we even try a legit one.
                this.connectPeersInterval = setInterval(() =>
                    this.connectPeers(true), Settings.NEW_PEER_INTERVAL);
            } else {  // no suitable peers found, so stop trying
                clearInterval(this.connectPeersInterval);
                this.isConnectingPeers = false;
            }
        } else {  // we're done, enough peers connected
            clearInterval(this.connectPeersInterval);
            this.isConnectingPeers = false;
        }
    }

    private stopConnectingPeers(): void {
        logger.trace('NetworkManager: stopConnectingPeers()');
        if (this.connectPeersInterval) {
            clearInterval(this.connectPeersInterval);
        }
    }

    public shutdown() {
        logger.trace('NetworkManager: shutdown()');
        this.isShuttingDown = true;
        this.peerDB.shutdown();
        this.stopConnectingPeers();

        if (this.server) {
            this.server.close((err) => {
                if (err) {
                    logger.error(`NetworkManager: Error while closing server: ${err}`);
                }
                // close all peers after the server has successfully closed
                this.shutdownPeers();
                this.emit('shutdown');
            });
        } else {
            // if there's no server, just close all peers
            this.shutdownPeers();
            this.emit('shutdown');
        }
    }

    getOnline(): boolean {
        return this.online;
    }

    // Helper function to create a Peer and its associated URL
    private createPeer(peer_param: string | Peer): { peer: Peer, peerURL: string } {
        let peer: Peer;
        let peerURL: string;

        if (typeof peer_param === 'string') {
            const url = new URL(peer_param);
            peer = new Peer(url.hostname, Number(url.port));
            peerURL = `ws://${peer.ip}:${peer.port}`;
        } else {
            peer = peer_param;
            peerURL = `ws://${peer.ip}:${peer.port}`;
        }

        return { peer, peerURL };
    }

    /**
     * Event handler for incoming peer connections.
     * As such, it should never be called manually.
     */
    private handleIncomingPeer(ws: WebSocket) {
        logger.debug(`NetworkManager: Incoming connection from ${(ws as any)._socket.remoteAddress}:${(ws as any)._socket.remotePort}`);
        const networkPeer = new NetworkPeer(
            this,
            Address.convertIPv6toIPv4((ws as any)._socket.remoteAddress),
            (ws as any)._socket.remotePort,
            ws, this.cubeStore,
            this.peerID,
            this.lightNode);
        this.incomingPeers.push(networkPeer);
        // TODO HACKHACK: Until we include some way for incoming peers to indicate
        // their server port (if any), we just don't store them to PeerDB.
        // this.peerDB.setPeersUnverified(networkPeer);
    }

    /**
     * Event handler that will be called once a NetworkPeer is ready for business
     */
    handlePeerOnline(peer: NetworkPeer) {
        // Does this peer need to be blacklisted?
        if (this.closePeerIfInvalid(peer)) return;

        // Verify this peer is valid (just checking if there is an ID for now)
        if (!peer.id) return;

        // Mark the peer as verified
        if (this.outgoingPeers.includes(peer)) {
            // TODO HACKHACK:
            // We currently only mark outgoing peers verified to avoid
            // trying to connect to them or peer-exchanging them.
            // We should rework peerDB to properly represent "server-capable"
            // as node attribute.
            this.peerDB.verifyPeer(peer);
        }

        // If this is the first successful connection, emit an 'online' event
        if (!this.online) {
            this.online = true;
            this.emit('online');
        }

        // Ask for cube keys and node exchange now
        // This is a pure optimisation to enhance startup time; NetworkPeer
        // will periodically ask for the same stuff in a short while.
        peer.sendHashRequest();
        peer.sendNodeRequest();

        // Relay the online event to our subscribers
        this.emit('peeronline', peer);
    }

    /**
     * Callback executed when a NetworkPeer connection is closed.
     */
    handlePeerClosed(peer: NetworkPeer) {
        logger.debug(`NetworkManager: Connection to peer ${peer.ip}:${peer.port}, ID ${peer.id?.toString('hex')} has been closed.`);
        this.incomingPeers = this.incomingPeers.filter(p => p !== peer);
        this.outgoingPeers = this.outgoingPeers.filter(p => p !== peer);
        this.emit('peerclosed', peer);
        this.connectPeers();  // find a replacement peer
    }

    /*
     * Connect to a peer
     * @param peer_param - Peer to connect to
     * @returns Promise<NetworkPeer> - Resolves with a NetworkPeer if connection is successful
     */
    public connect(peer_param: string | Peer): NetworkPeer {
        // Create a Peer and its associated URL
        const { peer, peerURL } = this.createPeer(peer_param);

        logger.info(`NetworkManager: Connecting to ${peerURL}...`);

        // Create a WebSocket connection
        let WsOptions: any;
        // set a handshake timeout on NodeJS, not possible in the browser
        if (isNode) {
            WsOptions = { handshakeTimeout: NetworkManager.WEBSOCKET_HANDSHAKE_TIMEOUT };
        } else {
            WsOptions = [];
        }
        const ws = new WebSocket(peerURL, WsOptions);
        const socketClosedController: AbortController = new AbortController();
        const socketClosedSignal: AbortSignal = socketClosedController.signal;

        // Create a new NetworkPeer
        const networkPeer = new NetworkPeer(
            this,
            peer.ip,
            peer.port,
            ws,
            this.cubeStore,
            this.peerID,
            this.lightNode);
        this.outgoingPeers.push(networkPeer);
        this.emit('newpeer', networkPeer);

        // Listen for events on this new network peer
        return networkPeer;
    }

    /**
     * Checks if a peer should be blacklisted or disconnect as duplicate.
     * We currently blacklist peers:
     *  1) If we're connected to ourselves (happens really easily due to peer exchange)
     *  2) Node sending invalid messages
     *     (this case is handled in NetworkPeer rather than here)
     * As a third case that is not technically blacklisting:
     *  3) We note if we somehow connected to two different addresses for the same
     *     node; in this case, we close the duplicate connection and remember
     *     the duplicate address.
     *     (also happens really easily as nodes can, for example, be referred
     *      to by IP address or domain name)
     * @returns Whether the peer has been disconnected and/or blacklisted
     */
    closePeerIfInvalid(peer: NetworkPeer): boolean {
        if (peer.id.equals(this.peerID)) {
            this.closeAndBlacklistPeer(peer);
            return true;
        }
        const duplicate: boolean = this.closePeerIfDuplicate(peer);
        if (duplicate) return true;
        return false;
    }

    /** Disconnect and blacklist this peer */
    closeAndBlacklistPeer(peer: NetworkPeer): void {
        // disconnect
        peer.close();
        // blacklist
        this.peerDB.blacklistPeer(peer);
        logger.warn(`NetworkManager: Peer ${peer.ip}:${peer.port} has been blacklisted.`);
        this.emit('blacklist', peer);
    }

    /**
     * Checks if this peer connection is a duplicate, i.e. if were
     */
    private closePeerIfDuplicate(peer: NetworkPeer): boolean {
        for (const other of [...this.outgoingPeers, ...this.incomingPeers]) {  // is this efficient or does it copy the array? I don't know, I just watched a YouTube tutorial.
            if (!Object.is(other, peer)) {  // this is required so we don't blacklist this very same connection
                if (other.id?.equals(peer.id)) {
                    this.handleDuplicatePeer(peer, other);
                    return true;
                }
            }
        }
        return false;
    }

    private handleDuplicatePeer(duplicate: NetworkPeer, original: Peer): void {
        duplicate.close();  // disconnect the duplicate
        this.peerDB.removeUnverifiedPeer(duplicate);
        original.addAddress(duplicate.address);
        logger.info(`NetworkManager: Closing connection ${duplicate.addressString} as duplicate to ${original.toString()}.`)
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
            tx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
            rx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
        };

        for (const peer of this.outgoingPeers.concat(this.incomingPeers)) {
            totalStats.tx.totalPackets += peer.stats.tx.totalPackets;
            totalStats.tx.totalBytes += peer.stats.tx.totalBytes;
            totalStats.rx.totalPackets += peer.stats.rx.totalPackets;
            totalStats.rx.totalBytes += peer.stats.rx.totalBytes;

            this.consolidateStats(totalStats.tx.packetTypes, peer.stats.tx.packetTypes);
            this.consolidateStats(totalStats.rx.packetTypes, peer.stats.rx.packetTypes);
        }

        return totalStats;
    }

    prettyPrintStats(): string {
        let output = '\Statistics:\n';
        output += `Local PeerID: ${this.peerID.toString('hex').toUpperCase()}\n`;

        output += `\nLocal Store\n`;
        output += `Cubes: ${this.cubeStore.getNumberOfStoredCubes()}\n`;
        output += `Memory: ${this.cubeStore.getNumberOfStoredCubes() * NetConstants.CUBE_SIZE}\n`;

        output += `\nNetwork Total\n`;
        const totalStats = this.getNetStatistics();
        output += `Total Packets: TX: ${totalStats.tx.totalPackets}, RX: ${totalStats.rx.totalPackets}\n`;
        output += `Total Bytes: TX: ${totalStats.tx.totalBytes}, RX: ${totalStats.rx.totalBytes}\n`;
        output += `Connected Peers: ${this.outgoingPeers.length + this.incomingPeers.length}\n`;
        output += `Verified Peers: ${this.peerDB.getPeersVerified().map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Unverified Peers: ${this.peerDB.getPeersUnverified().map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Blacklisted Peers: ${this.peerDB.getPeersBlacklisted().map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += 'Packet Types:\n';

        for (const type in totalStats.tx.packetTypes) {
            const typeEnum = type as unknown as MessageClass;
            output += `TX ${MessageClass[typeEnum]}: ${totalStats.tx.packetTypes[typeEnum]?.count} packets, ${totalStats.tx.packetTypes[typeEnum]?.bytes} bytes\n`;
        }

        for (const type in totalStats.rx.packetTypes) {
            const typeEnum = type as unknown as MessageClass;
            output += `RX ${MessageClass[typeEnum]}: ${totalStats.rx.packetTypes[typeEnum]?.count} packets, ${totalStats.rx.packetTypes[typeEnum]?.bytes} bytes\n`;
        }

        for (const peer of this.outgoingPeers.concat(this.incomingPeers)) {
            output += '\n';

            const stats = peer.stats;
            output += `Peer: ${peer.ip}:${peer.port}\n`;
            output += `Peer ID: ${peer.id?.toString('hex').toUpperCase()}\n`;
            output += `Packets: TX: ${stats.tx.totalPackets}, RX: ${stats.rx.totalPackets}\n`;
            output += `Bytes: TX: ${stats.tx.totalBytes}, RX: ${stats.rx.totalBytes}\n`;
            output += 'Packet Types:\n';

            for (const type in stats.tx.packetTypes) {
                const typeEnum = type as unknown as MessageClass;
                output += `TX ${MessageClass[typeEnum]}: ${stats.tx.packetTypes[typeEnum]?.count} packets, ${stats.tx.packetTypes[typeEnum]?.bytes} bytes\n`;
            }

            for (const type in stats.rx.packetTypes) {
                const typeEnum = type as unknown as MessageClass;
                output += `RX ${MessageClass[typeEnum]}: ${stats.rx.packetTypes[typeEnum]?.count} packets, ${stats.rx.packetTypes[typeEnum]?.bytes} bytes\n`;
            }
        }

        return output;
    }


}
