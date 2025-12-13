import type { NetworkPeerIf } from '../networkPeerIf';
import { type NetworkMessage, type SubscriptionResponseCode, type SubscriptionConfirmationMessage, KeyRequestMode, ServerAddressMessage, KeyRequestMessage, CubeRequestMessage, SubscribeCubeMessage, PeerRequestMessage } from '../networkMessage';
import type { NetworkStats, NetworkPeerLifecycle, NetworkPeerOptions } from '../networkPeerIf';
import type { NetworkManagerIf } from '../networkManagerIf';

import { Settings } from '../../settings';
import { CubeKey, NotificationKey } from '../../cube/coreCube.definitions';
import { CubeStore } from '../../cube/cubeStore';
import { Peer } from '../../peering/peer';
import { PeerDB } from '../../peering/peerDB';
import { TransportConnection } from '../transport/transportConnection';
import { DummyNetworkManager } from './dummyNetworkManager';
import { DummyTransportConnection } from './dummyTransportConnection';
import { MessageClass, NetConstants, NodeType } from '../networkDefinitions';
import { CoreCube } from '../../cube/coreCube';
import { webcrypto as crypto } from 'crypto';

export class DummyNetworkPeer extends Peer implements NetworkPeerIf {
    stats: NetworkStats;
    status: NetworkPeerLifecycle;
    onlinePromise: Promise<NetworkPeerIf> = Promise.resolve(this);
    online: boolean = true;
    cubeSubscriptions: string[] = [];
    remoteNodeType?: NodeType = NodeType.Full; // Default to full node for tests
    close(): Promise<void> { return Promise.resolve(); }

    sendMessage(msg: NetworkMessage): void { this.sentMessages.push(msg) }
    sendMyServerAddress(): void { this.sentMessages.push(new ServerAddressMessage(this.address)) }
    sendKeyRequests(): void { this.sentMessages.push(new KeyRequestMessage(KeyRequestMode.SequentialStoreSync)) }
    sendSpecificKeyRequest(mode: KeyRequestMode, keyCount?: number, startKey?: Buffer): void { }
    sendCubeRequest(keys: CubeKey[]): void { this.sentMessages.push(new CubeRequestMessage(keys)) }

    async sendSubscribeCube(
            keys: CubeKey[],
            type: MessageClass.SubscribeCube | MessageClass.SubscribeNotifications = MessageClass.SubscribeCube,
            mockResponse?: SubscriptionConfirmationMessage,
    ): Promise<void> {
        this.sentMessages.push(new SubscribeCubeMessage(keys, type));
        if (mockResponse !== undefined) {
            this.networkManager.scheduler.handleSubscriptionConfirmation(mockResponse, this);
        }
    }

    sendNotificationRequest(keys: NotificationKey[]): void { this.sentMessages.push(new CubeRequestMessage(keys as unknown as CubeKey[], MessageClass.NotificationRequest)) }
    sendPeerRequest(): void { this.sentMessages.push(new PeerRequestMessage()) }

    sentMessages: NetworkMessage[] = [];

    constructor(
        private networkManager?: NetworkManagerIf,
        public conn: TransportConnection = undefined,
        private cubeStore?: CubeStore,
        readonly options: NetworkPeerOptions = {}
    ) {
        if (conn === undefined) conn = new DummyTransportConnection();
        if (cubeStore === undefined) cubeStore = new CubeStore({
            inMemory: true,
            enableCubeCache: false,
        });
        super(conn.address);
        this.conn = conn;
        if (networkManager === undefined) this.networkManager = new DummyNetworkManager(
            cubeStore, new PeerDB());

        // Make random peer ID
        if (this._id === undefined) {
            this._id = Buffer.from(crypto.getRandomValues(new Uint8Array(NetConstants.PEER_ID_SIZE)));
        }

        // set opts
        this.options.peerExchange ??= true;
        this.options.networkTimeoutMillis ??= Settings.NETWORK_TIMEOUT;
    }

    toString() {
        return `${this.addressString} (ID#${this._id?.toString('hex')})`;
    }
}
