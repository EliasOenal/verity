import { Settings } from '../settings';
import { unixtime } from '../helpers/misc';

import { CubeFilterOptions, CubeRequestMessage, CubeResponseMessage, HelloMessage, KeyRequestMessage, KeyResponseMessage, NetworkMessage, PeerRequestMessage, PeerResponseMessage, ServerAddressMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode } from './networkMessage';
import { MessageClass, NetConstants, SupportedTransports } from './networkDefinitions';
import { KeyRequestMode } from './networkMessage';
import { TransportConnection } from './transport/transportConnection';
import { NetworkPeerIf, NetworkPeerLifecycle, NetworkPeerOptions, NetworkStats } from './networkPeerIf';
import { NetworkManagerIf } from './networkManagerIf';

import { CubeKey, NotificationKey } from '../cube/cube.definitions';
import { CubeStore } from '../cube/cubeStore';
import { CubeInfo } from '../cube/cubeInfo';
import { Sublevels } from '../cube/levelBackend';
import { Cube } from '../cube/cube';
import { keyVariants } from '../cube/keyUtil';

import { WebSocketAddress, AddressAbstraction } from '../peering/addressing';
import { Peer } from '../peering/peer';

import { logger } from '../logger';

import { Buffer } from 'buffer';

/**
 * Class representing a network peer, responsible for handling incoming and outgoing messages.
 */
