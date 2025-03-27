import type { CubeStore } from "../../cube/cubeStore";
import type { Peer } from "../../peering/peer";
import type { PeerDB } from "../../peering/peerDB";
import { SetNetworkManagerDefaults, type NetworkManagerIf, type NetworkManagerOptions } from "../networkManagerIf";
import type { TransportParamMap, NetworkTransport } from "../transport/networkTransport";
import type { CubeKey } from "../../cube/cube.definitions";

import { NetworkPeerIf, NetworkStats } from "../networkPeerIf";
import { RequestScheduler } from "../cubeRetrieval/requestScheduler";
import { SupportedTransports, NetConstants } from "../networkDefinitions";

import { EventEmitter } from "events";

// maybe TODO remove?
// Since we properly split out transports, NetworkManager itself is lean enough
// that a dummy version should no longer be needed.
export class DummyNetworkManager extends EventEmitter implements NetworkManagerIf {
  constructor(
      public cubeStore: CubeStore,
      public peerDB: PeerDB,
      public options: NetworkManagerOptions = {},
  ) {
    super();
    SetNetworkManagerDefaults(options);
    this.scheduler = new RequestScheduler(this, options);
  }

  shutdownPromise: Promise<void> = Promise.resolve();
  transports: Map<SupportedTransports, NetworkTransport>;
  scheduler: RequestScheduler;
  connect(peer: Peer): NetworkPeerIf { return undefined }
  autoConnectPeers(existingRun?: boolean): void {}
  incomingPeers: NetworkPeerIf[] = [];
  outgoingPeers: NetworkPeerIf[] = [];
  get onlinePeers(): NetworkPeerIf[] { return this.outgoingPeers.concat(this.incomingPeers).filter(peer => peer.online); }
  start(): Promise<void> { return Promise.resolve(); }
  shutdown(): Promise<void> { return Promise.resolve(); }
  getNetStatistics(): NetworkStats { return new NetworkStats(); }
  prettyPrintStats(): Promise<string> { return Promise.resolve(''); }
  online: boolean = false;
  id: Buffer = Buffer.alloc(NetConstants.PEER_ID_SIZE, 42);
  idString: string = this.id.toString('hex');
  get onlinePeerCount(): number { return this.onlinePeers.length };
  handlePeerClosed(peer: NetworkPeerIf): void { }
  closeAndBlockPeer(peer: NetworkPeerIf): void { }
  handlePeerOnline(peer: NetworkPeerIf): boolean { return true }
  getRecentSucceedingKeys(startKey: CubeKey, count: number): CubeKey[] {
    return [];  // TODO implement sensible default
  }
  getRecentKeys(): CubeKey[] { return []; }
  handlePeerUpdated(peer: NetworkPeerIf): void { }
}
