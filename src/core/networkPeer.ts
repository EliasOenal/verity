import { MessageClass, NetConstants, SupportedTransports } from './networkDefinitions';
import { Settings, VerityError } from './config';

import { CubeStore } from './cubeStore';
import { CubeInfo, CubeMeta } from './cubeInfo';
import { WebSocketAddress, Peer, AddressAbstraction } from './peerDB';
import { NetworkManager } from "./networkManager";
import { CubeType } from './cubeDefinitions';
import { cubeContest } from './cubeUtil';
import { NetworkPeerConnection } from './networkPeerConnection';

import { logger } from './logger';

import WebSocket from 'isomorphic-ws';
import { Buffer } from 'buffer';
import { Multiaddr } from '@multiformats/multiaddr'

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
 * Class representing a network peer, responsible for handling incoming and outgoing messages.
 */
export class NetworkPeer extends Peer {
    stats: NetworkStats = {
        tx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
        rx: { totalPackets: 0, totalBytes: 0, packetTypes: {} },
    }
    keyRequestTimer?: NodeJS.Timeout = undefined; // Timer for key requests
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

    private _conn: NetworkPeerConnection = undefined;
    get conn(): NetworkPeerConnection { return this._conn }

    private networkTimeout: NodeJS.Timeout;

    constructor(
            private networkManager: NetworkManager,
            address: WebSocketAddress | Multiaddr | AddressAbstraction[],
            private cubeStore: CubeStore,  // The cube storage instance associated with this peer
            private hostNodePeerID: Buffer,
            conn: NetworkPeerConnection | WebSocket = undefined,
            private lightMode: boolean = false,
            private peerExchange: boolean = true
        )
    {
        super(address);
        if (conn instanceof NetworkPeerConnection) {
            this._conn = conn;
        } else {  // WebSocketAddress (or invalid)
            this._conn = NetworkPeerConnection.Create(this.address);
        }
        this._conn.on("messageReceived", msg => this.handleMessage(msg));
        this._conn.once("closed", () => this.close());

        // Take note of all cubes I could share with this new peer. While the
        // connection lasts, supplement this with any newly learned cubes.
        // This is used to ensure we don't offer peers the same cube twice.
        this.unsentCubeMeta = cubeStore.getAllStoredCubeMeta();
        cubeStore.on('cubeAdded', (cube: CubeMeta) => this.unsentCubeMeta.add(cube));

        // Take note of all other peers I could exchange with this new peer.
        // This is used to ensure we don't exchange the same peers twice.
        this.unsentPeers = Array.from(this.networkManager.peerDB.peersExchangeable.values());  // TODO: there's really no reason to convert to array here
        networkManager.peerDB.on('exchangeablePeer', (peer: Peer) => this.learnExchangeablePeer(peer));

        // Send HELLO message once connected
        if (this._conn.ready()) {
            logger.info(`NetworkPeer ${this.toString()}: Connected`);
            this.sendHello();
        } else {
            this.setTimeout();
            // On ready, cancel the timeout and send HELLO
            this._conn.on("ready", () => {
                clearTimeout(this.networkTimeout);
                logger.info(`NetworkPeer ${this.toString()}: Connected`);
                this.sendHello();
            });

        }
    }

    public close(): Promise<void> {
        logger.trace(`NetworkPeer ${this.toString()}: Closing connection.`);
        // Remove all listeners and timers to avoid memory leaks
        this.networkManager.peerDB.removeListener(
            'peerVerified', (peer: Peer) => this.learnExchangeablePeer(peer));
        this.cubeStore.removeListener(
            'cubeAdded', (cube: CubeMeta) => this.unsentCubeMeta.add(cube));
        if (this.keyRequestTimer) clearInterval(this.keyRequestTimer);
        if (this.nodeRequestTimer) clearInterval(this.nodeRequestTimer);
        if (this.networkTimeout) clearTimeout(this.networkTimeout);

        // Close our connection object.
        // Note: this means conn.close() gets called twice when closure
        // originates from the conn, but that's okay.
        const closedPromise: Promise<void> = this._conn.close();

        // If we never got online, "resolve" the promise with undefined.
        // Rejecting it would be the cleaner choice, but then we'd need to catch
        // the rejection every single time and that just adds unnecessary complexity.
        this.onlinePromiseResolve(undefined);

        // Let the network manager know we're closed
        this.networkManager.handlePeerClosed(this);
        return closedPromise;
    }

    private logRxStats(message: Buffer, messageType: MessageClass): void {
        this.stats.rx.totalPackets++;
        this.stats.rx.totalBytes += message.length;
        const packetTypeStats = this.stats.rx.packetTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.rx.packetTypes[messageType] = packetTypeStats;
    }