// TODO: This should arguably encapsulate Peer instead of inheriting from it
export class NetworkPeer extends Peer implements NetworkPeerIf{
    // TODO: Use our universal FieldParser instead. This will allow us to
    // to compile multiple messages into one transmission.
    // In preparation for this, NetworkMessages are already derived from BaseFields :)
    private static compileMessage(msg: NetworkMessage): Buffer {
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


    stats: NetworkStats = new NetworkStats();
    private peerRequestTimer?: NodeJS.Timeout = undefined; // Timer for node requests

    private _status: NetworkPeerLifecycleStatus = new NetworkPeerLifecycleStatus;
    get status(): NetworkPeerLifecycle { return this._status.value }

    private onlinePromiseResolve: (np: NetworkPeer) => void;

    private lastRequestedKey?: CubeKey;

    get lastKey(): CubeKey | undefined {  // TODO do we need this?
        return this.lastRequestedKey;
    }
    /**
     * A peer will be considered to be online once a correct HELLO message
     * has been received.
     * If this NetworPeer never gets online, the promise will be resolved
     * with undefined.
     */
    private _onlinePromise: Promise<NetworkPeer> = new Promise<NetworkPeer>(
        resolve => this.onlinePromiseResolve = resolve);
    get onlinePromise() { return this._onlinePromise; }
    get online(): boolean { return this.status === NetworkPeerLifecycle.ONLINE; }

    private unsentPeers: Peer[] = undefined;  // TODO this should probably be a Set instead

    get conn(): TransportConnection { return this._conn }

    private _cubeSubscriptions: Set<string> = new Set();
    get cubeSubscriptions(): Iterable<string> { return this._cubeSubscriptions }
    addCubeSubscription(key: CubeKey | string): void {
        this._cubeSubscriptions.add(keyVariants(key).keyString);
    }
    cancelCubeSubscription(key: CubeKey | string): void {
        this._cubeSubscriptions.delete(keyVariants(key).keyString);
    }

    private _notificationSubscriptions: Set<string> = new Set();
    get notificationSubscriptions(): Iterable<string> { return this._notificationSubscriptions }
    addNotificationSubscription(key: CubeKey | string): void {
        this._notificationSubscriptions.add(keyVariants(key).keyString);
    }
    cancelNotificationSubscription(key: CubeKey | string): void {
        this._notificationSubscriptions.delete(keyVariants(key).keyString);
    }

    private networkTimeout: NodeJS.Timeout = undefined;

    private timers: Set<NodeJS.Timeout> = new Set();

    constructor(
            private networkManager: NetworkManagerIf,
            private _conn: TransportConnection,
            private cubeStore: CubeStore,
            readonly options: NetworkPeerOptions = {},
        )
    {
        super(_conn.address);
        // set opts
        this.options.peerExchange ??= Settings.PEER_EXCHANGE,
        this.options.networkTimeoutMillis ??= Settings.NETWORK_TIMEOUT,
        this.options.closeOnTimeout ??= Settings.CLOSE_PEER_ON_TIMEOUT,
        this.options.cubeSubscriptionPeriod ??= Settings.CUBE_SUBSCRIPTION_PERIOD;

        // set extra addresses, if any
        if (options.extraAddresses) {
            this.addresses = options.extraAddresses;
            this.addAddress(_conn.address);
        }

        // set events
        this._conn.on("messageReceived", this.handleMessage);
        this._conn.once("closed", this.close);

        // Take note of all other peers I could exchange with this new peer.
        // This is used to ensure we don't exchange the same peers twice.
        // TODO: Get rid of this as we shouldn't keep a large amount of state
        //   for each connected peer, it's a DOS vector.
        //   Also, there's really no reason to convert to array here
        this.unsentPeers = Array.from(
            this.networkManager.peerDB.peersExchangeable.values());
        networkManager.peerDB.on('exchangeablePeer', this.learnExchangeablePeer);

        // Get informed of all Cube updates to handle subscriptions
        cubeStore.on("cubeAdded", this.sendSubscribedCubeUpdate);
        cubeStore.on("notificationAdded", this.sendNotificationUpdate);

        // Send HELLO message once connected
        this.setTimeout();  // connection timeout
        this.conn.readyPromise.then(() => {
            clearTimeout(this.networkTimeout);  // clear connection timeout
            this._status.advance(NetworkPeerLifecycle.HANDSHAKING);
            logger.info(`NetworkPeer ${this.toString()}: Connected, I'll go ahead and say HELLO`);
            this.sendHello();
        });
    }

    // maybe rename this to shutdown for consistency... in most of our code,
    // closing something is a reversible action while shutdown is permanent,
    // and "closing" a NetworkPeer is permanent; a new NetworkPeer object needs
    // to be constructed for the next connection
    // NOTE: must use arrow syntax to have this event handler pre-bound;
    //  otherwise, event subscription will not properly cancel on close
    close: () => Promise<void> = () => {
        logger.trace(`NetworkPeer ${this.toString()}: Closing connection.`);
        this._status.advance(NetworkPeerLifecycle.CLOSING);

        // Clear all timers; first the named ones:
        clearInterval(this.peerRequestTimer);
        clearTimeout(this.networkTimeout);
        // Then the unnamed ones (that's subscription timeouts as of the time of writing this comment)
        for (const timer of this.timers) {
            clearTimeout(timer);
            this.timers.delete(timer);
        }

        // Remove all event listeners
        this._conn.removeListener("messageReceived", this.handleMessage);
        this.networkManager.peerDB.removeListener(
            'exchangeablePeer', this.learnExchangeablePeer);
        this.cubeStore.removeListener("cubeAdded", this.sendSubscribedCubeUpdate);
        this.cubeStore.removeListener("notificationAdded", this.sendNotificationUpdate);

        // Close our connection object.
        // Note: this means conn.close() gets called twice when closure
        // originates from the conn, but that's okay.
        const closedPromise: Promise<void> = this._conn.close();
        closedPromise.then(() => {this._status.advance(NetworkPeerLifecycle.CLOSED) });

        // If we never got online, "resolve" the promise with undefined.
        // Rejecting it would be the cleaner choice, but then we'd need to catch
        // the rejection every single time and we really don't care that much.
        this.onlinePromiseResolve(undefined);

        // Let the network manager know we're closed
        this.networkManager.handlePeerClosed(this);
        return closedPromise;
    }

    sendMessage(msg: NetworkMessage): void {
        const compiled: Buffer = NetworkPeer.compileMessage(msg);
        this.txMessage(compiled);
    }

    private txMessage(message: Buffer): void {
        this.logTxStats(message, message.readUInt8(NetConstants.PROTOCOL_VERSION_SIZE));
        this._conn.send(message);
    }

    private logRxStats(message: Buffer, messageType: MessageClass): void {
        this.stats.rx.messages++;
        this.stats.rx.bytes += message.length;
        const packetTypeStats = this.stats.rx.messageTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.rx.messageTypes[messageType] = packetTypeStats;
    }

    private logTxStats(message: Buffer, messageType: MessageClass): void {
        this.stats.tx.messages++;
        this.stats.tx.bytes += message.length;
        const packetTypeStats = this.stats.tx.messageTypes[messageType] || { count: 0, bytes: 0 };
        packetTypeStats.count++;
        packetTypeStats.bytes += message.length;
        this.stats.tx.messageTypes[messageType] = packetTypeStats;
    }

    /**
     * Handle an incoming message.
     * @param message The incoming message as a Buffer.
     */
    // NOTE: must use arrow syntax to have this event handler pre-bound;
    //  otherwise, event subscription will not properly cancel on close
    private handleMessage: (message: Buffer) => void = message => {
        if (this.status >= NetworkPeerLifecycle.CLOSING) {
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
            const binaryMessage = message.subarray(NetConstants.PROTOCOL_VERSION_SIZE);
            const msg: NetworkMessage = NetworkMessage.fromBinary(binaryMessage);
            // logger.trace(`NetworkPeer ${this.toString()}: handleMessage() messageClass: ${MessageClass[messageClass]}`);
            this.logRxStats(message, msg.type);

            // Process the message based on its class
            switch (msg.type) {
                case MessageClass.Hello:
                    this.handleHello(msg as HelloMessage);
                    break;
                case MessageClass.KeyRequest:
                    try {  // non-essential feature (for us... for them it's rather essential, but we don't care :D)
                        this.handleKeyRequest(msg as KeyRequestMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a PeerRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.KeyResponse:
                    try {  // non-essential feature
                        this.handleKeyResponse(msg as KeyResponseMessage);
                    }
                    catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a KeyResponse because an error occurred processing it: ${err}`);
                    }
                    break;
                case MessageClass.CubeRequest:
                    try {  // non-essential feature (for us... for them it's rather essential, but we don't care :D)
                        this.handleCubeRequest(msg as CubeRequestMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a CubeRequest because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.CubeResponse:
                    this.handleCubeResponse(msg as CubeResponseMessage);
                    break;
                case MessageClass.SubscribeCube:
                    try {  // non-essential feature
                        this.handleSubscribeCube(msg as CubeRequestMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a SubscribeCube message because an error occurred processing it: ${err}`);
                        break;
                    }
                case MessageClass.SubscribeNotifications:
                    try {  // non-essential feature
                        this.handleSubscribeNotifications(msg as CubeRequestMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a SubscribeNotifications message because an error occurred processing it: ${err}`);
                        break;
                    }

                case MessageClass.SubscriptionConfirmation:
                    try {  // non-essential feature
                        this.handleSubscriptionConfirmation(msg as SubscriptionConfirmationMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a SubscriptionConfirmation message because an error occurred processing it: ${err}`);
                        break;
                    }
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
                case MessageClass.NotificationRequest:
                    try {  // non-essential feature
                        this.handleNotificationRequest(msg as CubeRequestMessage);
                        break;
                    } catch (err) {  // we'll mostly ignore errors with this
                        logger.warn(`NetworkPeer ${this.toString()}: Ignoring a NodeResponse because an error occurred processing it: ${err}`);
                        // TODO: This should make this peer ineligible for peer exchange, at least for a while
                        break;
                    }
                default:
                    logger.warn(`NetworkPeer ${this.toString()}: Ignoring message with unknown class: ${msg.type}`);
                    break;
            }
        } catch (err) {
            this.scoreInvalidMessage();
            logger.info(`NetworkPeer ${this.toString()}: error while handling message: ${err}; stack trace: ${err.stack}`);
            // Blocklist repeat offenders based on local trust score
            if (!this.isTrusted) this.networkManager.closeAndBlockPeer(this);
            // TODO: remove blocklisting -- trust score penalty should be enough
            // as this should determine which peers we connect to
        }
    }

    private sendHello(): void {
        logger.trace(`NetworkPeer ${this.toString()}: Sending HELLO`);
        const msg: HelloMessage = new HelloMessage(this.networkManager.id);
        this.sendMessage(msg);
    }

    private handleHello(msg: HelloMessage): void {
        // receive peer ID
        if (!msg.remoteId) {  // invalid ID
            logger.info(`NetworkPeer ${this.toString()}: Received invalid peer ID, closing connection.`)
            this.close();
            return;
        }

        // Is this a spurious repeat HELLO?
        if (this.status >= NetworkPeerLifecycle.ONLINE) {
            // If the peer has unexpectedly changed its ID, disconnect.
            if (!this.id.equals(msg.remoteId)) {
                logger.info(`NetworkPeer ${this.toString()} suddenly changed its ID from ${this.id?.toString('hex')} to ${msg.remoteId.toString('hex')}, closing connection.`);
                this.close();
            } else {  // no unexpected ID change, just a spurious HELLO to be ignored
                logger.trace(`NetworkPeer ${this.toString()}: Received spurious repeat HELLO`);
            }
        } else {  // not a repeat hello
            this._id = msg.remoteId;
            this._status.advance(NetworkPeerLifecycle.ONLINE);
            logger.trace(`NetworkPeer ${this.toString()}: received HELLO, peer now considered online`);

            // Let the network manager know this peer is now online.
            // Abort if the network manager gives us a thumbs down on the peer.
            if (!this.networkManager.handlePeerOnline(this)) return;
            this.onlinePromiseResolve(this);  // let listeners know we learnt the peer's ID

            // Send my publicly reachable address if I have one
            this.sendMyServerAddress();

            // Asks for their know peers in regular intervals
            if (!this.peerRequestTimer) {
                this.peerRequestTimer = setInterval(() =>
                    this.sendPeerRequest(), Settings.NODE_REQUEST_TIME);
            }
        }
    }

    /**
     * Handle a KeyRequest message.
     */
    private async handleKeyRequest(msg: KeyRequestMessage): Promise<void> {
        try {
            const mode = msg.mode;
            const keyCount = msg.keyCount || NetConstants.MAX_CUBES_PER_MESSAGE;
            const startKey = msg.startKey;

            let cubes: CubeInfo[];
            logger.trace(`NetworkPeer ${this.toString()}: handleKeyRequest: received KeyRequest in mode ${KeyRequestMode[mode]}, keyCount: ${keyCount}, startKey: ${startKey?.toString('hex')}`);
            switch (mode) {
                case KeyRequestMode.SlidingWindow:
                    cubes = await this.handleSlidingWindowKeyRequest(
                        startKey, keyCount);
                    break;
                case KeyRequestMode.SequentialStoreSync:
                    cubes = await this.handleSequentialStoreSyncKeyRequest(
                        startKey, keyCount, Sublevels.CUBES);
                    break;
                case KeyRequestMode.NotificationChallenge:
                    cubes = await this.handleSequentialStoreSyncKeyRequest(
                        startKey, keyCount, Sublevels.INDEX_DIFF);
                    break;
                case KeyRequestMode.NotificationTimestamp:
                    cubes = await this.handleSequentialStoreSyncKeyRequest(
                        startKey, keyCount, Sublevels.INDEX_TIME);
                    break;
                default:
                    logger.warn(`NetworkPeer ${this.toString()}: Received unknown KeyRequest mode: ${mode}`);
                    return;
            }
            const reply: KeyResponseMessage = new KeyResponseMessage(mode, cubes);
            logger.trace(`NetworkPeer ${this.toString()}: handleKeyRequest: sending ${cubes.length} cube keys in ${KeyRequestMode[mode]} mode`);
            this.sendMessage(reply);
        } catch (err) {
            logger.warn(`NetworkPeer ${this.toString()}: Error handling KeyRequest: ${err}`);
        }
    }

    private async handleSlidingWindowKeyRequest(startKey: CubeKey, keyCount: number): Promise<CubeInfo[]> {
        const recentKeys = startKey
            ? this.networkManager.getRecentSucceedingKeys(startKey, keyCount)
            : this.networkManager.getRecentKeys().slice(0, keyCount);

        const cubeInfos = await Promise.all(recentKeys.map(key => this.cubeStore.getCubeInfo(key)));
        return cubeInfos.filter((info): info is CubeInfo => info !== undefined);
    }

    private async handleSequentialStoreSyncKeyRequest(
            startKey: CubeKey,
            keyCount: number,
            sublevel: Sublevels = Sublevels.CUBES,
    ): Promise<CubeInfo[]> {
        // This method should be implemented in the CubeStore class
        return await this.cubeStore.getSucceedingCubeInfos(startKey, keyCount, sublevel);
    }

    /**
     * Handle a KeyResponse message and request all offered Cubes that we don't
     * have.
     * Does nothing for light nodes as, obviously, light nodes don't just
     * blindly request all Cubes.
     * @param data The HashResponse data.
     */
    private async handleKeyResponse(msg: KeyResponseMessage): Promise<void> {
        try {
            // Keep track of the last key we've seen from this remote node.
            // This is so we can later continue syncing up to them.
            let lastKey: CubeKey | undefined;

            // Let the scheduler know which Cubes the remote node was kind
            // enough to offer us. The scheduler will call back to us for each
            // CubeInfo.
            const keyCallback = function*() {
                const cubeInfos: Generator<CubeInfo> = msg.cubeInfos();
                for (const incomingCubeInfo of cubeInfos) {
                    lastKey = incomingCubeInfo.key;
                    yield incomingCubeInfo;
                }
            }
            await this.networkManager.scheduler.handleKeysOffered(
                keyCallback(), this);


            // Update the last requested key for the appropriate mode
            if (lastKey) {
                this.updateLastRequestedKey(msg.mode, lastKey);
            }
            // TODO: note that it is completely undefined when the next request
            // will run; if we have many open connections the scheduler will
            // currently just chose another random node next :o
        } catch (err) {
            logger.warn(`NetworkPeer.handleKeyResponse(): Error handling KeyResponse: ${err}`);
            throw(err);
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
        let count = 0;
        for (const requestedKey of requestedKeys) {
            const binaryCube: Buffer =
                (await this.cubeStore.getCubeInfo(requestedKey))?.binaryCube
            if (binaryCube !== undefined) {
                count++;
                binaryCubes.push(binaryCube);
            }
            if (count >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
        }
        const reply = new CubeResponseMessage(binaryCubes);
        logger.trace(`NetworkPeer ${this.toString()}: handleCubeRequest: sending ${reply.cubeCount} cubes`);
        this.sendMessage(reply);
    }

    private async handleNotificationRequest(msg:CubeRequestMessage): Promise<void> {
        const requestedRecipients: Generator<CubeKey> = msg.cubeKeys();
        // fetch all requested notifications
        const binaryCubes: Buffer[] = [];
        let count = 0;
        for (const recipient of requestedRecipients) {
            for await (const cubeInfo of this.cubeStore.getNotificationCubeInfos(recipient)) {
                if (cubeInfo.binaryCube) {
                    binaryCubes.push(cubeInfo.binaryCube);
                    count++;
                }
                if (count >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
            }
            if (count >= NetConstants.MAX_CUBES_PER_MESSAGE) break;  // goto would avoid the duplicate break :)
        }
        const reply = new CubeResponseMessage(binaryCubes);
        logger.trace(`NetworkPeer ${this.toString()}: handleNotificationRequest: sending ${reply.cubeCount} cubes`);
        this.sendMessage(reply);
    }

    /**
     * Handle a CubeSubscribe message.
     * @param data The CubeSubscribe message, which has the same format as a CubeRequest message
     */
    // TODO: Limit the number of subscriptions
    private async handleSubscribeCube(msg: CubeRequestMessage): Promise<void> {
        const requestedKeys: CubeKey[] = Array.from(msg.cubeKeys());
        // check if we even have all requested Cubes
        let cubeUnavailable: boolean = false;
        const currentHashes: Buffer[] = [];
        for (const key of requestedKeys) {
            const cubeInfo: CubeInfo = await this.cubeStore.getCubeInfo(key);
            if (cubeInfo === undefined) {
                cubeUnavailable = true;
                break;
            }
            currentHashes.push(await cubeInfo.getCube().getHash());
        }
        // Can we even fulfil this request?
        if (cubeUnavailable) {
            logger.trace(`NetworkPeer ${this.toString()}: handleSubscribeCube(): refusing subscription as we don't have one or more of the requested Cubes`);
            const reply = new SubscriptionConfirmationMessage(
                SubscriptionResponseCode.RequestedKeyNotAvailable,
                requestedKeys);
            this.sendMessage(reply);
            return;
        }
        // All good, subscription accepted! Register it...
        let i=0;  // for debug output only
        for (const key of requestedKeys) {
            this.addCubeSubscription(key);
            i++;
        }
        logger.trace(`NetworkPeer ${this.toString()}: handleSubscribeCube(): recorded ${i} Cube subscriptions`);
        // ... and send a confirmation
        const reply = new SubscriptionConfirmationMessage(
            SubscriptionResponseCode.SubscriptionConfirmed,
            requestedKeys,
            currentHashes,
            this.options.cubeSubscriptionPeriod,
        );
        this.sendMessage(reply);

        // Remove the subscription after it expires
        const timer = setTimeout(() => {
            let i = 0;
            for (const key of requestedKeys) {
                this.cancelCubeSubscription(key);
                i++;
            }
            this.timers.delete(timer);
            logger.trace(`NetworkPeer ${this.toString()}: handleSubscribeCube(): cancelled ${i} expired Cube subscriptions`);
        }, this.options.cubeSubscriptionPeriod);
        this.timers.add(timer);
    }

    private async handleSubscribeNotifications(msg: CubeRequestMessage): Promise<void> {
        // take note of all newly subscribed notifications keys
        const requestedKeys: CubeKey[] = Array.from(msg.cubeKeys());
        let i=0;  // for debug output only
        for (const notificationKey of requestedKeys) {
            this.addNotificationSubscription(notificationKey);
            i++;
        }
        logger.trace(`NetworkPeer ${this.toString()}: handleSubscribeNotifications(): recorded ${i} notification subscriptions`);

        // Note that unlike Cube subscriptions, there is no need for any
        // preliminary checks -- we will serve the peer all future notifications
        // no matter what we currently do or don't have in store.
        // TODO: Same as for a CubeSubscription, we should return the current hash of
        // hashes to the peer to enable them to determine whether or not they
        // are in sync; if we do not have any notifications to the requested key(s),
        // this will be the empty string hash.
        // When implementing, need to ensure this does not cause excessive
        // store retrievals in case of highly frequented notification keys.
        // Currently returning all zeroes.

        // Send confirmation
        const reply = new SubscriptionConfirmationMessage(
            SubscriptionResponseCode.SubscriptionConfirmed,
            requestedKeys,
            [Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0)],
            this.options.cubeSubscriptionPeriod,
        );
        this.sendMessage(reply);

        // Remove the subscription after it expires
        // TODO keep track of timeouts and cancel them on shutdown
        const timer = setTimeout(() => {
            let i = 0;
            for (const key of requestedKeys) {
                this.cancelNotificationSubscription(key);
                i++;
            }
            this.timers.delete(timer);
            logger.trace(`NetworkPeer ${this.toString()}: handleSubscribeNotifications(): cancelled ${i} expired notification subscriptions`);
        }, this.options.cubeSubscriptionPeriod);
        this.timers.add(timer);
    }

    private handleSubscriptionConfirmation(msg: SubscriptionConfirmationMessage): void {
        this.networkManager.scheduler.handleSubscriptionConfirmation(msg);
    }


    /**
     * Handle a CubeResponse message.
     * @param msg The CubeResponse message.
     */
    private handleCubeResponse(msg: CubeResponseMessage): void {
        this.networkManager.scheduler.handleCubesDelivered(msg.binaryCubes(), this);
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
    sendMyServerAddress(): void {
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

    private lastSlidingWindowKey: CubeKey;
    private lastSequentialSyncKey: CubeKey;

    sendKeyRequests(): void {
        if (this.lastSlidingWindowKey === undefined) {
            this.sendSpecificKeyRequest(KeyRequestMode.SlidingWindow);
        } else {
            this.sendSpecificKeyRequest(KeyRequestMode.SlidingWindow, {startKey: this.lastSlidingWindowKey});
        }

        if (this.lastSequentialSyncKey !== undefined) {
            this.sendSpecificKeyRequest(KeyRequestMode.SequentialStoreSync, {startKey: this.lastSequentialSyncKey});
        } else {
            // To sync the store we need a starting point
            // Next call we should hopefully have one
        }
    }

    /**
     * Send a KeyRequest message.
     * @param mode The mode of the key request.
     * @param keyCount The number of keys to request.
     * @param startKey The key to start from (for SlidingWindow and SequentialStoreSync modes).
     *   Note that this is mandatory in SequentialStoreSync mode; not supplying
     *   may yield undefined results.
     */
    sendSpecificKeyRequest(
            mode: KeyRequestMode,
            options: CubeFilterOptions = {},
    ): void {
        logger.trace(`NetworkPeer ${this.toString()}: sending KeyRequest in ${KeyRequestMode[mode]} mode, requesting ${options.maxCount ?? 'the default number of'} keys, starting from ${options?.startKey?.toString('hex') ?? 'zero'}`);
        const msg: KeyRequestMessage = new KeyRequestMessage(mode, options);
        this.setTimeout();  // expect a timely reply to this request
        this.sendMessage(msg);
    }

    /**
     * Update the last requested key for the appropriate mode after receiving a KeyResponse.
     * @param mode The mode of the key request.
     * @param lastKey The last key received in the response.
     */
    private updateLastRequestedKey(mode: KeyRequestMode, lastKey: CubeKey): void {
        if (mode === KeyRequestMode.SlidingWindow) {
            this.lastSlidingWindowKey = lastKey;

            // Initialize the lastSequentialSyncKey from sliding window.
            // Using a random key from the sliding window might be slightly better
            // than using the last key, but this is good enough.
            if(this.lastSequentialSyncKey === undefined) {
                this.lastSequentialSyncKey = lastKey;
            }
        } else if (mode === KeyRequestMode.SequentialStoreSync) {
            this.lastSequentialSyncKey = lastKey;
        }
    }

    /**
     * Send a CubeRequest message.
     * @param keys The list of cube keys to request.
     */
    sendCubeRequest(keys: CubeKey[]): void {
        const msg: CubeRequestMessage = new CubeRequestMessage(keys);
        logger.trace(`NetworkPeer ${this.toString()}: sending CubeRequest for ${keys.length} cubes`);
        this.setTimeout();  // expect a timely reply to this request
        this.sendMessage(msg);
    }

    /**
     * Send a SubscribeCube (or SubscribeNotifications) message.
     * @param keys The list of cube keys to subscribe to.
     */
    sendSubscribeCube(
            keys: CubeKey[],
            type: MessageClass.SubscribeCube | MessageClass.SubscribeNotifications = MessageClass.SubscribeCube,
    ): void {
        const msg: CubeRequestMessage = new CubeRequestMessage(keys, type);
        logger.trace(`NetworkPeer ${this.toString()}: sending SubscribeCube for ${keys.length} cubes`);
        this.setTimeout();  // expect a timely reply to this request
        this.sendMessage(msg);
    }

    /**
     * Send a NotificationRequest message.
     * @param keys The list of notification keys to request.
     */
    sendNotificationRequest(keys: NotificationKey[]): void {
        // NotificationRequests are a special type of CubeRequests
        const msg: CubeRequestMessage = new CubeRequestMessage(
            keys as unknown as CubeKey[],  // HACKHACK CubeKeys and NotificationKeys have the same format
            MessageClass.NotificationRequest);
        logger.trace(`NetworkPeer ${this.toString()}: sending NotificationRequest for ${keys.length} cubes`);
        this.setTimeout();  // expect a timely reply to this request
        this.sendMessage(msg);
    }

    sendPeerRequest(): void {
        if (!this.options.peerExchange) return;  // don't do anything if opted out
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

    // NOTE: must use arrow syntax to have this event handler pre-bound;
    //  otherwise, event subscription will not properly cancel on close
    private learnExchangeablePeer: (peer: Peer) => void = peer => {
        if (!this.equals(peer)) {  // but don't share a peer with itself
            this.unsentPeers.push(peer);
        }
    }

    // TODO: Wait just a tiny little bit after learning a Cube update so that
    // updates received in short succession get grouped together.
    // This reduces overhead massively and also keep updates neatly grouped
    // together for potential further forwarding at the receiving node.
    // NOTE: must use arrow syntax to have this event handler pre-bound;
    //  otherwise, event subscription will not properly cancel on close
    private sendSubscribedCubeUpdate: (cubeInfo: CubeInfo) => void = cubeInfo => {
        const cube: Cube = cubeInfo.getCube();
        if (this._cubeSubscriptions.has(cube.getKeyStringIfAvailable())) {
            const binaryCube: Buffer = cube.getBinaryDataIfAvailable();
            if (binaryCube === undefined) {
                logger.warn(`NetworkPeer ${this.toString()}.sendSubscribedCubeUpdate(): I was called on an apparently uncompiled Cube. This should not happen. Doing nothing.`);
                return;
            }
            const reply = new CubeResponseMessage([cube.getBinaryDataIfAvailable()]);
            this.sendMessage(reply);
        }
    }

    // TODO: Wait just a tiny little bit after learning a new notification so that
    // updates received in short succession get grouped together.
    // This reduces overhead massively and also keep updates neatly grouped
    // together for potential further forwarding at the receiving node.
    // NOTE: must use arrow syntax to have this event handler pre-bound;
    //  otherwise, event subscription will not properly cancel on close
    private sendNotificationUpdate: (notificationKey: CubeKey, cube: Cube) => void = (notificationKey, cube) => {
        if (this._notificationSubscriptions.has(keyVariants(notificationKey).keyString)) {
            const binaryCube: Buffer = cube.getBinaryDataIfAvailable();
            if (binaryCube === undefined) {
                logger.warn(`NetworkPeer ${this.toString()}.sendNotificationUpdate(): I was called on an apparently uncompiled Cube. This should not happen. Doing nothing.`);
                return;
            }
            const reply = new CubeResponseMessage([cube.getBinaryDataIfAvailable()]);
            this.sendMessage(reply);
        }
    }

    private setTimeout(): void {
        if (this.options.closeOnTimeout) {
            this.networkTimeout = setTimeout(() => {
                    logger.info(`NetworkPeer ${this.toString()} timed out a request, closing.`);
                    this.close()
                }, this.options.networkTimeoutMillis);
        }
    }
}

class NetworkPeerLifecycleStatus {
    value: NetworkPeerLifecycle = NetworkPeerLifecycle.CONNECTING;
    advance(newValue: NetworkPeerLifecycle): boolean {
        if (newValue > this.value) {
            this.value = newValue;
            return true;
        } else {
            // This can happen for example if a connection object reports being
            // ready really late, so that we might even register the Verity-level
            // handshake as complete first. In this case, we must avoid reducing
            // our lifecycle status back from ONLINE to HANDSHAKING.
            return false;
        }
    }
}
