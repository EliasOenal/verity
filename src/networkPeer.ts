import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { CubeStore } from './cubeStore';
import { MessageClass, NetConstants } from './networkDefinitions';
import { WebSocket } from 'isomorphic-ws';
import { Settings } from './config';
import { logger } from './logger';
import { Peer } from './peerDB';
import { NetworkManager } from "./networkManager";


export interface PacketStats {
    count: number,
    bytes: number
}

export interface NetworkStats {
    ip: string;
    port: number;
    peerID: Buffer | undefined;
    tx: {
        totalPackets: number,
        totalBytes: number,
        packetTypes: { [key in MessageClass]?: PacketStats }
    },
    rx: {
        totalPackets: number,
        totalBytes: number,
        packetTypes: { [key in MessageClass]?: PacketStats }
    }
}

/**
 * Class representing a network peer, responsible for handling incoming and outgoing messages.
 */
export class NetworkPeer extends EventEmitter {
    networkManager: NetworkManager;
    ws: WebSocket; // The WebSocket connection associated with this peer
    storage: CubeStore; // The cube storage instance associated with this peer
    stats: NetworkStats;
    hashRequestTimer?: NodeJS.Timeout; // Timer for hash requests
    nodeRequestTimer?: NodeJS.Timeout; // Timer for node requests
    private unsentHashes: Set<Buffer>;
    private lightMode: boolean = false;
    private hostNodePeerID: Buffer;

    constructor(networkManager: NetworkManager, ip: string, port: number, ws: WebSocket, cubeStore: CubeStore, hostNodePeerID: Buffer, lightMode: boolean = false) {
        super();
        this.networkManager = networkManager;
        this.ws = ws;
        this.storage = cubeStore;
        this.unsentHashes = new Set();
        this.hostNodePeerID = hostNodePeerID;
        this.lightMode = lightMode;
        this.stats = {
            ip: ip,
            port: port,
            peerID: undefined,
            tx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
            rx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
        };

        // copy all hashes from cubeStore to unsentHashes
        for (let hash of cubeStore.getAllKeysAsBuffer()) {
            this.unsentHashes.add(hash);
        }

        // Handle incoming messages
        this.ws.addEventListener("message", (event) => {
            if (isNode) {
                this.handleMessage(Buffer.from(event.data as Buffer));
            } else {
                var blob: Blob = event.data as unknown as Blob;
                blob.arrayBuffer().then((value) => {
                    this.handleMessage(Buffer.from(value));
                });
            }
        });

        this.ws.addEventListener('close', () => {
            this.emit('close', this);
            this.shutdown();
        });

        cubeStore.on('cubeAdded', (hash) => {
            this.unsentHashes.add(hash);
        });

        // Be polite and send a hello message
        // This allows us to identify if we're connected to ourselves
        this.sendHello();
    }

    public shutdown(): void {
        // Remove all listeners attached to this instance to avoid memory leaks
        if (this.hashRequestTimer) {
            clearInterval(this.hashRequestTimer);
        }
        this.ws.close();
        this.ws.removeAllListeners();  // TODO FIXME: not available in browser (as browser WebSockets don't inherit from EventEmitter)
        this.removeAllListeners();
    }

    logRxStats(message: Buffer, messageType: MessageClass) {
        this.stats.rx.totalPackets++;
        this.stats.rx.totalBytes += message.length;
        let packetTypeStats = this.stats.rx.packetTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.rx.packetTypes[messageType] = packetTypeStats;
    }

    logTxStats(message: Buffer, messageType: MessageClass) {
        this.stats.tx.totalPackets++;
        this.stats.tx.totalBytes += message.length;
        let packetTypeStats = this.stats.tx.packetTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.tx.packetTypes[messageType] = packetTypeStats;
    }

    private txMessage(message: Buffer) {
        this.logTxStats(message, message.readUInt8(NetConstants.PROTOCOL_VERSION_SIZE));
        this.ws.send(message);
    }

