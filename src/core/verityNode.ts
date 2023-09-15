import { CubeStore } from "./cubeStore";
import { NetworkManager } from "./networkManager";
import { Peer, PeerDB } from "./peerDB";

import { logger } from "./logger";

export class VerityNode {
  port = 1984;
  cubeStore: CubeStore = new CubeStore();
  peerDB: PeerDB = new PeerDB(this.port);
  networkManager: NetworkManager;

  onlinePromise: Promise<any>;
  cubeStoreReadyPromise: Promise<any>;
  readyPromise: Promise<any>;
  shutdownPromise: Promise<any>;

  constructor(
    /**
     * @member Is this a light client?
     * Light clients do not announce and do not accept incoming connections.
     * They also do not request cubes unless they are explicitly requested.
     */
    public readonly lightNode: boolean = false,

    port = 1984,
    private initialPeers = [],
    private announceToTorrentTrackers = false,

  ){
    if (lightNode) this.port = undefined;
    else this.port = port;

    // Start networking and inform client's when this node is fully ready
    this.networkManager = new NetworkManager(
      this.port, this.cubeStore, this.peerDB, announceToTorrentTrackers, lightNode);
    this.onlinePromise = new Promise(resolve => this.networkManager.once('online', () => {
      resolve(undefined);
    }));
    this.cubeStoreReadyPromise = new Promise(resolve => this.cubeStore.once('ready', () => {
      resolve(undefined);
    }))
    this.readyPromise = Promise.all([this.onlinePromise, this.cubeStoreReadyPromise]);

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
        const peer: Peer = new Peer(initialPeerIp, Number(initialPeerPort));
        this.peerDB.setPeersUnverified([peer]);
        this.networkManager.connect(peer);
      }
    }
  }
}
