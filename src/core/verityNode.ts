import { CubeStore } from "./cubeStore";
import { NetworkManager } from "./networkManager";
import { Peer, PeerDB, WebSocketAddress } from "./peerDB";

import { logger } from "./logger";
import { SupportedServerTypes } from "./networkServer";

export class VerityNode {
  cubeStore: CubeStore = new CubeStore();
  peerDB: PeerDB;
  networkManager: NetworkManager;

  onlinePromise: Promise<void>;
  cubeStoreReadyPromise: Promise<void>;
  readyPromise: Promise<any>;  // apparently combining a void promise with another void promise does not yield a void promise
  shutdownPromise: Promise<void>;

  constructor(
    /**
     * @member Is this a light client?
     * Light clients do not announce and do not accept incoming connections.
     * They also do not request cubes unless they are explicitly requested.
     */
    public readonly lightNode: boolean = false,
    public readonly servers: Map<SupportedServerTypes, any> = new Map(),
    private initialPeers = [],
    private announceToTorrentTrackers = false,
  ){
    // find a suitable port number for tracker announcement
    let port;
    const wsServerSpec = servers.get(SupportedServerTypes.ws);
    if (wsServerSpec) port = wsServerSpec;
    else port = undefined;
    this.peerDB = new PeerDB(port);
    if (port === undefined) this.announceToTorrentTrackers = false;

    // Start networking and inform clients when this node is fully ready
    this.networkManager = new NetworkManager(
      this.cubeStore, this.peerDB,
      this.servers,
      announceToTorrentTrackers, lightNode);
    this.onlinePromise = new Promise(resolve => this.networkManager.once('online', () => {
      resolve(undefined);
    }));
    this.cubeStoreReadyPromise = new Promise(resolve => this.cubeStore.once('ready', () => {
      resolve(undefined);
    }))
    this.readyPromise = Promise.all([this.onlinePromise, this.cubeStoreReadyPromise]);

    // Inform clients when this node will eventually shut down
    this.shutdownPromise = new Promise(resolve => this.networkManager.once('shutdown', () => {
      logger.info('NetworkManager has shut down. Exiting...');
      resolve(undefined);
    }));
    this.networkManager.start();

    if (initialPeers) {
      for (let i = 0; i < initialPeers.length; i++) {
        logger.info(`Adding initial peer ${initialPeers[i]}.`);
        const [initialPeerIp, initialPeerPort] = initialPeers[i].split(':');
        if (!initialPeerIp || !initialPeerPort) {
          logger.error('Invalid initial peer specified.');
        }
        const peer: Peer = new Peer(new WebSocketAddress(initialPeerIp, Number(initialPeerPort)));
        this.peerDB.learnPeer(peer);
      }
    }
  }

  shutdown() {
    this.networkManager.shutdown();
    this.peerDB.shutdown();
  }
}
