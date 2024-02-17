import { Settings, VerityError } from '../settings';
import { MessageClass, NetConstants, SupportedTransports } from './networkDefinitions';

import { CubeStore } from '../cube/cubeStore';
import { CubeInfo, CubeMeta } from '../cube/cubeInfo';
import { WebSocketAddress, AddressAbstraction } from '../peering/addressing';
import { Peer } from '../peering/peer';
import { NetworkManager } from "./networkManager";
import { CubeType } from '../cube/cubeDefinitions';
import { cubeContest } from '../cube/cubeUtil';
import { NetworkPeerConnection } from './networkPeerConnection';

import { logger } from '../logger';

import WebSocket from 'isomorphic-ws';
import { Buffer } from 'buffer';
import { Multiaddr } from '@multiformats/multiaddr'
import { unixtime } from '../helpers';

export interface PacketStats {
    count: number,
    bytes: number
}

export interface NetworkStats {
    tx: {
        sentMessages: number,
        messageBytes: number,
        messageTypes: { [key in MessageClass]?: PacketStats }
    },
    rx: {
        receivedMessages: number,
        messageBytes: number,
        messageTypes: { [key in MessageClass]?: PacketStats }
    }
}

/**
 * Class representing a network peer, responsible for handling incoming and outgoing messages.
 */
