import { CubeStore, CubeStoreOptions } from "./cube/cubeStore";
import { SupportedTransports } from "./networking/networkDefinitions";
import { NetworkManager, NetworkManagerOptions } from "./networking/networkManager";
import { CubeRetriever } from "./networking/cubeRetrieval/cubeRetriever";
import { AddressAbstraction } from "./peering/addressing";
import { Peer } from "./peering/peer";
import { PeerDB } from "./peering/peerDB";

import { logger } from "./logger";

export type VerityNodeOptions = NetworkManagerOptions & CubeStoreOptions;

export class VerityNode {
  readonly cubeStore: CubeStore;
  readonly peerDB: PeerDB;
  readonly networkManager: NetworkManager;
  readonly cubeRetriever: CubeRetriever;

  readonly onlinePromise: Promise<void>;
  readonly readyPromise: Promise<void>;
  readonly shutdownPromise: Promise<void>;

  constructor(
    /**
     * @member Is this a light client?
     * Light clients do not announce and do not accept incoming connections.
     * They also do not request cubes unless they are explicitly requested.
     */
    public readonly servers: Map<SupportedTransports, any> = new Map(),
    private initialPeers: Array<AddressAbstraction> = [],
    options: VerityNodeOptions = {}
  ){
    this.cubeStore = new CubeStore(options);
    // find a suitable port number for tracker announcement
    let port;
    const wsServerSpec = servers.get(SupportedTransports.ws);
    if (wsServerSpec) port = wsServerSpec;
    else port = undefined;
    this.peerDB = new PeerDB(port);
    if (port === undefined) options.announceToTorrentTrackers = false;

    // Start networking and inform clients when this node is fully ready
    this.networkManager = new NetworkManager(
      this.cubeStore, this.peerDB,
      this.servers,
      options);
    this.onlinePromise = new Promise(resolve => this.networkManager.once('online', () => {
      resolve(undefined);
    }));
    this.readyPromise = this.cubeStore.readyPromise;  // that's a little useless
    // Construct cube retrieval helper object
    this.cubeRetriever =
      new CubeRetriever(this.cubeStore, this.networkManager.scheduler);

    // Inform clients when this node will eventually shut down
    this.shutdownPromise = new Promise(resolve => this.networkManager.once('shutdown', () => {
      logger.info('NetworkManager has shut down. Exiting...');
      resolve(undefined);
    }));
    this.networkManager.start();

    for (const initialPeer of initialPeers) {
      this.peerDB.learnPeer(new Peer(initialPeer));
    }
  }

  shutdown(): Promise<void> {
    this.networkManager.shutdown();
    this.peerDB.shutdown();
    return this.shutdownPromise;
  }
}
