import { CubeRetrievalInterface, CubeStore, CubeStoreOptions } from "./cube/cubeStore";
import { SupportedTransports } from "./networking/networkDefinitions";
import { DummyNetworkManager, NetworkManager, NetworkManagerIf, NetworkManagerOptions } from "./networking/networkManager";
import { CubeRetriever } from "./networking/cubeRetrieval/cubeRetriever";
import { AddressAbstraction } from "./peering/addressing";
import { Peer } from "./peering/peer";
import { PeerDB } from "./peering/peerDB";

import { logger } from "./logger";
import { RequestScheduler } from "./networking/cubeRetrieval/requestScheduler";

interface InitialisationOptions {
  initialPeers?: AddressAbstraction[],
}

// Default initial peers to use if none are supplied as command line options:
export const defaultInitialPeers: AddressAbstraction[] = [
  new AddressAbstraction("verity.hahn.mt:1984"),
  new AddressAbstraction("/dns4/verity.hahn.mt/tcp/1985/wss"),
  // new AddressAbstraction("verity.hahn.mt:1985"),
  // new AddressAbstraction("verity.hahn.mt:1986"),
  // new AddressAbstraction("132.145.174.233:1984"),
  // new AddressAbstraction("158.101.100.95:1984"),
];

export type VerityNodeOptions = NetworkManagerOptions & CubeStoreOptions & InitialisationOptions;

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

  static async Create(options: VerityNodeOptions = {}): Promise<VerityNode> {
    const v = new VerityNode(options);
    await v.readyPromise;
    return v;
  }

  constructor(options: VerityNodeOptions = {}){
    // set default options
    options.transports ??= new Map();  // TODO use sensible default
    options.initialPeers ??= defaultInitialPeers;
    options.inMemory ??= true;

    this.cubeStore = new CubeStore(options);
    // find a suitable port number for tracker announcement
    let port;
    const wsServerSpec = options.transports.get(SupportedTransports.ws);
    if (wsServerSpec) port = wsServerSpec;
    else port = undefined;
    this.peerDB = new PeerDB(port);
    if (port === undefined) options.announceToTorrentTrackers = false;

    // Prepare networking
    this.networkManager = new NetworkManager(
      this.cubeStore, this.peerDB, options);
    // Only start networking once our CubeStore is ready
    this.cubeStore.readyPromise.then(() => this.networkManager.start());
    // Let user know when we are online
    this.onlinePromise = new Promise(resolve =>
      this.networkManager.once('online', () => { resolve(undefined) }));

    // Let the user know when the Node object is ready to use.
    // Currently, this only depends on CubeStore being ready.
    // It notably does not depend on us being online as Verity can very much
    // also be used while offline.
    this.readyPromise = this.cubeStore.readyPromise;  // that's a little useless, I know

    // Construct cube retrieval helper object
    this.cubeRetriever =
      new CubeRetriever(this.cubeStore, this.networkManager.scheduler);

    // Inform clients when this node will eventually shut down
    this.shutdownPromise = new Promise(resolve => {
      Promise.all([
        this.networkManager.shutdownPromise,
        this.cubeStore.shutdownPromise,
        this.peerDB.shutdownPromise
      ]).then(() => resolve(undefined));
    });

    // Learn initial peers
    for (const initialPeer of options.initialPeers) {
      this.peerDB.learnPeer(new Peer(initialPeer));
    }
  }

  shutdown(): Promise<void> {
    this.networkManager.shutdown();
    this.cubeStore.shutdown();
    this.peerDB.shutdown();
    this.cubeRetriever.shutdown();
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
  get readyPromise(): Promise<void> { return this.cubeStore.readyPromise }
  readonly shutdownPromise: Promise<void>;

  constructor(){
    this.cubeStore = new CubeStore({inMemory: true});
    this.peerDB = new PeerDB();
    this.networkManager = new DummyNetworkManager(this.cubeStore, this.peerDB);
    this.cubeRetriever = new CubeRetriever(this.cubeStore, new RequestScheduler(this.networkManager));
    this.onlinePromise = Promise.resolve(undefined);
    this.shutdownPromise = Promise.resolve(undefined);
  }

  shutdown(): Promise<void> {
    return this.shutdownPromise;
  }
}
