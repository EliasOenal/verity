import type { NetworkPeerIf } from '../networkPeerIf';
import type { NetworkMessage, KeyRequestMode, CubeFilterOptions } from '../networkMessage';
import type { NetworkStats, NetworkPeerLifecycle, NetworkPeerOptions } from '../networkPeerIf';
import type { NetworkManagerIf } from '../networkManagerIf';

import { CubeStore } from '../../cube/cubeStore';
import { Peer } from '../../peering/peer';
import { PeerDB } from '../../peering/peerDB';
import { TransportConnection, DummyTransportConnection } from '../transport/transportConnection';
import { DummyNetworkManager } from './networkManagerDummy';

export class DummyNetworkPeer extends Peer implements NetworkPeerIf {
    stats: NetworkStats;
    status: NetworkPeerLifecycle;
    onlinePromise: Promise<NetworkPeerIf> = Promise.resolve(this);
    online: boolean = true;
    conn: TransportConnection;
    cubeSubscriptions: string[] = [];
    close(): Promise<void> { return Promise.resolve(); }
    sendMessage(msg: NetworkMessage): void { }
    sendMyServerAddress(): void { }
    sendKeyRequests(): void { }
    sendSpecificKeyRequest(mode: KeyRequestMode, options: CubeFilterOptions = {}): void { }
    sendCubeRequest(keys: Buffer[]): void { }
    sendSubscribeCube(keys: Buffer[]): void { }
    sendNotificationRequest(keys: Buffer[]): void { }
    sendPeerRequest(): void { }

    constructor(
        networkManager?: NetworkManagerIf,
        conn?: TransportConnection,
        cubeStore?: CubeStore,
        options: NetworkPeerOptions = {}
    ) {
        if (conn === undefined) conn = new DummyTransportConnection();
        if (cubeStore === undefined) cubeStore = new CubeStore({
            inMemory: true,
            enableCubeCache: false,
        });
        if (networkManager === undefined) networkManager = new DummyNetworkManager(
            cubeStore, new PeerDB());
        super(conn.address);
    }
}
