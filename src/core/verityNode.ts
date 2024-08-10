import { CubeRetrievalInterface, CubeStore, CubeStoreOptions, EnableCubePersitence } from "./cube/cubeStore";
import { SupportedTransports } from "./networking/networkDefinitions";
import { DummyNetworkManager, NetworkManager, NetworkManagerIf, NetworkManagerOptions } from "./networking/networkManager";
import { CubeRetriever } from "./networking/cubeRetrieval/cubeRetriever";
import { AddressAbstraction } from "./peering/addressing";
import { Peer } from "./peering/peer";
import { PeerDB } from "./peering/peerDB";

import { logger } from "./logger";
import { LevelPersistence } from "./cube/levelPersistence";
import { RequestScheduler } from "./networking/cubeRetrieval/requestScheduler";

export type VerityNodeOptions = NetworkManagerOptions & CubeStoreOptions;

export interface VerityNodeIf {
  readonly cubeStore: CubeStore;
  readonly peerDB: PeerDB;
  readonly networkManager: NetworkManagerIf;
  readonly cubeRetriever: CubeRetriever;

  readonly onlinePromise: Promise<void>;
  readonly readyPromise: Promise<void>;
  readonly shutdownPromise: Promise<void>;

  shutdown(): Promise<void>;
}

export class VerityNode implements VerityNodeIf {
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

    // Prepare networking
    this.networkManager = new NetworkManager(
      this.cubeStore, this.peerDB,
      this.servers,
      options);
    // Only start networking once our CubeStore is ready
    this.cubeStore.readyPromise.then(() => this.networkManager.start());
    // Let user know when we are online
    this.onlinePromise = new Promise(resolve => this.networkManager.once('online', () => {
      resolve(undefined);
    }));

    // Let the user know when the Node object is ready to use.
    // Currently, this only depends on CubeStore being ready.
    // It notably does not depend on us being online as Verity can very much
    // also be used while offline.
    this.readyPromise = this.cubeStore.readyPromise;  // that's a little useless, I know

    // Construct cube retrieval helper object
    this.cubeRetriever =
      new CubeRetriever(this.cubeStore, this.networkManager.scheduler);

    // Inform clients when this node will eventually shut down
    this.shutdownPromise = new Promise(resolve => this.networkManager.once('shutdown', () => {
      logger.info('NetworkManager has shut down. Exiting...');
      resolve(undefined);
    }));

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


/** Dummy for testing only */
export class DummyVerityNode implements VerityNodeIf {
  readonly cubeStore: CubeStore;
  readonly peerDB: PeerDB;
  readonly networkManager: NetworkManagerIf;
  readonly cubeRetriever: CubeRetriever;

  readonly onlinePromise: Promise<void>;
  readonly readyPromise: Promise<void>;
  readonly shutdownPromise: Promise<void>;

  constructor(){
    this.cubeStore = new CubeStore({enableCubePersistence: EnableCubePersitence.OFF});
    this.peerDB = new PeerDB();
    this.networkManager = new DummyNetworkManager(this.cubeStore, this.peerDB);
    this.cubeRetriever = new CubeRetriever(this.cubeStore, new RequestScheduler(this.networkManager));
    this.onlinePromise = Promise.resolve(undefined);
    this.readyPromise = Promise.resolve(undefined);
    this.shutdownPromise = Promise.resolve(undefined);
  }

  shutdown(): Promise<void> {
    return this.shutdownPromise;
  }
}
