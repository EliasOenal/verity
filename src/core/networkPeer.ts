import { CubeStore } from './cubeStore';
import { CubeInfo, CubeMeta } from './cubeInfo';
import { MessageClass, NetConstants } from './networkDefinitions';
import { Settings, VerityError } from './config';
import { logger } from './logger';
import { WebSocketAddress, Peer } from './peerDB';
import { NetworkManager } from "./networkManager";
import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { CubeType } from './cubeDefinitions';
import { cubeContest } from './cubeUtil';

import WebSocket from 'isomorphic-ws';

export interface PacketStats {
    count: number,
    bytes: number
}

export interface NetworkStats {
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
 * @emits "ready" when connection is... you know... ready
 */
export abstract class NetworkPeerConnection extends EventEmitter {
    static Create(peer: NetworkPeer, address: WebSocketAddress) {
        if (address instanceof WebSocketAddress) {
            return new WebSocketPeerConnection(peer, address)
        } else {
            throw new AddressError("NetworkPeerConnection: Unsupported address type");
        }
    }

    close(): void {
        throw new VerityError("NetworkPeerConnection.close() to be implemented by subclass")
    }
    ready(): boolean {
        throw new VerityError("NetworkPeerConnection.ready() to be implemented by subclass")
    }
    send(message: Buffer): void {
        throw new VerityError("NetworkPeerConnection.send() to be implemented by subclass")
    }

}

export class WebSocketPeerConnection extends NetworkPeerConnection {
    private static WEBSOCKET_HANDSHAKE_TIMEOUT = 2500;
    private ws: WebSocket;  // The WebSocket connection associated with this peer

    // these two represent a very cumbersome but cross-platform way to remove
    // listeners from web sockets (which we need to do once a peer connection closes)
    private socketClosedController: AbortController = new AbortController();
    private socketClosedSignal: AbortSignal = this.socketClosedController.signal;

    constructor(
            private peer: NetworkPeer,
            private conn_param: WebSocketAddress | WebSocket) {
        super();

        if (conn_param instanceof WebSocket) {
            this.ws = conn_param;
        } else {
            // Create a WebSocket connection
            let WsOptions: any;
            // set a handshake timeout on NodeJS, not possible in the browser
            if (isNode) {
                WsOptions = { handshakeTimeout: WebSocketPeerConnection.WEBSOCKET_HANDSHAKE_TIMEOUT };
            } else {
                WsOptions = [];
            }
            this.ws = new WebSocket(peer.url, WsOptions);
        }

        // On WebSocket errors just shut down this peer
        // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
        this.ws.addEventListener("error", (error) => {
            // TODO: We should probably "greylist" peers that closed with an error,
            // i.e. not try to reconnect them for some time.
            logger.warn(`WebSockerPeerConnection: WebSocket error: ${error.message}`);
            this.peer.close();
        }, { signal: this.socketClosedSignal });

        // Handle incoming messages
        // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
        this.ws.addEventListener("message", (event) => {
            if (isNode) {
                this.peer.handleMessage(Buffer.from(event.data as Buffer));
            } else {
                const blob: Blob = event.data as unknown as Blob;
                blob.arrayBuffer().then((value) => {
                    this.peer.handleMessage(Buffer.from(value));
                });
            }
        }, { signal: this.socketClosedSignal });

        this.ws.addEventListener('close', () => {
            // TODO: We should at some point drop nodes closing on us from our PeerDB,
            // at least if they did that repeatedly and never even sent a valid HELLO.
            logger.trace(`WebSocketPeerConnection: Peer ${this.peer.toString()} closed on us`);
            this.peer.close();
        });

        this.ws.addEventListener("open", () =>  {
            this.emit("ready");
        // @ts-ignore I don't know why the compiler complains about this
        }, { signal: this.socketClosedSignal });
    }

    /**
     * Closes the connection.
     * This will be called by NetworkPeer.close() and should thus never be
     * called directly.
     */
    close(): void {
        this.ws.close();
        this.socketClosedController.abort();  // removes all listeners from this.ws
    }

    ready(): boolean {
        return (this.ws.readyState > 0)
    }

    send(message: Buffer) {
        this.ws.send(message);
    }
}

/**
 * Class representing a network peer, responsible for handling incoming and outgoing messages.
 */
export class NetworkPeer extends Peer {
    stats: NetworkStats = {
        tx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
        rx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
    }
    hashRequestTimer?: NodeJS.Timeout = undefined; // Timer for hash requests
    nodeRequestTimer?: NodeJS.Timeout = undefined; // Timer for node requests