    private logTxStats(message: Buffer, messageType: MessageClass): void {
        this.stats.tx.totalPackets++;
        this.stats.tx.totalBytes += message.length;
        const packetTypeStats = this.stats.tx.packetTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.tx.packetTypes[messageType] = packetTypeStats;
    }

    private txMessage(message: Buffer): void {
        this.logTxStats(message, message.readUInt8(NetConstants.PROTOCOL_VERSION_SIZE));
        this._conn.send(message);
    }

    /**
     * Handle an incoming message.
     * @param message The incoming message as a Buffer.
     */
    private handleMessage(message: Buffer): void {
        // Reset and timeout that might have been set, peer obviously alive
        clearTimeout(this.networkTimeout);
        // maybe TODO: We currently don't enforce the HELLO message exchange.
        // If we want to do that, we can simple check for this.onlineFlag
        // on handling other messages.
        try {
            const messageClass = message.readUInt8(NetConstants.PROTOCOL_VERSION_SIZE);
            const messageContent = message.subarray(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
            // logger.trace(`NetworkPeer ${this.toString()}: handleMessage() messageClass: ${MessageClass[messageClass]}`);
            this.logRxStats(message, messageClass);

            // Process the message based on its class
            switch (messageClass) {
                case MessageClass.Hello:
                    this.handleHello(messageContent);
                    break;
                case MessageClass.KeyRequest:
                    this.handleKeyRequest();
                    break;
                case MessageClass.KeyResponse:
                    this.handleKeyResponse(messageContent);
                    break;
                case MessageClass.CubeRequest:
                    this.handleCubeRequest(messageContent);
                    break;
                case MessageClass.CubeResponse:
                    this.handleCubeResponse(messageContent);
                    break;
                case MessageClass.MyServerAddress:
                    this.handleServerAddress(messageContent);
                    break;
                case MessageClass.NodeRequest:
                    this.handleNodeRequest();
                    break;
                case MessageClass.NodeResponse:
                    this.handleNodeResponse(messageContent);
                    break;
                default:
                    logger.warn(`NetworkPeer ${this.toString()}: Received message with unknown class: ${messageClass}`);
            }
        } catch (err) {
            logger.info(`NetworkPeer ${this.toString()}: error while handling message: ${err}`);
            // TODO: Maybe be a bit less harsh with the blacklisting on errors.
            // Maybe only blacklist repeat offenders, maybe remove blacklisting
            // after a defined timespan (increasing for repeat offenders)?
            // Blacklist entries based on IP/Port are especially sensitive
            // as the address could be reused by another node in a NAT environment.
            // this.networkManager.closeAndBlacklistPeer(this);
        }
    }

    private sendHello(): void {
        logger.trace(`NetworkPeer ${this.toString()}: Sending HELLO`);
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.PEER_ID_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, 0);
        message.writeUInt8(MessageClass.Hello, 1);
        this.hostNodePeerID.copy(message, NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        this.txMessage(message);
    }

    private handleHello(data: Buffer): void {
        // receive peer ID
        const peerID: Buffer = data.subarray(0, NetConstants.PEER_ID_SIZE);
        if (peerID.length != NetConstants.PEER_ID_SIZE) {  // ID too short
            logger.info(`NetworkPeer ${this.toString()}: Received invalid peer ID sized ${peerID.length} bytes, should be ${NetConstants.PEER_ID_SIZE} bytes. Closing connection.`)
            this.close();
            return;
        }

        // Is this a spurious repeat HELLO?
        if (this._online) {
            // If the peer has unexpectedly changed its ID, disconnect.
            if (!this.id.equals(peerID)) {
                logger.info(`NetworkPeer ${this.toString()} suddenly changed its ID from ${this.id?.toString('hex')} to ${peerID.toString('hex')}, closing connection.`);
                this.close();
                return;
            } else {  // no unexpected ID change, just a spurious HELLO to be ignored
                logger.trace(`NetworkPeer ${this.toString()}: Received spurious repeat HELLO`);
            }
        } else {  // not a repeat hello
            this._id = peerID;
            this._online = true;
            logger.trace(`NetworkPeer ${this.toString()}: received HELLO, peer now considered online`);
            this.networkManager.handlePeerOnline(this);
            this.onlinePromiseResolve(this);  // let listeners know we learnt the peer's ID
        }
        // Send my publicly reachable address if I have one
        this.sendMyServerAddress();

        // Asks for their know peers in regular intervals
        if (!this.nodeRequestTimer) {
            this.nodeRequestTimer = setInterval(() =>
                this.sendNodeRequest(), Settings.NODE_REQUEST_TIME);
        }
        // If we're a full node, ask for available cubes in regular intervals
        if (!this.lightMode && !this.keyRequestTimer) {
            this.keyRequestTimer = setInterval(() => this.sendKeyRequest(),
                Settings.KEY_REQUEST_TIME);
        }
    }

    /**
     * Handle a KeyRequest message.
     */
    private handleKeyRequest(): void {
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
        reply.writeUInt8(MessageClass.KeyResponse, offset++);
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

        logger.trace(`NetworkPeer ${this.toString()}: handleKeyRequest: sending ${cubes.length} cube details`);
        this.txMessage(reply);
    }

    /**
     * Handle a HashResponse message.
     * @param data The HashResponse data.
     */
    private handleKeyResponse(data: Buffer): void {
        const keyCount = data.readUInt32BE(0);
        logger.trace(`NetworkPeer ${this.toString()}: handleKeyResponse: received ${keyCount} keys`);
        const regularCubeMeta: CubeMeta[] = [];
        const mucMeta = [];

        let offset = NetConstants.COUNT_SIZE;
        for (let i = 0; i < keyCount; i++) {
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
                logger.info(`NetworkPeer ${this.toString()}: in handleKeyResponse I saw a CubeType of ${cubeType}. I don't know what that is.`)
            }
        }
        // For each regular key not in cube storage, request the cube
        const missingKeys: Buffer[] = regularCubeMeta.filter(detail => !this.cubeStore.hasCube(detail.key)).map(detail => detail.key);
        for (const muc of mucMeta) {
            // Request any MUC not in cube storage
            if (!this.cubeStore.hasCube(muc.key)) {
                missingKeys.push(muc.key);
            } else {
                // For each MUC in cube storage, identify winner and request if necessary
                const storedCube: CubeMeta = this.cubeStore.getCubeInfo(muc.key);
                try {
                    const winningCube: CubeMeta = cubeContest(storedCube, muc);
                    if (winningCube !== storedCube) {
                        missingKeys.push(muc.key);
                    }
                } catch(error) {
                    logger.info(`NetworkPeer ${this.toString()}: handleKeyResponse(): Error handling incoming MUC ${muc.key}: ${error}`);
                }
            }
        }
        if (missingKeys.length > 0) {
            this.sendCubeRequest(missingKeys);
        }
    }

