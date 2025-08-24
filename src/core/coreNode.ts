import { CubeStore, CubeStoreOptions } from "./cube/cubeStore";
import { SupportedTransports } from "./networking/networkDefinitions";
import { NetworkManager } from "./networking/networkManager";
import { NetworkManagerIf, NetworkManagerOptions } from './networking/networkManagerIf';
import { CubeRetriever } from "./networking/cubeRetrieval/cubeRetriever";
import { AddressAbstraction } from "./peering/addressing";
import { Peer } from "./peering/peer";
import { PeerDB } from "./peering/peerDB";
import { RequestScheduler } from "./networking/cubeRetrieval/requestScheduler";
import { DummyNetworkManager } from "./networking/testingDummies/dummyNetworkManager";


// Default initial peers to use if none are supplied as command line options:
export const defaultInitialPeers: AddressAbstraction[] = [
  new AddressAbstraction("verity.hahn.mt:1984"),
  new AddressAbstraction("/dns4/verity.hahn.mt/tcp/1985/wss"),
  new AddressAbstraction("/dns4/verity0.open-bash.org/tcp/1985/ws"),
  new AddressAbstraction("/dns4/verity0.open-bash.org/tcp/1986/wss"),
  new AddressAbstraction("verity0.open-bash.org:1984"),
  new AddressAbstraction("/dns4/verity1.open-bash.org/tcp/1985/ws"),
  new AddressAbstraction("/dns4/verity1.open-bash.org/tcp/1986/wss"),
  new AddressAbstraction("verity1.open-bash.org:1984"),
];

export interface CoreNodeOptions extends NetworkManagerOptions, CubeStoreOptions {
  /** Try to auto-connect to these peers */
  initialPeers?: AddressAbstraction[],

  /**
   * Optionally use this existing CubeStore instance.
   * For testing mainly, do not use unless you know what you are doing.
   **/
  cubeStore?: CubeStore,

  /**
   * Optionally use this existing PeerDB instance.
   * For testing mainly, do not use unless you know what you are doing.
   **/
  peerDB?: PeerDB,

  /**
   * Optionally use this existing NetworkManager instance.
   * For testing mainly, do not use unless you know what you are doing.
   * If you do use it, it's on you to assemble the system properly.-- i.e.
   * supply your own CubeStore and PeerDB and feed them to your NetworkManager.
   **/
  networkManager?: NetworkManagerIf,
}

export interface CoreNodeIf {
  readonly cubeStore: CubeStore;
  readonly peerDB: PeerDB;
  readonly networkManager: NetworkManagerIf;
  readonly cubeRetriever: CubeRetriever;

  readonly onlinePromise: Promise<void>;
  readonly readyPromise: Promise<void>;
  readonly shutdownPromise: Promise<void>;

  shutdown(): Promise<void>;
}

export class CoreNode implements CoreNodeIf {
  readonly cubeStore: CubeStore;
  readonly peerDB: PeerDB;
  readonly networkManager: NetworkManagerIf;
  readonly cubeRetriever: CubeRetriever;

  readonly onlinePromise: Promise<void>;
  readonly readyPromise: Promise<void>;
  readonly shutdownPromise: Promise<void>;

  static async Create(options: CoreNodeOptions = {}): Promise<CoreNode> {
    const v = new CoreNode(options);
    await v.readyPromise;
    return v;
  }

  constructor(options: CoreNodeOptions = {}){
    // set default options
    options.transports ??= new Map();  // TODO use sensible default
    options.initialPeers ??= defaultInitialPeers;
    options.inMemory ??= true;

    this.cubeStore = options.cubeStore ?? new CubeStore(options);
    // find a suitable port number for tracker announcement
    let port;
    const wsServerSpec = options.transports.get(SupportedTransports.ws);
    if (wsServerSpec) port = wsServerSpec;
    else port = undefined;
    this.peerDB = options.peerDB ?? new PeerDB(port);
    if (port === undefined) options.announceToTorrentTrackers = false;

    // Prepare networking
    this.networkManager = options.networkManager ?? new NetworkManager(
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
    return this.shutdownPromise;
  }
}