    private onlinePromiseResolve: Function;
    /**
     * A peer will be considered to be online once a correct HELLO message
     * has been received.
     * If this NetworPeer never gets online, the promise will be resolved
     * with undefined.
     */
    private _onlinePromise: Promise<NetworkPeer> = new Promise<NetworkPeer>(
        (resolve) => {
            this.onlinePromiseResolve = resolve;
        });
    get onlinePromise() { return this._onlinePromise; }
    private _online: boolean = false;  // extra bool because JS doesn't let us query the promise's internal state :(
    get online() { return this._online; }

    private unsentCubeMeta: Set<CubeMeta> = undefined;
    private unsentPeers: Peer[] = undefined;  // TODO this should probably be a Set instead

    private conn: NetworkPeerConnection = undefined;

    constructor(
            private networkManager: NetworkManager,
            address: WebSocketAddress | WebSocketAddress[],
            private cubeStore: CubeStore,  // The cube storage instance associated with this peer
            private hostNodePeerID: Buffer,
            private lightMode: boolean = false,
            conn: NetworkPeerConnection | WebSocket = undefined,
        )
    {
        super(address);
        if (conn === undefined) {
            this.conn = NetworkPeerConnection.Create(this, this.address);
        } else if (conn instanceof NetworkPeerConnection) {
            this.conn = conn;
        } else if (conn instanceof WebSocket) {
            this.conn = new WebSocketPeerConnection(this, conn);
        }

        // Take note of all cubes I could share with this new peer. While the
        // connection lasts, supplement this with any newly learned cubes.
        // This is used to ensure we don't offer peers the same cube twice.
        this.unsentCubeMeta = cubeStore.getAllStoredCubeMeta();
        cubeStore.on('cubeAdded', (cube: CubeMeta) => {
            this.unsentCubeMeta.add(cube);
        });

        // Take note of all other peers I could exchange with this new peer.
        // This is used to ensure we don't exchange the same peers twice.
        this.unsentPeers = this.networkManager.getPeerDB().getPeersVerified();
        networkManager.getPeerDB().on('peerVerified', (peer: Peer) => {
            if (!this.equals(peer)) {  // but don't share a peer with itself
               this.unsentPeers.push(peer);
            }
        });
        // TODO FIXME: This includes incoming peers, and for incoming peers we only know their client socket.
        // TODO FIXME: Most universally, clients can't accept incoming connections on client sockets.
        // TODO FIXME: We should include the server port in the hello message and save it.

        // TODO: We should close the connection if we don't hear from this peer
        // for some defined time. Currently we just keep talking to a wall and
        // occupying a connection slot.

        // Send HELLO message once connected
        if (this.conn.ready()) {
            logger.info(`NetworkPeer: Connected to ${this.toString()}`);
            this.sendHello();
        } else {
            this.conn.on("ready", () => {
                logger.info(`NetworkPeer: Connected to ${this.toString()}`);
                this.sendHello();
            });
        }
    }

    public close(): void {
        // Remove all listeners and timers to avoid memory leaks
        if (this.hashRequestTimer) {
            clearInterval(this.hashRequestTimer);
        }
        if (this.nodeRequestTimer) {
            clearInterval(this.nodeRequestTimer);
        }
        this.conn.close();

        // If we never got online, "resolve" the promise with undefined.
        // Rejecting it would be the cleaner choice, but then we'd need to catch
        // the rejection every single time and that just adds unnecessary complexity.
        this.onlinePromiseResolve(undefined);

        // Let the network manager know we're closed
        this.networkManager.handlePeerClosed(this);
    }

    logRxStats(message: Buffer, messageType: MessageClass) {
        this.stats.rx.totalPackets++;
        this.stats.rx.totalBytes += message.length;
        const packetTypeStats = this.stats.rx.packetTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.rx.packetTypes[messageType] = packetTypeStats;
    }

    logTxStats(message: Buffer, messageType: MessageClass) {
        this.stats.tx.totalPackets++;
        this.stats.tx.totalBytes += message.length;
        const packetTypeStats = this.stats.tx.packetTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.tx.packetTypes[messageType] = packetTypeStats;
    }

    private txMessage(message: Buffer) {
        this.logTxStats(message, message.readUInt8(NetConstants.PROTOCOL_VERSION_SIZE));
        this.conn.send(message);
    }