    /**
     * Handle a CubeRequest message.
     * @param data The CubeRequest data.
     */
    private handleCubeRequest(data: Buffer): void {
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
        logger.trace(`NetworkPeer ${this.toString()}: handleCubeRequest: sending ${cubes.length} cubes`);
        this.txMessage(reply);
    }

    /**
     * Handle a CubeResponse message.
     * @param data The CubeResponse data.
     */
    // TODO: If we're a light node, make sure we actually requested those
    private handleCubeResponse(data: Buffer): void {
        const cubeCount = data.readUInt32BE(0);
        for (let i = 0; i < cubeCount; i++) {
            const cubeData = data.slice(NetConstants.COUNT_SIZE + i * NetConstants.CUBE_SIZE,
                NetConstants.COUNT_SIZE + (i + 1) * NetConstants.CUBE_SIZE);

            // Add the cube to the CubeStorage
            // If this fails, CubeStore will log an error and we will ignore this cube.
            this.cubeStore.addCube(cubeData);
        }
        logger.info(`NetworkPeer ${this.toString()}: handleCubeResponse: received ${cubeCount} cubes`);
    }

    /**
     * Handles a MyServerAddress message, which is a remote (incoming) peer's
     * way of telling us their publicly reachable address, making them eligible
     * for peer exchange.
     */
    private handleServerAddress(messageContent: Buffer): void {
        let offset = 0;
        const type: SupportedTransports = messageContent.readUInt8(offset++);
        const length: number = messageContent.readUInt16BE(offset); offset += 2;
        let addrString: string =
            messageContent.subarray(offset, messageContent.length).toString('ascii');
        if (type == SupportedTransports.ws && addrString.substring(0,2) == "::") {
            // Handle special case: If the remote peer did not indicate it's
            // IP address (but instead identifies as "::" which is "any" in IPv6
            // notation), substitute this by the IP address we're currently
            // using for this peer.
            // This way we mostly get around the fact that NATed nodes don't
            // know their own address -- but they might know their port.
            addrString = this.ip + addrString.substring(2);
        }
        const address = AddressAbstraction.CreateAddress(addrString, type);
        this.addAddress(address, true);  // learn address and make primary

        // TODO: Verify this address is in fact reachable, e.g. by making a test
        // connection.
        this.networkManager.peerDB.markPeerExchangeable(this);  // this might be a lie
    }

