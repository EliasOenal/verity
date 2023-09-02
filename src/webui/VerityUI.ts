import { CubeDisplay } from './CubeDisplay';
import { PeerDisplay } from './PeerDisplay';
import { logger } from '../model/logger'
import { fullNode } from '../fullNode';

export class VerityUI {
  node: fullNode = undefined;  // TODO: change this to a Node base class that still needs to be defined, so we can transparently use the UI with full and light nodes (actually not "Node", "Node" is a DOM class... make it VerityNode or something)
  cubeDisplay: CubeDisplay;
  peerDisplay: PeerDisplay;

  constructor(node: fullNode) {
    this.node = node;

    this.peerDisplay = new PeerDisplay(this);
    this.peerDisplay.redisplayPeers();

    this.cubeDisplay = new CubeDisplay(this);
    this.cubeDisplay.redisplayCubes();
  }
}

async function webmain(node: fullNode) {
  logger.trace("in web main");
  // @ts-ignore TypeScript does not like us creating extra window attributes.. TODO refactor this
  window.verityUI = new VerityUI(node);
  // @ts-ignore TypeScript does not recognize window.verityUI even though it was defined right in the previous line
  await node.shutdownPromise;
}

// @ts-ignore TypeScript does not like us creating extra window attributes
window.webmain = webmain;
