import { CubeStore } from './cubeStore';
import { CubeInfo, CubeMeta } from './cubeInfo';
import { MessageClass, NetConstants } from './networkDefinitions';
import { Settings } from './config';
import { logger } from './logger';
import { Peer } from './peerDB';
import { NetworkManager } from "./networkManager";
import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { WebSocket } from 'isomorphic-ws';
import { CubeType } from './fieldProcessing';
import { cubeContest } from './cubeUtil';

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
    private unsentCubeMeta: Set<CubeMeta>;
    private lightMode: boolean = false;
    private hostNodePeerID: Buffer;

    // these two represent a very cumbersome but cross-platform way to remove
    // listeners from web sockets (which we need to do once a peer connection closes)
    private socketClosedController: AbortController = new AbortController();
    private socketClosedSignal: AbortSignal = this.socketClosedController.signal;

    constructor(
        networkManager: NetworkManager, ip: string, port: number,
        ws: WebSocket, cubeStore: CubeStore, hostNodePeerID: Buffer,
        lightMode: boolean = false,
        socketClosedController: AbortController = new AbortController(),
        socketClosedSignal: AbortSignal = socketClosedController.signal) {
        super();
        this.networkManager = networkManager;
        this.ws = ws;
        this.storage = cubeStore;
        this.hostNodePeerID = hostNodePeerID;
        this.lightMode = lightMode;
        this.socketClosedController = socketClosedController;
        this.socketClosedSignal = socketClosedSignal;
        this.stats = {
            ip: ip,
            port: port,
            peerID: undefined,
            tx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
            rx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
        };

        // Copy all hashes from cubeStore to unsentHashes.
        // Later, add hash to unsentHashes whenever we get a new cube.
        this.unsentCubeMeta = cubeStore.getAllStoredCubeMeta();
        cubeStore.on('cubeAdded', (cube: CubeMeta) => {
            this.unsentCubeMeta.add(cube);
        });

        // Handle incoming messages
        //@ts-ignore
        this.ws.addEventListener("message", (event) => {
            if (isNode) {
                this.handleMessage(Buffer.from(event.data as Buffer));
            } else {
                var blob: Blob = event.data as unknown as Blob;
                blob.arrayBuffer().then((value) => {
                    this.handleMessage(Buffer.from(value));
                });
            }
        }, { signal: this.socketClosedSignal });

        this.ws.addEventListener('close', () => {
            this.emit('close', this);
            this.shutdown();
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
        if (this.nodeRequestTimer) {
            clearInterval(this.nodeRequestTimer);
        }
        this.ws.close();
        this.socketClosedController.abort();  // removes all listeners from this.ws
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
        try {
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
        } catch (err) {
            logger.error(`NetworkPeer: ${this.stats.ip}:${this.stats.port} error while handling message: ${err}`);
            this.emit('blacklist', new Peer(this.stats.ip, this.stats.port));
            this.ws.close();
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
            this.emit('updatepeer', this);  // let listeners know we learnt the peer's ID
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
        let cubes: CubeMeta[] = [];
        let iterator: IterableIterator<CubeMeta> = this.unsentCubeMeta.values();
        for (let i = 0; i < NetConstants.MAX_CUBE_HASH_COUNT; i++) {
            const result = iterator.next();
            if (result.done) break;  // check if the iterator is exhausted

            const cube: CubeMeta = result.value;
            if (cube.key) {
                cubes.push(cube);
                this.unsentCubeMeta.delete(cube);
            }
            else
                break;
        }

        const CUBE_META_WIRE_SIZE = NetConstants.CUBE_KEY_SIZE + NetConstants.TIMESTAMP_SIZE
            + NetConstants.CHALLENGE_LEVEL_SIZE + NetConstants.CUBE_TYPE_SIZE;
        const reply = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE
            + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.COUNT_SIZE
            + cubes.length * CUBE_META_WIRE_SIZE);
        let offset = 0;

        reply.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        reply.writeUInt8(MessageClass.HashResponse, offset++);
        reply.writeUInt32BE(cubes.length, offset);
        offset += NetConstants.COUNT_SIZE;

        const timestampBuffer = Buffer.alloc(NetConstants.TIMESTAMP_SIZE);
        for (const cube of cubes) {
            reply.writeUInt8(cube.cubeType, offset++);
            reply.writeUInt8(cube.challengeLevel, offset++);

            // Convert the date (timestamp) to a 5-byte buffer and copy
            timestampBuffer.writeUIntBE(cube.date, 0, NetConstants.TIMESTAMP_SIZE);
            timestampBuffer.copy(reply, offset);
            offset += NetConstants.TIMESTAMP_SIZE;

            cube.key.copy(reply, offset);
            offset += NetConstants.CUBE_KEY_SIZE;
        }

        logger.trace(`NetworkPeer: handleHashRequest: sending ${cubes.length} cube details to ${this.stats.ip}:${this.stats.port}`);
        this.txMessage(reply);
    }

    /**
     * Handle a HashResponse message.
     * @param data The HashResponse data.
     */
    handleHashResponse(data: Buffer) {
        const hashCount = data.readUInt32BE(0);
        logger.trace(`NetworkPeer: handleHashResponse: received ${hashCount} hashes from ${this.stats.ip}:${this.stats.port}`);
        const regularCubeMeta: CubeMeta[] = [];
        const mucMeta = [];

        let offset = NetConstants.COUNT_SIZE;
        for (let i = 0; i < hashCount; i++) {
            const cubeType = data.readUInt8(offset++);
            const challengeLevel = data.readUInt8(offset++);
            // Read timestamp as a 5-byte number
            const timestamp = data.readUIntBE(offset, NetConstants.TIMESTAMP_SIZE);
            offset += NetConstants.TIMESTAMP_SIZE;
            const hash = data.slice(offset, offset + NetConstants.CUBE_KEY_SIZE);
            offset += NetConstants.CUBE_KEY_SIZE;
            const incomingCubeMeta: CubeMeta = {
                key: hash,
                date: timestamp,
                challengeLevel: challengeLevel,
                cubeType: cubeType
            }

            if (cubeType === CubeType.CUBE_TYPE_REGULAR) {
                regularCubeMeta.push(incomingCubeMeta);
            } else if (cubeType === CubeType.CUBE_TYPE_MUC) {
                mucMeta.push(incomingCubeMeta);
            }
        }
        // For each regular hash not in cube storage, request the cube
        const missingHashes: Buffer[] = regularCubeMeta.filter(detail => !this.storage.hasCube(detail.key)).map(detail => detail.key);
        for (const muc of mucMeta) {
            // Request any MUC not in cube storage
            if (!this.storage.hasCube(muc.key)) {
                missingHashes.push(muc.key);
            } else {
                // For each MUC in cube storage, identify winner and request if necessary
                const storedCube: CubeMeta = this.storage.getCubeInfo(muc.key);
                const winningCube: CubeMeta = cubeContest(storedCube, muc);
                if (winningCube === storedCube) {
                    logger.trace('CubeStorage: Keeping stored MUC, not requesting offered MUC');
                } else {
                    logger.trace('CubeStorage: Replacing stored MUC, requesting updated MUC');
                    missingHashes.push(muc.key);
                }
            }
        }

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
        // TODO: Rename variables to reflect that we're using CubeInfos

        // map/reduce/filter is really cool and stuff, but I'm not smart enough to understand it
        const cubes: CubeInfo[] = requestedCubeHashes.map(
            key => this.storage.getCubeInfo(key))
            .filter(cube => { if (cube) return cube.isComplete(); else return false; });

        const reply = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE
            + NetConstants.COUNT_SIZE + cubes.length * NetConstants.CUBE_SIZE);
        let offset = 0;

        reply.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        reply.writeUInt8(MessageClass.CubeResponse, offset++);
        reply.writeUInt32BE(cubes.length, offset);
        offset += NetConstants.COUNT_SIZE;

        for (const cubeInfo of cubes) {
            cubeInfo.binaryCube.copy(reply, offset);
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
        for (let i = 0; i < numberToSend; i++) {
            let rnd = Math.floor(Math.random() * availablePeerCount);
            chosenPeers.push(availablePeers[rnd]);
            availablePeers.slice(rnd, 1); availablePeerCount--;
        }
        // Determine message length
        let msgLength = NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.COUNT_SIZE;
        for (let i = 0; i < numberToSend; i++) {
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
        if (ip.startsWith('::ffff:')) {
            return ip.replace('::ffff:', '');
        }
        return ip;
    }
}