import type { CubeStore } from "../../cube/cubeStore";
import type { Peer } from "../../peering/peer";
import type { PeerDB } from "../../peering/peerDB";
import type { NetworkManagerIf, NetworkManagerOptions } from "../networkManagerIf";
import type { TransportParamMap, NetworkTransport } from "../transport/networkTransport";

import { NetworkPeerIf, NetworkStats } from "../networkPeerIf";
import { RequestScheduler } from "../cubeRetrieval/requestScheduler";
import { SupportedTransports, NetConstants } from "../networkDefinitions";
import { NetworkManager } from "../networkManager";

import EventEmitter from "events";

export class DummyNetworkManager extends EventEmitter implements NetworkManagerIf {
  constructor(public cubeStore: CubeStore, public peerDB: PeerDB, transports: TransportParamMap = new Map(), public options: NetworkManagerOptions = {}) {
      super();
      NetworkManager.SetDefaults(options);
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
}