// TODO: This should arguably encapsulate Peer instead of inheriting from it
export class NetworkPeer extends Peer {
    stats: NetworkStats = {
        tx: { sentMessages: 0, messageBytes: 0, messageTypes: {} },
        rx: { receivedMessages: 0, messageBytes: 0, messageTypes: {} },
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

    get conn(): NetworkPeerConnection { return this._conn }

    private networkTimeout: NodeJS.Timeout = undefined;

    constructor(
            private networkManager: NetworkManager,
            address: WebSocketAddress | Multiaddr | AddressAbstraction[],
            private cubeStore: CubeStore,  // The cube storage instance associated with this peer
            private hostNodePeerID: Buffer,
            private _conn: NetworkPeerConnection,
            private lightMode: boolean = false,
            private peerExchange: boolean = true,
            private networkTimeoutSecs: number = Settings.NETWORK_TIMEOUT
        )
    {
        super(address);
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
        networkManager.peerDB.on(
            'exchangeablePeer', (peer: Peer) => this.learnExchangeablePeer(peer));

        // Send HELLO message once connected
        this.setTimeout();  // connection timeout
        this.conn.readyPromise.then(() => {
            clearTimeout(this.networkTimeout);  // clear connection timeout
            logger.info(`NetworkPeer ${this.toString()}: Connected, I'll go ahead and say HELLO`);
            this.sendHello();
        });
    }

    public close(): Promise<void> {
        logger.trace(`NetworkPeer ${this.toString()}: Closing connection.`);
        this._online = false;
        // Remove all listeners and timers to avoid memory leaks
        this.networkManager.peerDB.removeListener(
            'exchangeablePeer', (peer: Peer) => this.learnExchangeablePeer(peer));
        this.cubeStore.removeListener(
            'cubeAdded', (cube: CubeMeta) => this.unsentCubeMeta.add(cube));
        clearInterval(this.keyRequestTimer);
        clearInterval(this.nodeRequestTimer);
        clearTimeout(this.networkTimeout);

        // Close our connection object.
        // Note: this means conn.close() gets called twice when closure
        // originates from the conn, but that's okay.
        const closedPromise: Promise<void> = this._conn.close();

        // If we never got online, "resolve" the promise with undefined.
        // Rejecting it would be the cleaner choice, but then we'd need to catch
        // the rejection every single time and we really don't care that much.
        this.onlinePromiseResolve(undefined);

        // Let the network manager know we're closed
        this.networkManager.handlePeerClosed(this);
        return closedPromise;
    }

    private logRxStats(message: Buffer, messageType: MessageClass): void {
        this.stats.rx.receivedMessages++;
        this.stats.rx.messageBytes += message.length;
        const packetTypeStats = this.stats.rx.messageTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.rx.messageTypes[messageType] = packetTypeStats;
    }

    private logTxStats(message: Buffer, messageType: MessageClass): void {
        this.stats.tx.sentMessages++;
        this.stats.tx.messageBytes += message.length;
        const packetTypeStats = this.stats.tx.messageTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.tx.messageTypes[messageType] = packetTypeStats;
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
        // Mark peer alive
        // maybe TODO: maybe we should only mark a peer alive *after* we tried
        // parsing their message?
        this.lastSuccessfulConnection = unixtime();
        this.scoreMessage();
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
                    try {  // non-essential feature (for us at least... for them it's rather essential, but we don't care :D)
                        this.handleKeyRequest();
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a NodeRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.KeyResponse:
                    this.handleKeyResponse(messageContent);
                    break;
                case MessageClass.CubeRequest:
                    try {  // non-essential feature
                        this.handleCubeRequest(messageContent);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a CubeRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.CubeResponse:
                    this.handleCubeResponse(messageContent);
                    break;
                case MessageClass.MyServerAddress:
                    try {  // non-essential feature
                        this.handleServerAddress(messageContent);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a MyServerAddress message because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.NodeRequest:
                    try {  // non-essential feature
                        this.handleNodeRequest();
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a NodeRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.NodeResponse:
                    try {  // non-essential feature
                        this.handleNodeResponse(messageContent);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a NodeResponse because an error occurred processing it: ${err}`);
                        // TODO: This should make this peer ineligible for peer exchange, at least for a while
                        break;
                    }
                default:
                    logger.warn(`NetworkPeer ${this.toString()}: Ignoring message with unknown class: ${messageClass}`);
                    break;
            }
        } catch (err) {
            this.scoreInvalidMessage();
            logger.info(`NetworkPeer ${this.toString()}: error while handling message: ${err}; stack trace: ${err.stack}`);
            // blacklist repeat offenders based on local trust score
            if (!this.isTrusted) this.networkManager.closeAndBlacklistPeer(this);
            // Maybe we should remove blacklisting
            // after a defined timespan (increasing for repeat offenders)?
            // Blacklist entries based on IP/Port are especially sensitive
            // as the address could be reused by another node in a NAT environment.
        }
    }

    private sendHello(): void {
        logger.trace(`NetworkPeer ${this.toString()}: Sending HELLO`);
        const message = Buffer.alloc(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.PEER_ID_SIZE);
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, 0);
        message.writeUInt8(MessageClass.Hello, 1);
        this.hostNodePeerID.copy(
            message,  // target
            NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE,  // target offset
            0,  // source offset
            NetConstants.PEER_ID_SIZE,  // source length
        );
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

            // Let the network manager know this peer is now online.
            // Abort if the network manager gives us a thumbs down on the peer.
            if (!this.networkManager.handlePeerOnline(this)) return;
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
        const regularCubeInfo: CubeInfo[] = [];
        const mucInfo: CubeInfo[] = [];

        let offset = NetConstants.COUNT_SIZE;
        for (let i = 0; i < keyCount; i++) {
            const cubeType = data.readUInt8(offset++);
            const challengeLevel = data.readUInt8(offset++);
            // Read timestamp as a 5-byte number
            const timestamp = data.readUIntBE(offset, NetConstants.TIMESTAMP_SIZE);
            offset += NetConstants.TIMESTAMP_SIZE;
            const hash = data.slice(offset, offset + NetConstants.CUBE_KEY_SIZE);
            offset += NetConstants.CUBE_KEY_SIZE;
            const incomingCubeInfo = new CubeInfo({
                key: hash,
                date: timestamp,
                challengeLevel: challengeLevel,
                cubeType: cubeType
            });

            if (cubeType === CubeType.BASIC) {
                regularCubeInfo.push(incomingCubeInfo);
            } else if (cubeType === CubeType.MUC) {
                mucInfo.push(incomingCubeInfo);
            } else {
                logger.info(`NetworkPeer ${this.toString()}: in handleKeyResponse I saw a CubeType of ${cubeType}. I don't know what that is.`)
            }
        }
        // For each regular key not in cube storage, request the cube
        const missingKeys: Buffer[] = regularCubeInfo.filter(detail => !this.cubeStore.hasCube(detail.key)).map(detail => detail.key);
        for (const muc of mucInfo) {
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
                    logger.info(`NetworkPeer ${this.toString()}: handleKeyResponse(): Error handling incoming MUC ${muc.keystring}: ${error}`);
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
            // Grant this peer local reputation if cube is accepted.
            // TODO BUGBUG: This currently grants reputation score for duplicates,
            // which is absolutely contrary to what we want :'D
            this.cubeStore.addCube(cubeData)
                .then((value) => {
                    if(value) { this.scoreReceivedCube(value.getDifficulty()); }
                });
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
            messageContent.subarray(offset, offset+length).toString('ascii');
        offset += length;
        if (type == SupportedTransports.ws && addrString.substring(0,2) == "::") {
            // HACKHACK Handle special case: If the remote peer did not indicate it's
            // IP address (but instead identifies as "::" which is "any" in IPv6
            // notation), substitute this by the IP address we're currently
            // using for this peer.
            // It's a bad solution implemented in ugly code.
            // But we mostly get around the fact that NATed nodes don't
            // know their own address but might know their port.
            this.addAddress(
                new WebSocketAddress(this.ip, Number.parseInt(addrString.substring(3))),
                true);  // learn address and make primary
        } else {
            const address = AddressAbstraction.CreateAddress(addrString, type);
            this.addAddress(address, true);  // learn address and make primary
        }
        this.networkManager.handlePeerUpdated(this);
    }

    // TODO generalize: We should be allowed to have and send multiple server addresses
    // In particular, nodes offering plan WS and Libp2p sockets should always
    // advertise both of them, as non-libp2p enabled nodes will obviously need
    // the former and libp2p-enabled nodes must prefer the latter in order to
    // use libp2p features such as WebRTC brokering.
    sendMyServerAddress() {
        let address: AddressAbstraction = undefined;
        // maybe TODO: only send address of same transport type
        for (const [transportType, transport] of this.networkManager.transports) {
            if (transport.dialableAddress) address = transport.dialableAddress;
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

    get addressString(): string {
        return this.conn?.addressString ?? this.address.toString();
    }
    toString() {
        return `${this.addressString} (ID#${this._id?.toString('hex')})`;
    }
    toLongString() {
        let ret: string = "";
        ret += "NetworkPeer ID#" + this.idString + " connected through " + this.conn?.toString();
        if (this.addresses.length) {
            ret += ", addresses:\n";
            for (let i=0; i<this.addresses.length; i++) {
                ret += ` ${i}) ${this.addresses[i].toString()}`;
                if (i == this._primaryAddressIndex) ret += " (primary)\n";
                else ret += '\n';
            }
        }
        return ret;
    }

    // TODO: Don't send private addresses to peer off our private network
    //       (but do still send them to peers on our private network!)
    // TODO: Provide for a "no-reshare" flag on shared addresses.
    //       This will be useful for libp2p browser nodes: A connected browser
    //       node is, in theory, able to broker a connection to one of their
    //       connected browser nodes for us. They can only do this for their
    //       directly connected nodes though, so re-sharing this kind of address
    //       is completely useless.
    //       Having browser nodes broker connections amongst themselves has the
    //       potential of dramatically reducing connection brokering load on
    //       server nodes as they may -- again, in theory -- only need to
    //       bootstrap a single connection for each browser node.
    // TODO: Prefer exchanging known good nodes rather than long-dead garbage.
    private handleNodeRequest(): void {
        // Select random peers in random order, up to MAX_NODE_ADDRESS_COUNT of them.
        // TODO move selection process to PeerDB where it belongs
        const chosenPeers: Array<Peer> = [];
        while(chosenPeers.length < NetConstants.MAX_NODE_ADDRESS_COUNT &&
              this.unsentPeers.length > 0) {
            const rnd = Math.floor(Math.random() * this.unsentPeers.length);
            // Only exchange peers with passable local trust score
            if (this.unsentPeers[rnd].isTrusted ) {
                chosenPeers.push(this.unsentPeers[rnd]);
                logger.trace(`NetworkPeer ${this.toString()} will receive peer ${this.unsentPeers[rnd]} with trust score ${this.unsentPeers[rnd].trustScore} from us.`)
            } else {
                logger.trace(`NetworkPeer ${this.toString()} will not be shared peer ${this.unsentPeers[rnd]} due to insufficient score ${this.unsentPeers[rnd].trustScore}`)
            }
            this.unsentPeers.splice(rnd, 1);
        }
        // Determine message length
        let msgLength = NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE + NetConstants.COUNT_SIZE;
        for (let i = 0; i < chosenPeers.length; i++) {
            msgLength += 1;  // for the address type field
            msgLength += 2;  // for the node address length field
            msgLength += chosenPeers[i].address.toString().length;
        }
        // Prepare message
        const message = Buffer.alloc(msgLength);
        let offset = 0;
        message.writeUInt8(NetConstants.PROTOCOL_VERSION, offset++);
        message.writeUInt8(MessageClass.NodeResponse, offset++);
        message.writeUIntBE(chosenPeers.length, offset, NetConstants.COUNT_SIZE); offset += NetConstants.COUNT_SIZE;
        for (const peer of chosenPeers) {
            message.writeUInt8(peer.address.type, offset++);
            message.writeUInt16BE(peer.address.toString().length, offset);
            offset += 2;
            message.write(peer.address.toString(), offset, peer.address.toString().length, 'ascii');
            offset += peer.address.toString().length;
        }
        logger.trace(`NetworkPeer ${this.toString()}: handleNodeRequest: sending them ${chosenPeers.length} peer addresses`);
        this.txMessage(message);
    }

    // TODO: don't exchange stale nodes... maybe only exchange nodes that we've
    // successfully connected in the last hour or so
    // TODO: ask our transports for exchangeable nodes -- for libp2p, browser nodes
    // can and should act as connection brokers for their directly connected peers;
    // this kind of private brokering however never yields any kind of publicly
    // reachable peer address
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
        if (this.networkTimeoutSecs) {
            this.networkTimeout = setTimeout(() => {
                    logger.info(`NetworkPeer ${this.toString()} timed out a request, closing.`);
                    this.close()
                }, Settings.NETWORK_TIMEOUT);
        }
    }
}
