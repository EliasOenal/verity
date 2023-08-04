import WebSocket from 'ws';
import { CubeStore } from './cubeStore.js';
import { MessageClass, NetConstants } from './networkDefinitions.js';
import { PeerDB, Peer } from './peerDB.js';
import { EventEmitter } from 'events';
import { Settings } from './config.js';
import { NetworkPeer, NetworkStats } from './networkPeer.js';
import { logger } from './logger.js';
import crypto from 'crypto';
import net from 'net';

/**
 * Class representing a network manager, responsible for handling incoming and outgoing connections.
 */
export class NetworkManager extends EventEmitter {
    server: WebSocket.Server | undefined; // The WebSocket server for incoming connections
    outgoingPeers: NetworkPeer[]; // The peers for outgoing connections
    incomingPeers: NetworkPeer[]; // The peers for incoming connections
    private cubeStore: CubeStore;
    private peerDB: PeerDB;
    private isConnectingPeers: boolean;
    private connectPeersInterval: NodeJS.Timeout | undefined;
    private static WEBSOCKET_HANDSHAKE_TIMEOUT = 2500;
    private online: boolean = false;
    private announce: boolean;
    private server_enabled: boolean;
    private server_port: number;
    private lightNode: boolean;
    private peerID: Buffer;

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
    constructor(port: number, cubeStore: CubeStore, peerDB: PeerDB,
        announce: boolean = true, lightNode: boolean = false) {
        super();

        this.isConnectingPeers = false;
        this.outgoingPeers = [];
        this.incomingPeers = [];
        this.cubeStore = cubeStore;
        this.peerDB = peerDB;
        this.announce = announce;
        this.server = undefined;
        this.server_port = port;
        this.lightNode = lightNode;
        this.peerID = crypto.randomBytes(16);
        if (port !== 0) {
            this.server_enabled = true;
        } else {
            this.server_enabled = false;
            logger.info(`NetworkManager: Client mode is enabled. Listening for incoming connections is disabled.`);
        }
    }

    public start() {
        if (this.server_enabled) {
            this.server = new WebSocket.Server({ port: this.server_port });
            logger.trace('NetworkManager: Server has been started on port ' + this.server_port);

            // Handle incoming connections
            this.server?.on('connection', ws => {
                logger.debug(`NetworkManager: Incoming connection from ${(ws as any)._socket.remoteAddress}:${(ws as any)._socket.remotePort}`);
                const peer = new NetworkPeer(ws, this.cubeStore, this.peerID, this.lightNode);
                this.incomingPeers.push(peer);
                peer.on('close', () => {
                    logger.debug(`NetworkManager: Incoming connection from ${(ws as any)._socket.remoteAddress}:${(ws as any)._socket.remotePort} has been closed.`);
                    this.incomingPeers = this.incomingPeers.filter(p => p !== peer);
                });
            });

            this.server?.on('listening', () => {
                this.emit('listening');
                logger.debug(`NetworkManager: Server is listening on port ${this.server_port}.`);
            }
            );
        }

        this.peerDB.on('newPeer', (newPeer: Peer) => {
            // add a delay to prevent load spikes
            setTimeout(() => {
                this.connect(newPeer);
            }, Math.random() * 31337);
        });

        if (this.announce) {
            this.peerDB.startAnnounceTimer();
            this.peerDB.announce();
        }
        // TODO: rework this
        //this.startConnectingPeers();
    }

    private shutdownPeers() {
        this.outgoingPeers.forEach(peer => peer.shutdown());
        this.incomingPeers.forEach(peer => peer.shutdown());
    }

    private startConnectingPeers(): void {
        logger.trace('NetworkManager: startConnectingPeers()');
        // Call connectPeers immediately, then every 5 minutes
        this.connectPeersInterval = setInterval(() => {
            if (!this.isConnectingPeers) {
                //this.connectPeers();
            }
        }, Settings.NEW_PEER_INTERVAL);
    }

    private stopConnectingPeers(): void {
        logger.trace('NetworkManager: stopConnectingPeers()');
        if (this.connectPeersInterval) {
            clearInterval(this.connectPeersInterval);
            this.connectPeersInterval = undefined;
        }
    }

    // There is a point to be made to use IPv6 notation for all IPs
    // however for now this serves the purpose of being able to
    // prevent connecting to the same peer twice
    private convertIPv6toIPv4(ip: string): string {
        if (net.isIPv6(ip) && ip.startsWith('::ffff:')) {
            return ip.replace('::ffff:', '');
        }
        return ip;
    }

