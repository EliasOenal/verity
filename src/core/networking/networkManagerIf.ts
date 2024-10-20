import type { RequestScheduler, RequestSchedulerOptions } from './cubeRetrieval/requestScheduler';
import type { NetworkTransport, TransportParamMap } from './transport/networkTransport';
import type { CubeStore } from '../cube/cubeStore';
import type { Peer } from '../peering/peer';
import type { PeerDB } from '../peering/peerDB';
import type { SupportedTransports } from './networkDefinitions';
import type { NetworkStats, NetworkPeerIf } from './networkPeerIf';

import type { EventEmitter } from 'events';

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
    peerExchange?: boolean;
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
    NetworkManagerOwnOptions & RequestSchedulerOptions;
