import type { NetworkPeerIf } from '../networkPeerIf';
import type { NetworkMessage, KeyRequestMode, CubeFilterOptions, SubscriptionResponseCode, SubscriptionConfirmationMessage } from '../networkMessage';
import type { NetworkStats, NetworkPeerLifecycle, NetworkPeerOptions } from '../networkPeerIf';
import type { NetworkManagerIf } from '../networkManagerIf';

import { CubeStore } from '../../cube/cubeStore';
import { Peer } from '../../peering/peer';
import { PeerDB } from '../../peering/peerDB';
import { TransportConnection } from '../transport/transportConnection';
import { DummyNetworkManager } from './networkManagerDummy';
import { DummyTransportConnection } from './DummyTransportConnection';
import { NetConstants } from '../networkDefinitions';

export class DummyNetworkPeer extends Peer implements NetworkPeerIf {
    stats: NetworkStats;
    status: NetworkPeerLifecycle;
    onlinePromise: Promise<NetworkPeerIf> = Promise.resolve(this);
    online: boolean = true;
    cubeSubscriptions: string[] = [];
    close(): Promise<void> { return Promise.resolve(); }
    sendMessage(msg: NetworkMessage): void { }
    sendMyServerAddress(): void { }
    sendKeyRequests(): void { }
    sendSpecificKeyRequest(mode: KeyRequestMode, options: CubeFilterOptions = {}): void { }
    sendCubeRequest(keys: Buffer[]): void { }

    async sendSubscribeCube(
            keys: Buffer[],
            mockResponse?: SubscriptionConfirmationMessage,
    ): Promise<void> {
        if (mockResponse !== undefined) {
            this.networkManager.scheduler.handleSubscriptionConfirmation(mockResponse);
        }
    }

    sendNotificationRequest(keys: Buffer[]): void { }
    sendPeerRequest(): void { }

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
    }

    toString() {
        return `${this.addressString} (ID#${this._id?.toString('hex')})`;
    }
}