    /**
     * Handle an incoming message.
     * @param message The incoming message as a Buffer.
     */
    handleMessage(message: Buffer) {
        const messageClass = message.readUInt8(NetConstants.PROTOCOL_VERSION_SIZE);
        const messageContent = message.subarray(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        logger.trace(`NetworkPeer: handleMessage() messageClass: ${MessageClass[messageClass]}`);
        this.logRxStats(message, messageClass);

        // Process the message based on its class
        switch (messageClass) {
            case MessageClass.Hello:
                this.handleHello(messageContent);
                break;
            case MessageClass.HashRequest:
                this.handleHashRequest();
                break;
            case MessageClass.HashResponse:
                this.handleHashResponse(messageContent);
                break;
            case MessageClass.CubeRequest:
                this.handleCubeRequest(messageContent);
                break;
            case MessageClass.CubeResponse:
                this.handleCubeResponse(messageContent);
                break;
            case MessageClass.NodeRequest:
                this.handleNodeRequest();
                break;
            case MessageClass.NodeResponse:
                this.handleNodeResponse(messageContent);
                break;
            default:
                console.log(`NetworkPeer: Received message with unknown class: ${messageClass}`);
        }
    }

    sendHello() {
        logger.trace(`NetworkPeer: sendHello()`);
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.PEER_ID_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, 0);
        message.writeUInt8(MessageClass.Hello, 1);
        this.hostNodePeerID.copy(message, NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        this.txMessage(message);
    }

    handleHello(data: Buffer) {
        this.stats.peerID = data.slice(0, 16);
        this.emit('updatepeer', this);

        // compare peerID to first 16 bytes of incoming packet
        logger.trace(`NetworkPeer: received 'Hello' from IP: ${this.stats.ip}, port: ${this.stats.port}, peerID: ${this.stats.peerID.toString('hex')}`);
        if (this.hostNodePeerID.compare(this.stats.peerID) === 0) {
            // We're connected to ourselves, close the connection
            // and blacklist the IP
            logger.debug(`NetworkPeer: connected to ourselves, closing connection and blacklisting IP: ${this.stats.ip} port: ${this.stats.port}`);
            const peer: Peer = new Peer(this.stats.ip, this.stats.port);
            this.emit('blacklist', peer);
            this.ws.close();
        } else {
        // Asks for their know peers now, and then in regular intervals
        this.sendNodeRequest();
        this.nodeRequestTimer = setInterval(() => this.sendNodeRequest(), Settings.NODE_REQUEST_TIME);

        // If we're a full node, ask for available cubes now, and then in regular intervals
        if (!this.lightMode) {
            this.sendHashRequest();
            this.hashRequestTimer = setInterval(() => this.sendHashRequest(),
                Settings.HASH_REQUEST_TIME);
        }

        }
    }

    /**
     * Handle a HashRequest message.
     */
    handleHashRequest() {
        // Send MAX_CUBE_HASH_COUNT unsent hashes from unsentHashes
        let hashes: Buffer[] = [];
        let iterator = this.unsentHashes.values();
        for (let i = 0; i < NetConstants.MAX_CUBE_HASH_COUNT; i++) {
            let hash = iterator.next().value;
            if (hash) {
                hashes.push(Buffer.from(hash, 'hex'));
                this.unsentHashes.delete(hash);
            }
            else
                break;
        }

        const reply = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE
            + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.COUNT_SIZE
            + hashes.length * NetConstants.HASH_SIZE);
        let offset = 0;

        reply.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        reply.writeUInt8(MessageClass.HashResponse, offset++);
        reply.writeUInt32BE(hashes.length, offset);
        offset += NetConstants.COUNT_SIZE;

        for (const hash of hashes) {
            hash.copy(reply, offset);
            offset += NetConstants.HASH_SIZE;
        }
        logger.trace(`NetworkPeer: handleHashRequest: sending ${hashes.length} hashes to ${this.stats.ip}:${this.stats.port}`);
        this.txMessage(reply);
    }

