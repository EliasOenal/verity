import { EventEmitter } from 'events';
import { BlockStorage } from './blockStorage';
import { MessageClass, NetConstants } from './networkDefinitions';
import { WebSocket } from 'ws';
import { Settings } from './config';
import { logger } from './logger';
import { Peer } from './peerDB';
import net from 'net';


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
    ws: WebSocket; // The WebSocket connection associated with this peer
    storage: BlockStorage; // The block storage instance associated with this peer
    stats: NetworkStats;
    hashRequestTimer?: NodeJS.Timeout; // Timer for hash requests
    private unsentHashes: Set<Buffer>;
    private lightMode: boolean = false;
    private hostNodePeerID: Buffer;

    constructor(ws: WebSocket, blockStorage: BlockStorage, hostNodePeerID: Buffer, lightMode: boolean = false) {
        super();
        this.ws = ws;
        this.storage = blockStorage;
        this.unsentHashes = new Set();
        this.hostNodePeerID = hostNodePeerID;
        this.lightMode = lightMode;
        this.stats = {
            ip: (ws as any)._socket.remoteAddress,
            port: (ws as any)._socket.remotePort,
            peerID: undefined,
            tx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
            rx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
        };

        // copy all hashes from blockStorage to unsentHashes
        for (let hash of blockStorage.getAllHashes()) {
            this.unsentHashes.add(hash);
        }

        // Handle incoming messages
        this.ws.on('message', (message: Buffer) => {
            this.handleMessage(message);
        });

        this.ws.on('close', () => {
            this.emit('close', this);
            this.shutdown();
        });

        blockStorage.on('hashAdded', (hash) => {
            this.unsentHashes.add(hash);
        });

        // Be polite and send a hello message
        // This allows us to identify if we're connected to ourselves
        this.sendHello();

        if (!lightMode) {
            this.hashRequestTimer = setInterval(() => this.sendHashRequest(),
                Settings.HASH_REQUEST_TIME);
        }
    }

    public shutdown(): void {
        // Remove all listeners attached to this instance to avoid memory leaks
        if (this.hashRequestTimer) {
            clearInterval(this.hashRequestTimer);
        }
        this.ws.close();
        this.ws.removeAllListeners();
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
        logger.trace(`NetworkPeer: handleMessage() messageClass: ${MessageClass[messageClass]}`);
        this.logRxStats(message, messageClass);

        // Process the message based on its class
        switch (messageClass) {
            case MessageClass.Hello:
                this.handleHello(message.slice(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE));
                break;
            case MessageClass.HashRequest:
                this.handleHashRequest();
                break;
            case MessageClass.HashResponse:
                this.handleHashResponse(message.slice(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE));
                break;
            case MessageClass.BlockRequest:
                this.handleBlockRequest(message.slice(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE));
                break;
            case MessageClass.BlockResponse:
                this.handleBlockResponse(message.slice(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE));
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
        // compare peerID to first 16 bytes of incoming packet
        logger.trace(`NetworkPeer: received 'Hello' from IP: ${this.stats.ip}, port: ${this.stats.port}, peerID: ${this.stats.peerID.toString('hex')}`);
        if (this.hostNodePeerID.compare(this.stats.peerID) === 0) {
            // We're connected to ourselves, close the connection
            // and blacklist the IP
            logger.debug(`NetworkPeer: connected to ourselves, closing connection and blacklisting IP: ${this.stats.ip} port: ${this.stats.port}`);
            const peer: Peer = new Peer(this.stats.ip, this.stats.port);
            this.emit('blacklist', peer);
            this.ws.close();
        }
    }

    /**
     * Handle a HashRequest message.
     */
    handleHashRequest() {
        // Send MAX_BLOCK_HASH_COUNT unsent hashes from unsentHashes
        let hashes: Buffer[] = [];
        let iterator = this.unsentHashes.values();
        for (let i = 0; i < NetConstants.MAX_BLOCK_HASH_COUNT; i++) {
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
        logger.trace(`NetworkPeer: handleHashRequest: replying with ${hashes.length} hashes`);
        this.txMessage(reply);
    }

    /**
     * Handle a HashResponse message.
     * @param data The HashResponse data.
     */
    handleHashResponse(data: Buffer) {
        const hashCount = data.readUInt32BE(0);
        logger.trace(`NetworkPeer: handleHashResponse: received ${hashCount} hashes`);
        const hashes = [];

        for (let i = 0; i < hashCount; i++) {
            hashes.push(data.slice(NetConstants.COUNT_SIZE + i * NetConstants.HASH_SIZE,
                NetConstants.COUNT_SIZE + (i + 1) * NetConstants.HASH_SIZE));
        }

        // for each hash not in block storage, request the block
        const missingHashes = hashes.filter(hash => !this.storage.hasBlock(hash));
        if (missingHashes.length > 0) {
            this.sendBlockRequest(missingHashes);
        }
    }

    /**
     * Handle a BlockRequest message.
     * @param data The BlockRequest data.
     */
    handleBlockRequest(data: Buffer) {
        const blockHashCount = Math.min(data.readUInt32BE(0), NetConstants.MAX_BLOCK_HASH_COUNT);
        const requestedBlockHashes = [];
        for (let i = 0; i < blockHashCount; i++) {
            requestedBlockHashes.push(data.slice(NetConstants.COUNT_SIZE
                + i * NetConstants.HASH_SIZE, NetConstants.COUNT_SIZE
            + (i + 1) * NetConstants.HASH_SIZE));
        }

        // Collect only defined blocks from the block storage
        const blocks: Buffer[] = requestedBlockHashes.map(hash => this.storage.getBlockRaw(hash))
            .filter((block): block is Buffer => block !== undefined);

        const reply = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE
            + NetConstants.COUNT_SIZE + blocks.length * NetConstants.BLOCK_SIZE);
        let offset = 0;

        reply.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        reply.writeUInt8(MessageClass.BlockResponse, offset++);
        reply.writeUInt32BE(blocks.length, offset);
        offset += NetConstants.COUNT_SIZE;

        for (const block of blocks) {
            block.copy(reply, offset);
            offset += NetConstants.BLOCK_SIZE;
        }
        logger.trace(`NetworkPeer: handleBlockRequest: replying with ${blocks.length} blocks`);
        this.txMessage(reply);
    }

    /**
     * Handle a BlockResponse message.
     * @param data The BlockResponse data.
     */
    async handleBlockResponse(data: Buffer) {
        const blockCount = data.readUInt32BE(0);
        for (let i = 0; i < blockCount; i++) {
            const blockData = data.slice(NetConstants.COUNT_SIZE + i * NetConstants.BLOCK_SIZE,
                NetConstants.COUNT_SIZE + (i + 1) * NetConstants.BLOCK_SIZE);

            // Add the block to the BlockStorage
            let hash = await this.storage.addBlock(blockData);
            if (!hash) {
                logger.error(`NetworkPeer: handleBlockResponse: failed to add block ${hash}`);
                return;
            }
        }
        logger.trace(`NetworkPeer: handleBlockResponse: added ${blockCount} blocks`);
    }

    /**
      * Send a HashRequest message.
      */
    sendHashRequest() {
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, 0);
        message.writeUInt8(MessageClass.HashRequest, 1);
        logger.trace(`NetworkPeer: sendHashRequest: sending HashRequest`);
        this.txMessage(message);
    }

    /**
     * Send a BlockRequest message.
     * @param hashes The list of block hashes to request.
     */
    sendBlockRequest(hashes: Buffer[]) {
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE
            + NetConstants.COUNT_SIZE + hashes.length * NetConstants.HASH_SIZE);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.BlockRequest, offset++);
        message.writeUInt32BE(hashes.length, offset);
        offset += NetConstants.COUNT_SIZE;
        for (const hash of hashes) {
            hash.copy(message, offset);
            offset += NetConstants.HASH_SIZE;
        }
        logger.trace(`NetworkPeer: sendBlockRequest: sending BlockRequest for ${hashes.length} blocks`);
        this.txMessage(message);
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
}