import { Settings } from '../settings';
import { MessageClass, NetConstants, SupportedTransports } from './networkDefinitions';
import { unixtime } from '../helpers';
import { CubeRequestMessage, CubeResponseMessage, HelloMessage, KeyRequestMessage, KeyResponseMessage, NetworkMessage, PeerRequestMessage, PeerResponseMessage, ServerAddressMessage } from './networkMessage';

import { CubeStore } from '../cube/cubeStore';
import { CubeInfo, CubeMeta } from '../cube/cubeInfo';
import { WebSocketAddress, AddressAbstraction } from '../peering/addressing';
import { Peer } from '../peering/peer';
import { NetworkManager } from "./networkManager";
import { CubeKey, CubeType } from '../cube/cubeDefinitions';
import { cubeContest } from '../cube/cubeUtil';
import { TransportConnection } from './transport/transportConnection';
import { getCurrentEpoch, shouldRetainCube } from '../cube/cubeUtil';

import { logger } from '../logger';

import { Buffer } from 'buffer';

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

export interface NetworkPeerOptions {
    extraAddresses?: AddressAbstraction[],
    lightNode?: boolean,
    autoRequest: boolean,
    peerExchange?: boolean,
    networkTimeoutSecs?: number,
}

export enum NetworkPeerLifecycle {
    CONNECTING = 1,
    HANDSHAKING = 2,
    ONLINE = 3,
    CLOSING = 4,
    CLOSED = 5,
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
    peerRequestTimer?: NodeJS.Timeout = undefined; // Timer for node requests

    private _status: NetworkPeerLifecycle = NetworkPeerLifecycle.CONNECTING;
    get status(): NetworkPeerLifecycle { return this._status }

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
    get online() { return this._status === NetworkPeerLifecycle.ONLINE; }

    private unsentCubeMeta: Set<CubeMeta> = new Set();
    private unsentPeers: Peer[] = undefined;  // TODO this should probably be a Set instead

    get conn(): TransportConnection { return this._conn }

    private networkTimeout: NodeJS.Timeout = undefined;
    private lightNode: boolean;
    private autoRequest: boolean;
    private peerExchange: boolean = true;
    private networkTimeoutSecs: number = Settings.NETWORK_TIMEOUT;