    /**
     * Handle an incoming message.
     * @param message The incoming message as a Buffer.
     */
    handleMessage(message: Buffer) {
        // maybe TODO: We currently don't enforce the HELLO message exchange.
        // If we want to do that, we can simple check for this.onlineFlag
        // on handling other messages.
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
            logger.error(`NetworkPeer: ${this.ip}:${this.port} error while handling message: ${err}`);
            // TODO: Maybe be a bit less harsh with the blacklisting on errors.
            // Maybe only blacklist repeat offenders, maybe remove blacklisting
            // after a defined timespan (increasing for repeat offenders)?
            // Blacklist entries based on IP/Port are especially sensitive
            // as the address could be reused by another node in a NAT environment.
            // this.networkManager.closeAndBlacklistPeer(this);
        }
    }

    sendHello() {
        logger.trace(`NetworkPeer: Sending HELLO to ${this.ip}:${this.port}`);
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.PEER_ID_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, 0);
        message.writeUInt8(MessageClass.Hello, 1);
        this.hostNodePeerID.copy(message, NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        this.txMessage(message);
    }

    handleHello(data: Buffer) {
        // receive peer ID
        const peerID: Buffer = data.subarray(0, NetConstants.PEER_ID_SIZE);
        if (peerID.length != NetConstants.PEER_ID_SIZE) {  // ID too short
            logger.info(`NetworkPeer: Received invalid peer ID sized ${peerID.length} bytes, should be ${NetConstants.PEER_ID_SIZE} bytes. Closing connection to ${this.ip}:${this.port}.`)
            this.close();
            return;
        }

        // Is this a spurious repeat HELLO?
        if (this._online) {
            // If the peer has unexpectedly changed its ID, disconnect.
            if (!this.id.equals(peerID)) {
                logger.info(`NetworkPeer: Peer at ${this.ip}:${this.port} suddenly changed its ID from ${this.id?.toString('hex')} to ${peerID.toString('hex')}, closing connection.`);
                this.close();
                return;
            } else {  // no unexpedted ID change
                logger.trace(`NetworkPeer: Received spurious repeat HELLO from ${this.ip}:${this.port}, ID ${this.id.toString('hex')}`);
            }
        } else {  // not a repeat hello
            logger.trace(`NetworkPeer: received HELLO from IP: ${this.ip}, port: ${this.port}, peerID: ${peerID.toString('hex')}, peer now considered online`);
            this.id = peerID;
            this._online = true;
            this.networkManager.handlePeerOnline(this);
            this.onlinePromiseResolve(this);  // let listeners know we learnt the peer's ID
        }

        // Asks for their know peers in regular intervals
        if (!this.nodeRequestTimer) {
            this.nodeRequestTimer = setInterval(() =>
                this.sendNodeRequest(), Settings.NODE_REQUEST_TIME);
        }
        // If we're a full node, ask for available cubes in regular intervals
        if (!this.lightMode && !this.hashRequestTimer) {
            this.hashRequestTimer = setInterval(() => this.sendHashRequest(),
                Settings.HASH_REQUEST_TIME);
        }
    }

    /**
     * Handle a HashRequest message.
     */
    handleHashRequest() {
        // Send MAX_CUBE_HASH_COUNT unsent hashes from unsentHashes
        const cubes: CubeMeta[] = [];
        const iterator: IterableIterator<CubeMeta> = this.unsentCubeMeta.values();
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

        logger.trace(`NetworkPeer: handleHashRequest: sending ${cubes.length} cube details to ${this.ip}:${this.port}`);
        this.txMessage(reply);
    }