    // TODO generalize: We should be allowed to have and send multiple server addresses
    sendMyServerAddress() {
        let address: AddressAbstraction = undefined;
        for (const server of this.networkManager.servers) {
            if (server.dialableAddress) address = server.dialableAddress;
            break;
        }
        if (!address) return;
        const addressString: string = address.toString();
        const message = Buffer.alloc(
            NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE +
            1 + // type -- todo parametrize
            2 + // address length -- todo parametrize
            addressString.length);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.MyServerAddress, offset++);
        message.writeUInt8(address.type, offset++);
        message.writeUInt16BE(addressString.length, offset); offset += 2;
        message.write(addressString, offset, 'ascii'); offset += addressString.length;
        logger.trace(`NetworkPeer ${this.toString()}: sending them MyServerAddress ${address}`);
        this.txMessage(message);
    }

    /**
      * Send a KeyRequest message.
      */
    sendKeyRequest(): void {
        // Prepare message
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, NetConstants.PROTOCOL_VERSION);
        message.writeUInt8(MessageClass.KeyRequest, 1);
        logger.trace(`NetworkPeer ${this.toString()}: sending KeyRequest`);
        // Set connection timeout and send message
        this.setTimeout();
        this.txMessage(message);
    }

    /**
     * Send a CubeRequest message.
     * @param hashes The list of cube hashes to request.
     */
    sendCubeRequest(hashes: Buffer[]): void {
        // Prepare message
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
        logger.trace(`NetworkPeer ${this.toString()}: sending CubeRequest for ${hashes.length} cubes`);
        // Set connection timeout and send message
        this.setTimeout();
        this.txMessage(message);
    }

    sendNodeRequest(): void {
        if (!this.peerExchange) return;  // don't do anything if opted out
        // Determine message length
        const msgLength = NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE;
        // Prepare message
        const message = Buffer.alloc(msgLength);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.NodeRequest, offset++);
        logger.trace(`NetworkPeer ${this.toString()}: sending NodeRequest`);
        // Not setting timeout for this message: A peer not participating in
        // node exchange is neither necessarily dead nor invalid.
        this.txMessage(message);
    }

    private handleNodeRequest(): void {
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
            msgLength += 1;  // for the address type field
            msgLength += 2;  // for the node address length field
            msgLength += chosenPeers[i].address.toString().length;
        }
        // Prepare message
        const message = Buffer.alloc(msgLength);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.NodeResponse, offset++);
        message.writeUIntBE(numberToSend, offset, NetConstants.COUNT_SIZE); offset += NetConstants.COUNT_SIZE;
        for (const peer of chosenPeers) {
            message.writeUInt8(peer.address.type, offset++);
            message.writeUInt16BE(peer.address.toString().length, offset);
            offset += 2;
            message.write(peer.address.toString(), offset, peer.address.toString().length, 'ascii');
            offset += peer.address.toString().length;
        }
        logger.trace(`NetworkPeer ${this.toString()}: handleNodeRequest: sending them ${numberToSend} peer addresses`);
        this.txMessage(message);
    }

    private handleNodeResponse(message: Buffer): void {
        let offset = 0;
        const peerCount: number = message.readUIntBE(offset, NetConstants.COUNT_SIZE);
        offset += NetConstants.COUNT_SIZE;
        for (let i = 0; i < peerCount; i++) {
            // read address
            const addressType: SupportedTransports = message.readUInt8(offset++);
            const addressLength: number = message.readUint16BE(offset);
            offset += 2;
            const peerAddress = message.subarray(offset, offset + addressLength);
            offset += addressLength;

            // register peer
            const addressAbstraction: AddressAbstraction = AddressAbstraction.CreateAddress(
                peerAddress.toString(), addressType);
            if (!addressAbstraction) {
                logger.info(`NetworkPeer ${this.toString()}: Received *invalid* peer address ${peerAddress.toString()}`);
                continue;
            }
            logger.info(`NetworkPeer ${this.toString()}: Received peer ${peerAddress.toString()} (which we parsed to ${addressAbstraction.toString()})`);
            const peer: Peer = new Peer(addressAbstraction);
            this.networkManager.peerDB.learnPeer(peer);
        }
    }

    private learnExchangeablePeer(peer: Peer): void {
        if (!this.equals(peer)) {  // but don't share a peer with itself
            this.unsentPeers.push(peer);
        }
    }

    private setTimeout(): void {
        // Getting strange timeouts, deactivating for now
        // this.networkTimeout = setTimeout(() => {
        //         logger.info(`NetworkPeer ${this.toString()} timed out a request, closing.`);
        //         this.close()
        //     }, Settings.NETWORK_TIMEOUT);
    }
}