    /**
     * Handle a HashResponse message.
     * @param data The HashResponse data.
     */
    handleHashResponse(data: Buffer) {
        const hashCount = data.readUInt32BE(0);
        logger.trace(`NetworkPeer: handleHashResponse: received ${hashCount} hashes from ${this.stats.ip}:${this.stats.port}`);
        const hashes = [];

        for (let i = 0; i < hashCount; i++) {
            hashes.push(data.slice(NetConstants.COUNT_SIZE + i * NetConstants.HASH_SIZE,
                NetConstants.COUNT_SIZE + (i + 1) * NetConstants.HASH_SIZE));
        }

        // for each hash not in cube storage, request the cube
        const missingHashes = hashes.filter(hash => !this.storage.hasCube(hash));
        if (missingHashes.length > 0) {
            this.sendCubeRequest(missingHashes);
        }
    }

    /**
     * Handle a CubeRequest message.
     * @param data The CubeRequest data.
     */
    handleCubeRequest(data: Buffer) {
        const cubeHashCount = Math.min(data.readUInt32BE(0), NetConstants.MAX_CUBE_HASH_COUNT);
        const requestedCubeHashes = [];
        for (let i = 0; i < cubeHashCount; i++) {
            requestedCubeHashes.push(data.slice(NetConstants.COUNT_SIZE
                + i * NetConstants.HASH_SIZE, NetConstants.COUNT_SIZE
            + (i + 1) * NetConstants.HASH_SIZE));
        }

        // Collect only defined cubes from the cube storage
        const cubes: Buffer[] = requestedCubeHashes.map(hash => this.storage.getCubeRaw(hash))
            .filter((cube): cube is Buffer => cube !== undefined);

        const reply = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE
            + NetConstants.COUNT_SIZE + cubes.length * NetConstants.CUBE_SIZE);
        let offset = 0;

        reply.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        reply.writeUInt8(MessageClass.CubeResponse, offset++);
        reply.writeUInt32BE(cubes.length, offset);
        offset += NetConstants.COUNT_SIZE;