    public shutdown() {
        logger.trace('NetworkManager: shutdown()');
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
        //this.removeAllListeners();
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

    /*
     * Connect to a peer
     * @param peer_param - Peer to connect to
     * @returns Promise<NetworkPeer> - Resolves with a NetworkPeer if connection is successful
     */
    public async connect(peer_param: string | Peer): Promise<NetworkPeer> {
        // Create a Peer and its associated URL
        const { peer, peerURL } = this.createPeer(peer_param);

        logger.info(`NetworkManager: Connecting to ${peerURL}...`);

        // Create a WebSocket connection with a handshake timeout
        const ws = new WebSocket(peerURL, { handshakeTimeout: NetworkManager.WEBSOCKET_HANDSHAKE_TIMEOUT });

        // Listen for WebSocket errors
        ws.on('error', (error) => {
            logger.warn(`NetworkManager: WebSocket error: ${error}`);
            // Remove all listeners and close the WebSocket connection in case of an error
            ws.close();
            ws.removeAllListeners();
        });

        return new Promise((resolve) => {
            // Listen for the WebSocket 'open' event
            ws.on('open', () => {
                // Mark the peer as verified
                this.peerDB.setPeersVerified([peer]);
                // Create a new NetworkPeer
                const networkPeer = new NetworkPeer(ws, this.cubeStore, this.peerID, this.lightNode);

                logger.info(`NetworkManager: Connected to ${peerURL}`);
                // Add the new NetworkPeer to the list of outgoing peers
                this.outgoingPeers.push(networkPeer);

                // Listen for the 'close' event on the NetworkPeer
                networkPeer.on('close', (closingPeer) => {
                    logger.info(`NetworkManager: Connection to ${closingPeer.ip}:${closingPeer.port} has been closed.`);
                    // Remove the closing peer from the list of outgoing peers
                    this.outgoingPeers = this.outgoingPeers.filter(peer => peer !== closingPeer);
                });

                // Listen for the 'blacklist' event on the NetworkPeer
                networkPeer.on('blacklist', (bannedPeer: Peer) => {
                    // Add the banned peer to the blacklist
                    this.peerDB.setPeersBlacklisted([bannedPeer]);
                    logger.info(`NetworkManager: Peer ${bannedPeer.ip}:${bannedPeer.port} has been blacklisted.`);
                    this.emit('blacklist', bannedPeer);
                });

                // If this is the first successful connection, emit an 'online' event
                if (!this.online) {
                    this.online = true;
                    this.emit('online');
                }

                // Resolve the promise with the new NetworkPeer
                resolve(networkPeer);
            });
        });
    }


    private consolidateStats(totalStats: { [key: string]: { count: number, bytes: number } }, peerStats: { [key: string]: { count: number, bytes: number } }) {
        for (let type in peerStats) {
            if (!(type in totalStats)) {
                totalStats[type] = { count: 0, bytes: 0 };
            }
            totalStats[type].count += peerStats[type].count;
            totalStats[type].bytes += peerStats[type].bytes;
        }
    }

    getNetStatistics(): NetworkStats {
        let totalStats: NetworkStats = {
            ip: "",
            port: 0,
            peerID: this.peerID,
            tx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
            rx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
        };

        for (let peer of this.outgoingPeers.concat(this.incomingPeers)) {
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
        output += `Cubes: ${this.cubeStore.storage.size}\n`;
        output += `Memory: ${this.cubeStore.storage.size * NetConstants.CUBE_SIZE}\n`;

        output += `\nNetwork Total\n`;
        const totalStats = this.getNetStatistics();
        output += `Total Packets: TX: ${totalStats.tx.totalPackets}, RX: ${totalStats.rx.totalPackets}\n`;
        output += `Total Bytes: TX: ${totalStats.tx.totalBytes}, RX: ${totalStats.rx.totalBytes}\n`;
        output += `Connected Peers: ${this.outgoingPeers.length + this.incomingPeers.length}\n`;
        output += `Verified Peers: ${this.peerDB.getPeersVerified().map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Unverified Peers: ${this.peerDB.getPeersUnverified().map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += `Blacklisted Peers: ${this.peerDB.getPeersBlacklisted().map(peer => `${peer.ip}:${peer.port}`).join(', ')}\n`;
        output += 'Packet Types:\n';

        for (let type in totalStats.tx.packetTypes) {
            const typeEnum = type as unknown as MessageClass;
            output += `TX ${MessageClass[typeEnum]}: ${totalStats.tx.packetTypes[typeEnum]?.count} packets, ${totalStats.tx.packetTypes[typeEnum]?.bytes} bytes\n`;
        }

        for (let type in totalStats.rx.packetTypes) {
            const typeEnum = type as unknown as MessageClass;
            output += `RX ${MessageClass[typeEnum]}: ${totalStats.rx.packetTypes[typeEnum]?.count} packets, ${totalStats.rx.packetTypes[typeEnum]?.bytes} bytes\n`;
        }

        for (let peer of this.outgoingPeers.concat(this.incomingPeers)) {
            output += '\n';

            const stats = peer.stats;
            output += `Peer: ${peer.stats.ip}:${stats.port}\n`;
            output += `Peer ID: ${peer.stats.peerID?.toString('hex').toUpperCase()}\n`;
            output += `Packets: TX: ${stats.tx.totalPackets}, RX: ${stats.rx.totalPackets}\n`;
            output += `Bytes: TX: ${stats.tx.totalBytes}, RX: ${stats.rx.totalBytes}\n`;
            output += 'Packet Types:\n';

            for (let type in stats.tx.packetTypes) {
                const typeEnum = type as unknown as MessageClass;
                output += `TX ${MessageClass[typeEnum]}: ${stats.tx.packetTypes[typeEnum]?.count} packets, ${stats.tx.packetTypes[typeEnum]?.bytes} bytes\n`;
            }

            for (let type in stats.rx.packetTypes) {
                const typeEnum = type as unknown as MessageClass;
                output += `RX ${MessageClass[typeEnum]}: ${stats.rx.packetTypes[typeEnum]?.count} packets, ${stats.rx.packetTypes[typeEnum]?.bytes} bytes\n`;
            }
        }

        return output;
    }


}