    constructor(
            private networkManager: NetworkManager,
            private _conn: TransportConnection,
            private cubeStore: CubeStore,
            options: NetworkPeerOptions,
        )
    {
        super(_conn.address);
        // set opts
        this.lightNode = options?.lightNode ?? true;
        this.autoRequest = options?.autoRequest ?? false;
        this.peerExchange = options?.peerExchange ?? true;
        this.networkTimeoutSecs = options?.networkTimeoutSecs ?? Settings.NETWORK_TIMEOUT;
        if (options.extraAddresses) {
            this.addresses = options.extraAddresses;
            this.addAddress(_conn.address);
        }

        // set events
        this._conn.on("messageReceived", msg => this.handleMessage(msg));
        this._conn.once("closed", () => this.close());

        // Take note of all cubes I could share with this new peer. While the
        // connection lasts, supplement this with any newly learned cubes.
        // This is used to ensure we don't offer peers the same cube twice.
        // TODO: In the interest of keeping peer handling efficient and reducing
        // our Sybil attack surface this feature should be removed.
        // TODO BUGBUG: The next line probably expects information in the CubeInfo/CubeMeta
        // that's not always guaranteed to be present, in particular when the CubeInfo
        // is generated on demand by reading from persistence.
        cubeStore.getAllCubeInfo().then(cubeMetas => {this.unsentCubeMeta = new Set(cubeMetas)});
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
            this._status = NetworkPeerLifecycle.HANDSHAKING;
            logger.info(`NetworkPeer ${this.toString()}: Connected, I'll go ahead and say HELLO`);
            this.sendHello();
        });
    }

    close(): Promise<void> {
        logger.trace(`NetworkPeer ${this.toString()}: Closing connection.`);
        this._status = NetworkPeerLifecycle.CLOSING;
        // Remove all listeners and timers to avoid memory leaks
        this.networkManager.peerDB.removeListener(
            'exchangeablePeer', (peer: Peer) => this.learnExchangeablePeer(peer));
        this.cubeStore.removeListener(
            'cubeAdded', (cube: CubeMeta) => this.unsentCubeMeta.add(cube));
        clearInterval(this.keyRequestTimer);
        clearInterval(this.peerRequestTimer);
        clearTimeout(this.networkTimeout);

        // Close our connection object.
        // Note: this means conn.close() gets called twice when closure
        // originates from the conn, but that's okay.
        const closedPromise: Promise<void> = this._conn.close();
        closedPromise.then(() => {this._status = NetworkPeerLifecycle.CLOSED });

        // If we never got online, "resolve" the promise with undefined.
        // Rejecting it would be the cleaner choice, but then we'd need to catch
        // the rejection every single time and we really don't care that much.
        this.onlinePromiseResolve(undefined);

        // Let the network manager know we're closed
        this.networkManager.handlePeerClosed(this);
        return closedPromise;
    }

    sendMessage(msg: NetworkMessage): void {
        const compiled: Buffer = this.compileMessage(msg);
        this.txMessage(compiled);
    }

    // TODO: Use our universal FieldParser instead. This will allow us to
    // to compile multiple messages into one transmission.
    // In preparation for this, NetworkMessages are already derived from BaseFields :)
    private compileMessage(msg: NetworkMessage): Buffer {
        const compiled: Buffer = Buffer.alloc(
            NetConstants.PROTOCOL_VERSION_SIZE +
            NetConstants.MESSAGE_CLASS_SIZE +
            msg.value.length);
        compiled.writeUintBE(
            NetConstants.PROTOCOL_VERSION,        // value
            0,                                    // offset
            NetConstants.PROTOCOL_VERSION_SIZE);  // size
        compiled.writeUintBE(
            msg.type,                            // value
            NetConstants.PROTOCOL_VERSION_SIZE,  // ofset
            NetConstants.MESSAGE_CLASS_SIZE);    // size
        msg.value.copy(compiled, NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
        return compiled;
    }

    private txMessage(message: Buffer): void {
        this.logTxStats(message, message.readUInt8(NetConstants.PROTOCOL_VERSION_SIZE));
        this._conn.send(message);
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

    /**
     * Handle an incoming message.
     * @param message The incoming message as a Buffer.
     */
    private handleMessage(message: Buffer): void {
        if (this._status >= NetworkPeerLifecycle.CLOSING) {
            // This NetworkPeer has already been closed;
            // not handling any further messages.
            return;
        }
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
            // TODO: use FieldParser to decompile messages
            const protocolVersion = message.readUintBE(0, NetConstants.PROTOCOL_VERSION_SIZE);
            const messageClass = message.readUIntBE(NetConstants.PROTOCOL_VERSION_SIZE, NetConstants.MESSAGE_CLASS_SIZE);
            const messageContent = message.subarray(NetConstants.PROTOCOL_VERSION_SIZE + NetConstants.MESSAGE_CLASS_SIZE);
            const msg: NetworkMessage = NetworkMessage.fromBinary(
                messageClass, messageContent);
            // logger.trace(`NetworkPeer ${this.toString()}: handleMessage() messageClass: ${MessageClass[messageClass]}`);
            this.logRxStats(message, messageClass);

            // Process the message based on its class
            switch (messageClass) {
                case MessageClass.Hello:
                    this.handleHello(messageContent);
                    break;
                case MessageClass.KeyRequest:
                    try {  // non-essential feature (for us... for them it's rather essential, but we don't care :D)
                        this.handleKeyRequest();
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a PeerRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.KeyResponse:
                    this.handleKeyResponse(msg as KeyResponseMessage);
                    break;
                case MessageClass.CubeRequest:
                    try {  // non-essential feature
                        this.handleCubeRequest(msg as CubeRequestMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a CubeRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.CubeResponse:
                    this.handleCubeResponse(msg as CubeResponseMessage);
                    break;
                case MessageClass.MyServerAddress:
                    try {  // non-essential feature
                        this.handleServerAddress(msg as ServerAddressMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a MyServerAddress message because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.PeerRequest:
                    try {  // non-essential feature
                        this.handlePeerRequest();
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a PeerRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.PeerResponse:
                    try {  // non-essential feature
                        this.handlePeerResponse(msg as PeerResponseMessage);
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
            // Blocklist repeat offenders based on local trust score
            if (!this.isTrusted) this.networkManager.closeAndBlockPeer(this);
            // Maybe we should remove blocklisting
            // after a defined timespan (increasing for repeat offenders)?
            // Blocklist entries based on IP/Port are especially sensitive
            // as the address could be reused by another node in a NAT environment.
        }
    }

    private sendHello(): void {
        logger.trace(`NetworkPeer ${this.toString()}: Sending HELLO`);
        const msg: HelloMessage = new HelloMessage(this.networkManager.id);
        this.sendMessage(msg);
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
        if (this.online) {
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
            this._status = NetworkPeerLifecycle.ONLINE;
            logger.trace(`NetworkPeer ${this.toString()}: received HELLO, peer now considered online`);

            // Let the network manager know this peer is now online.
            // Abort if the network manager gives us a thumbs down on the peer.
            if (!this.networkManager.handlePeerOnline(this)) return;
            this.onlinePromiseResolve(this);  // let listeners know we learnt the peer's ID
        }
        // Send my publicly reachable address if I have one
        this.sendMyServerAddress();

        // Asks for their know peers in regular intervals
        if (!this.peerRequestTimer) {
            this.peerRequestTimer = setInterval(() =>
                this.sendPeerRequest(), Settings.NODE_REQUEST_TIME);
        }
        // If we're scheduling our own requests and are not a light node,
        // ask for available cubes in regular intervals
        if (this.autoRequest && !this.lightNode && !this.keyRequestTimer) {
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
        for (let i = 0; i < NetConstants.MAX_CUBES_PER_MESSAGE; i++) {
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

        const reply: KeyResponseMessage = new KeyResponseMessage(cubes);
        logger.trace(`NetworkPeer ${this.toString()}: handleKeyRequest: sending ${cubes.length} cube details`);
        this.sendMessage(reply);
    }

    /**
     * Handle a KeyResponse message and request all offered Cubes that we don't
     * have.
     * Does nothing for light nodes as, obviously, light nodes don't just
     * blindly request all Cubes.
     * @param data The HashResponse data.
     */
    private async handleKeyResponse(msg: KeyResponseMessage): Promise<void> {
        if (this.lightNode) {
            logger.info(`${this.toString()}: handleKeyResponse() called but light mode enabled, doing nothing.`)
            return;
        }
        const cubeInfos: Generator<CubeInfo> = msg.cubeInfos();
        const regularCubeInfo: CubeInfo[] = [];
        const mucInfo: CubeInfo[] = [];

        for (const incomingCubeInfo of cubeInfos) {
            // if retention policy is enabled, ensure the offered Cube has
            // not yet reached its recycling date
            const currentEpoch = getCurrentEpoch(); // Get the current epoch
            if(this.cubeStore.enableCubeRetentionPolicy &&
               !shouldRetainCube(
                    incomingCubeInfo.keyString,
                    incomingCubeInfo.date,
                    incomingCubeInfo.difficulty,
                    currentEpoch)) {
                logger.info(`NetworkPeer ${this.toString()}: handleKeyResponse(): Was offered cube hash outside of retention policy, ignoring.`);
                continue;
            }

            if (incomingCubeInfo.cubeType === CubeType.FROZEN) {
                regularCubeInfo.push(incomingCubeInfo);
            } else if (incomingCubeInfo.cubeType === CubeType.MUC) {
                mucInfo.push(incomingCubeInfo);
            } else {
                logger.info(`NetworkPeer ${this.toString()}: in handleKeyResponse I saw a CubeType of ${incomingCubeInfo.cubeType}. I don't know what that is.`)
            }
        }

        // For each regular key not in cube storage, request the cube
        const missingKeys: Buffer[] = regularCubeInfo.filter(async detail => !(await this.cubeStore.hasCube(detail.key))).map(detail => detail.key);
        for (const muc of mucInfo) {
            // Request any MUC not in cube storage
            if (!(await this.cubeStore.hasCube(muc.key))) {
                missingKeys.push(muc.key);
            } else {
                // For each MUC in cube storage, identify winner and request if necessary
                const storedCube: CubeMeta = await this.cubeStore.getCubeInfo(muc.key);
                try {
                    const winningCube: CubeMeta = cubeContest(storedCube, muc);
                    if (winningCube !== storedCube) {
                        missingKeys.push(muc.key);
                    }
                } catch(error) {
                    logger.info(`NetworkPeer ${this.toString()}: handleKeyResponse(): Error handling incoming MUC ${muc.keyString}: ${error}`);
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
    private async handleCubeRequest(msg: CubeRequestMessage): Promise<void> {
        const requestedKeys: Generator<CubeKey> = msg.cubeKeys();
        // fetch all requested binary Cubes
        const binaryCubes: Buffer[] = [];
        for (const requestedKey of requestedKeys) {
            binaryCubes.push(
                (await this.cubeStore.getCubeInfo(requestedKey)).binaryCube);
        }
        const reply = new CubeResponseMessage(binaryCubes);
        logger.trace(`NetworkPeer ${this.toString()}: handleCubeRequest: sending ${reply.cubeCount} cubes`);
        this.sendMessage(reply);
    }

    /**
     * Handle a CubeResponse message.
     * @param msg The CubeResponse message.
     */
    // TODO: If we're a light node, make sure we actually requested those
    private handleCubeResponse(msg: CubeResponseMessage): void {
        const binaryCubes: Generator<Buffer> = msg.binaryCubes();
        for (const binaryCube of binaryCubes) {
            // Add the cube to the CubeStorage
            // If this fails, CubeStore will log an error and we will ignore this cube.
            // Grant this peer local reputation if cube is accepted.
            // TODO BUGBUG: This currently grants reputation score for duplicates,
            // which is absolutely contrary to what we want :'D
            this.cubeStore.addCube(binaryCube)
                .then((value) => {
                    if(value) { this.scoreReceivedCube(value.getDifficulty()); }
                });
        }
        logger.info(`NetworkPeer ${this.toString()}: handleCubeResponse: received ${msg.cubeCount} cubes`);
    }

    /**
     * Handles a MyServerAddress message, which is a remote (incoming) peer's
     * way of telling us their publicly reachable address, making them eligible
     * for peer exchange.
     */
    private handleServerAddress(msg: ServerAddressMessage): void {
        if (msg.address.type == SupportedTransports.ws && msg.address.ip === "0.0.0.0") {
            // HACKHACK Handle special case: If the remote peer did not indicate its
            // IP address (but instead identifies as the 'any' address "0.0.0.0"),
            // substitute this by the IP address we're currently
            // using for this peer.
            // It's a bad solution implemented in ugly code.
            // But we mostly get around the fact that NATed nodes don't
            // know their own address but might know their port.
            this.addAddress(
                new WebSocketAddress(this.ip, msg.address.port),
                true);  // learn address and make primary
        } else {
            this.addAddress(msg.address, true);  // learn address and make primary
        }
        this.networkManager.handlePeerUpdated(this);
    }

    // TODO generalize: We should be allowed to have and send multiple server addresses
    // In particular, nodes offering both plain WS and Libp2p sockets should always
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

        const msg: ServerAddressMessage = new ServerAddressMessage(address);
        logger.trace(`NetworkPeer ${this.toString()}: sending them MyServerAddress ${msg.address}`);
        this.sendMessage(msg);
    }

    /**
      * Send a KeyRequest message.
      */
    sendKeyRequest(): void {
        logger.trace(`NetworkPeer ${this.toString()}: sending KeyRequest`);
        const msg: KeyRequestMessage = new KeyRequestMessage();
        this.setTimeout();  // expect a timely reply to this request
        this.sendMessage(msg);
    }

    /**
     * Send a CubeRequest message.
     * @param keys The list of cube hashes to request.
     */
    sendCubeRequest(keys: Buffer[]): void {
        const msg: CubeRequestMessage = new CubeRequestMessage(keys);
        logger.trace(`NetworkPeer ${this.toString()}: sending CubeRequest for ${keys.length} cubes`);
        this.setTimeout();  // expect a timely reply to this request
        this.sendMessage(msg);
    }

    sendPeerRequest(): void {
        if (!this.peerExchange) return;  // don't do anything if opted out
        const msg: PeerRequestMessage = new PeerRequestMessage();
        logger.trace(`NetworkPeer ${this.toString()}: sending PeerRequest`);
        // Not setting timeout for this request: A peer not participating in
        // node exchange is neither necessarily dead nor invalid.
        this.sendMessage(msg);
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
    private handlePeerRequest(): void {
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

        const reply: PeerResponseMessage = new PeerResponseMessage(chosenPeers);
        logger.trace(`NetworkPeer ${this.toString()}: handlePeerRequest: sending them ${chosenPeers.length} peer addresses`);
        this.sendMessage(reply);
    }

    // TODO: ask our transports for exchangeable nodes -- for libp2p, browser nodes
    // can and should act as connection brokers for their directly connected peers;
    // this kind of private brokering however never yields any kind of publicly
    // reachable peer address
    private handlePeerResponse(msg: PeerResponseMessage): void {
        const peers: Generator<Peer> = msg.peers();
        for (const peer of peers) {
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