        for (const cube of cubes) {
            cube.copy(reply, offset);
            offset += NetConstants.CUBE_SIZE;
        }
        logger.trace(`NetworkPeer: handleCubeRequest: sending ${cubes.length} cubes to ${this.stats.ip}:${this.stats.port}`);
        this.txMessage(reply);
    }

    /**
     * Handle a CubeResponse message.
     * @param data The CubeResponse data.
     */
    // TODO: If we're a light node, make sure we actually requested those
    async handleCubeResponse(data: Buffer) {
        const cubeCount = data.readUInt32BE(0);
        for (let i = 0; i < cubeCount; i++) {
            const cubeData = data.slice(NetConstants.COUNT_SIZE + i * NetConstants.CUBE_SIZE,
                NetConstants.COUNT_SIZE + (i + 1) * NetConstants.CUBE_SIZE);

            // Add the cube to the CubeStorage
            let hash = await this.storage.addCube(cubeData);
            if (!hash) {
                logger.error(`NetworkPeer: handleCubeResponse: failed to add cube ${hash}`);
                return;
            }
        }
        logger.info(`NetworkPeer: handleCubeResponse: received ${cubeCount} cubes from ${this.stats.ip}:${this.stats.port}`);
    }

    /**
      * Send a HashRequest message.
      */
    sendHashRequest() {
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, 0);
        message.writeUInt8(MessageClass.HashRequest, 1);
        logger.trace(`NetworkPeer: sendHashRequest: sending HashRequest to ${this.stats.ip}:${this.stats.port}`);
        this.txMessage(message);
    }

    /**
     * Send a CubeRequest message.
     * @param hashes The list of cube hashes to request.
     */
    sendCubeRequest(hashes: Buffer[]) {
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE
            + NetConstants.COUNT_SIZE + hashes.length * NetConstants.HASH_SIZE);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.CubeRequest, offset++);
        message.writeUIntBE(hashes.length, offset, NetConstants.COUNT_SIZE);
        offset += NetConstants.COUNT_SIZE;
        for (const hash of hashes) {
            hash.copy(message, offset);
            offset += NetConstants.HASH_SIZE;
        }
        logger.trace(`NetworkPeer: sendCubeRequest: sending CubeRequest for ${hashes.length} cubes to ${this.stats.ip}:${this.stats.port}`);
        this.txMessage(message);
    }

    sendNodeRequest() {
        // Determine message length
        let msgLength = NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE;
        // Prepare message
        const message = Buffer.alloc(msgLength);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.NodeRequest, offset++);
        logger.trace(`NetworkPeer: sendNodeRequest: sending NodeRequest to ${this.stats.ip}:${this.stats.port}`);
        this.txMessage(message);
    }

    handleNodeRequest() {
        // Send MAX_NODE_ADDRESS_COUNT peer addresses
        // ... do we even know that many?
        let availablePeers = this.networkManager.getPeerDB().getPeersVerified();
        // TODO FIXME: This includes incoming peers, and for incoming peers we only know their client socket.
        // TODO FIXME: Most universally, clients can accept incoming connections on client sockets.
        // TODO FIXME: We should include the server port in the hello message and save it.
        let availablePeerCount: number = availablePeers.length;
        let numberToSend: number;
        if (availablePeerCount >= NetConstants.MAX_NODE_ADDRESS_COUNT) {
            numberToSend = NetConstants.MAX_NODE_ADDRESS_COUNT;
        } else {
            numberToSend = availablePeerCount;
        }
        // Select random peers in random order
        let chosenPeers: Array<Peer> = [];
        for (let i=0; i<numberToSend; i++) {
            let rnd = Math.floor(Math.random() * availablePeerCount);
            chosenPeers.push(availablePeers[rnd]);
            availablePeers.slice(rnd, 1); availablePeerCount--;
        }
        // Determine message length
        let msgLength = NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.COUNT_SIZE;
        for (let i=0; i<numberToSend; i++) {
            msgLength += 2;  // for the node address length field
            msgLength += chosenPeers[i].address().length;
        }
        // Prepare message
        const message = Buffer.alloc(msgLength);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.NodeResponse, offset++);
        message.writeUIntBE(numberToSend, offset, NetConstants.COUNT_SIZE); offset += NetConstants.COUNT_SIZE;
        for (const peer of chosenPeers) {
            message.writeUInt16BE(peer.address().length, offset);
            offset += 2;
            message.write(peer.address(), offset, peer.address().length, 'ascii');
            offset += peer.address().length;
        }
        logger.trace(`NetworkPeer: handleNodeRequest: sending ${numberToSend} peer addresses to ${this.stats.ip}:${this.stats.port}`);
        this.txMessage(message);
    }

    handleNodeResponse(message: Buffer) {
        let offset = 0;
        const peerCount: number = message.readUIntBE(offset, NetConstants.COUNT_SIZE);
        offset += NetConstants.COUNT_SIZE;
        for (let i = 0; i < peerCount; i++) {
            let addressLength: number = message.readUint16BE(offset);
            offset += 2;
            const peerAddress = message.subarray(offset, offset + addressLength);
            offset += addressLength;

            // prepare peer object
            const [peerIp, peerPort] = peerAddress.toString('ascii').split(':');
            if (!peerIp || !peerPort) continue;  // ignore invalid
            const peer: Peer = new Peer(peerIp, parseInt(peerPort));

            // skip peer if already known
            if (this.networkManager.getPeerDB().isPeerKnown(peer)) {
                logger.info(`NetworkPeer: Received peer ${peerIp}:${peerPort} from ${this.stats.ip}:${this.stats.port}, but we already knew them`);
                continue;
            }

            // register peer
            this.networkManager.getPeerDB().setPeersUnverified([peer]);
            logger.info(`NetworkPeer: Received new peer ${peerIp}:${peerPort} from ${this.stats.ip}:${this.stats.port}`);

            // Connect to new peer
            // TODO: This obviously does not scale.
            // TODO: Find a suitable algorithm to decide which and how many peers to connect to.
            this.networkManager.connect(peer);
        }
    }

    // There is a point to be made to use IPv6 notation for all IPs
    // however for now this serves the purpose of being able to
    // prevent connecting to the same peer twice
    private convertIPv6toIPv4(ip: string): string {
        if ( ip.startsWith('::ffff:') ) {
            return ip.replace('::ffff:', '');
        }
        return ip;
    }
}