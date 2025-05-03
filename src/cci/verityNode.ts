import { CubeRequestOptions } from "../core/networking/cubeRetrieval/requestScheduler";
import { CoreNode, CoreNodeIf, CoreNodeOptions } from "../core/coreNode";
import { VeritumRetriever } from "./veritum/veritumRetriever";
import { CubeStore } from "../core/cube/cubeStore";
import { DummyNetworkManager } from "../core/networking/testingDummies/dummyNetworkManager";
import { PeerDB } from "../core/peering/peerDB";
import { cciFamily } from "./cube/cciCube";

export interface VerityNodeIf extends CoreNodeIf {
  veritumRetriever: VeritumRetriever<any>;
}

export interface VerityNodeOptions extends CoreNodeOptions {
}

export class VerityNode extends CoreNode {
  readonly veritumRetriever: VeritumRetriever<CubeRequestOptions>;

  static async Create(options: VerityNodeOptions = {}): Promise<VerityNode> {
    const v = new VerityNode(options);
    await v.readyPromise;
    return v;
  }

  constructor(options: VerityNodeOptions = {}){
    super(options);
    this.veritumRetriever = new VeritumRetriever(this.cubeRetriever);
  }

  shutdown(): Promise<void> {
    return Promise.all([
      this.veritumRetriever.shutdown(),
      super.shutdown(),
    ]).then();
  }
}

/**
 * Assemble a dummy VerityNode, i.e. one with a DummyNetworkManager.
 * For testing only.
 */
export function dummyVerityNode(options: VerityNodeOptions = {}): VerityNode {
  // enforce some essential testing options:
  options = {
    ... options,
    inMemory: true,
    announceToTorrentTrackers: false,
  };

  // set default options
  options.initialPeers ??= [];
  options.peerExchange ??= false;
  options.requiredDifficulty ??= 0;
  options.family ??= cciFamily;

  const cubeStore = new CubeStore(options);
  const peerDB = new PeerDB();
  const networkManager = new DummyNetworkManager(cubeStore, peerDB, options);

  const node = new VerityNode({
    ... options,
    cubeStore,
    peerDB,
    networkManager,
  });
  return node;
}