    /**
     * Handle a HashResponse message.
     * @param data The HashResponse data.
     */
    handleHashResponse(data: Buffer) {
        const hashCount = data.readUInt32BE(0);
        logger.trace(`NetworkPeer: handleHashResponse: received ${hashCount} hashes from ${this.ip}:${this.port}`);
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
            } else {
                logger.info(`NetworkPeer: in handleHashResponse I saw a CubeType of ${cubeType}. I don't know what that is.`)
            }
        }
        // For each regular hash not in cube storage, request the cube
        const missingHashes: Buffer[] = regularCubeMeta.filter(detail => !this.cubeStore.hasCube(detail.key)).map(detail => detail.key);
        for (const muc of mucMeta) {
            // Request any MUC not in cube storage
            if (!this.cubeStore.hasCube(muc.key)) {
                missingHashes.push(muc.key);
            } else {
                // For each MUC in cube storage, identify winner and request if necessary
                const storedCube: CubeMeta = this.cubeStore.getCubeInfo(muc.key);
                try {
                    const winningCube: CubeMeta = cubeContest(storedCube, muc);
                    if (winningCube !== storedCube) {
                        missingHashes.push(muc.key);
                    }
                } catch(error) {
                    logger.info(`NetworkPeer: handleHashResponse(): Error handling incoming MUC ${muc.key} from peer ${this.toString()}: ${error}`);
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
            key => this.cubeStore.getCubeInfo(key));

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
        logger.trace(`NetworkPeer: handleCubeRequest: sending ${cubes.length} cubes to ${this.ip}:${this.port}`);
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
            const hash = await this.cubeStore.addCube(cubeData);
            if (!hash) {
                logger.error(`NetworkPeer: handleCubeResponse: failed to add cube ${hash}`);
                return;
            }
        }
        logger.info(`NetworkPeer: handleCubeResponse: received ${cubeCount} cubes from ${this.ip}:${this.port}`);
    }

    /**
      * Send a HashRequest message.
      */
    sendHashRequest() {
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, 0);
        message.writeUInt8(MessageClass.HashRequest, 1);
        logger.trace(`NetworkPeer: sendHashRequest: sending HashRequest to ${this.ip}:${this.port}`);
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
        logger.trace(`NetworkPeer: sendCubeRequest: sending CubeRequest for ${hashes.length} cubes to ${this.ip}:${this.port}`);
        this.txMessage(message);
    }

    sendNodeRequest() {
        // Determine message length
        const msgLength = NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE;
        // Prepare message
        const message = Buffer.alloc(msgLength);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.NodeRequest, offset++);
        logger.trace(`NetworkPeer: sendNodeRequest: sending NodeRequest to ${this.ip}:${this.port}`);
        this.txMessage(message);
    }

    handleNodeRequest() {
        // Send MAX_NODE_ADDRESS_COUNT peer addresses
        // ... do we even know that many?
        let numberToSend: number;
        if (this.unsentPeers.length >= NetConstants.MAX_NODE_ADDRESS_COUNT) {
            numberToSend = NetConstants.MAX_NODE_ADDRESS_COUNT;
        } else {
            numberToSend = this.unsentPeers.length;
        }
        // Select random peers in random order
        const chosenPeers: Array<Peer> = [];
        for (let i = 0; i < numberToSend; i++) {
            const rnd = Math.floor(Math.random() * this.unsentPeers.length);
            chosenPeers.push(this.unsentPeers[rnd]);
            this.unsentPeers.slice(rnd, 1);
        }
        // Determine message length
        let msgLength = NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.COUNT_SIZE;
        for (let i = 0; i < numberToSend; i++) {
            msgLength += 2;  // for the node address length field
            msgLength += chosenPeers[i].addressString.length;
        }
        // Prepare message
        const message = Buffer.alloc(msgLength);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.NodeResponse, offset++);
        message.writeUIntBE(numberToSend, offset, NetConstants.COUNT_SIZE); offset += NetConstants.COUNT_SIZE;
        for (const peer of chosenPeers) {
            message.writeUInt16BE(peer.addressString.length, offset);
            offset += 2;
            message.write(peer.addressString, offset, peer.addressString.length, 'ascii');
            offset += peer.addressString.length;
        }
        logger.trace(`NetworkPeer: handleNodeRequest: sending ${numberToSend} peer addresses to ${this.ip}:${this.port}`);
        this.txMessage(message);
    }

    handleNodeResponse(message: Buffer) {
        let offset = 0;
        const peerCount: number = message.readUIntBE(offset, NetConstants.COUNT_SIZE);
        offset += NetConstants.COUNT_SIZE;
        for (let i = 0; i < peerCount; i++) {
            const addressLength: number = message.readUint16BE(offset);
            offset += 2;
            const peerAddress = message.subarray(offset, offset + addressLength);
            offset += addressLength;

            // prepare peer object
            const [peerIp, peerPort] = peerAddress.toString('ascii').split(':');
            if (!peerIp || !peerPort) continue;  // ignore invalid
            const peer: Peer = new Peer(new WebSocketAddress(peerIp, parseInt(peerPort)));

            // register peer
            this.networkManager.getPeerDB().learnPeer(peer);
            logger.info(`NetworkPeer: Received peer ${peerIp}:${peerPort} from ${this.toString()}`);
        }
    }
}

export class NetworkError extends VerityError  {}
export class AddressError extends NetworkError {}
