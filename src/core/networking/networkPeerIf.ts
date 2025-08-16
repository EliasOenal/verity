import { CubeKey, NotificationKey } from '../cube/cube.definitions';
import type { AddressAbstraction } from '../peering/addressing';
import type { Peer } from '../peering/peer';
import type { MessageClass, NodeType } from './networkDefinitions';
import type { NetworkMessage, KeyRequestMode, CubeFilterOptions } from './networkMessage';
import type { TransportConnection } from './transport/transportConnection';


export interface NetworkPeerIf extends Peer {
    stats: NetworkStats;
    status: NetworkPeerLifecycle;
    onlinePromise: Promise<NetworkPeerIf>;
    online: boolean;
    conn: TransportConnection;
    cubeSubscriptions: Iterable<string>;
    options: NetworkPeerOptions;
    remoteNodeType?: NodeType;

    close(): Promise<void>;
    sendMessage(msg: NetworkMessage): void;
    sendMyServerAddress(): void;
    sendKeyRequests(): void;
    sendSpecificKeyRequest(mode: KeyRequestMode, options?: CubeFilterOptions): void;
    sendCubeRequest(keys: CubeKey[]): void;
    sendSubscribeCube(keys: CubeKey[], type?: MessageClass.SubscribeCube | MessageClass.SubscribeNotifications): void;
    sendNotificationRequest(keys: NotificationKey[]): void; // maybe deprecated
    sendPeerRequest(): void;
}

export interface NetworkPeerOptions {
    extraAddresses?: AddressAbstraction[];
    peerExchange?: boolean;
    networkTimeoutMillis?: number;
    closeOnTimeout?: boolean;
    cubeSubscriptionPeriod?: number;
}

export class NetworkStats {
    tx: OneWayNetworkStats = new OneWayNetworkStats();
    rx: OneWayNetworkStats = new OneWayNetworkStats();
}
export class OneWayNetworkStats {
    messages: number = 0;
    bytes: number = 0;
    messageTypes: {
        [key in MessageClass]?: PacketStats;
    } = {};
}
export class PacketStats {
    count: number = 0;
    bytes: number = 0;
}


export enum NetworkPeerLifecycle {
    CONNECTING = 1,
    HANDSHAKING = 2,
    ONLINE = 3,
    CLOSING = 4,
    CLOSED = 5
}

