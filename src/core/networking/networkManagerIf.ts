import type { RequestScheduler, RequestSchedulerOptions } from './cubeRetrieval/requestScheduler';
import type { NetworkTransport, TransportParamMap } from './transport/networkTransport';
import type { CubeStore } from '../cube/cubeStore';
import type { Peer } from '../peering/peer';
import type { PeerDB } from '../peering/peerDB';
import type { SupportedTransports } from './networkDefinitions';
import type { NetworkStats, NetworkPeerIf, NetworkPeerOptions } from './networkPeerIf';
import type { CubeKey } from '../cube/cube.definitions';

import type { EventEmitter } from 'events';
import { Settings } from '../settings';


export interface NetworkManagerIf extends EventEmitter {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  getNetStatistics(): NetworkStats;
  prettyPrintStats(): Promise<string>;
  online: boolean;
  id: Buffer;
  idString: string;
  cubeStore: CubeStore;
  peerDB: PeerDB;
  onlinePeerCount: number;
  onlinePeers: NetworkPeerIf[];
  options: NetworkManagerOptions;
  transports: Map<SupportedTransports, NetworkTransport>;
  scheduler: RequestScheduler;
  connect(peer: Peer): NetworkPeerIf;
  autoConnectPeers(existingRun?: boolean): void;
  incomingPeers: NetworkPeerIf[];
  outgoingPeers: NetworkPeerIf[];
  shutdownPromise: Promise<void>;
  handlePeerClosed(peer: NetworkPeerIf): void;
  closeAndBlockPeer(peer: NetworkPeerIf): void;
  handlePeerOnline(peer: NetworkPeerIf): boolean;
  getRecentSucceedingKeys(startKey: CubeKey, count: number): CubeKey[];
  getRecentKeys(): CubeKey[];
  handlePeerUpdated(peer: NetworkPeerIf): void;
}

export interface NetworkManagerOwnOptions {
    /**
     * Specifies which transports shall be enabled.
     * The key of this map is a transport enum while the value contains
     * transport-specific options.
     */
    transports?: TransportParamMap;

    announceToTorrentTrackers?: boolean;

    /**
     * If true, we will never send any key or cube requests to this NetworkPeer
     * unless explicitly asked to.
     **/
    lightNode?: boolean;
    autoConnect?: boolean;
    publicAddress?: string; // TODO: move this to new TransportOptions
    useRelaying?: boolean; // TODO: move this to new TransportOptions
    newPeerInterval?: number;
    connectRetryInterval?: number;
    reconnectInterval?: number;
    maximumConnections?: number;
    acceptIncomingConnections?: boolean;
    recentKeyWindowSize?: number;
}

export type NetworkManagerOptions =
    NetworkManagerOwnOptions & RequestSchedulerOptions & NetworkPeerOptions;


export function SetNetworkManagerDefaults(options: NetworkManagerOptions = {}): void {
  options.newPeerInterval = options?.newPeerInterval ?? Settings.NEW_PEER_INTERVAL;
  options.connectRetryInterval = options?.connectRetryInterval ?? Settings.CONNECT_RETRY_INTERVAL;
  options.reconnectInterval = options?.reconnectInterval ?? Settings.RECONNECT_INTERVAL;
  options.maximumConnections = options?.maximumConnections ?? Settings.MAXIMUM_CONNECTIONS;
  options.acceptIncomingConnections = options?.acceptIncomingConnections ?? true;
  options.announceToTorrentTrackers = options?.announceToTorrentTrackers ?? true;
  options.lightNode = options?.lightNode ?? true;
  options.autoConnect = options?.autoConnect ?? true;
  options.recentKeyWindowSize = options?.recentKeyWindowSize ?? Settings.RECENT_KEY_WINDOW_SIZE;
}
