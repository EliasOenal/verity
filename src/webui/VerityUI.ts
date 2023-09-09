import { fullNode } from '../fullNode';
import { logger } from '../model/logger'

import { CubeDisplay } from './CubeDisplay';
import { PeerDisplay } from './PeerDisplay';
import { Identity } from '../viewmodel/identity';
import { FieldParser } from '../model/fieldParser';
import { zwFieldDefinition } from '../viewmodel/zwFields';
import { isBrowser } from 'browser-or-node';
import { ZwAnnotationEngine } from '../viewmodel/zwAnnotationEngine';
import { makePost } from '../viewmodel/zwCubes';

import sodium, { KeyPair } from 'libsodium-wrappers'
import { Buffer } from 'buffer'

export class VerityUI {
  private static _zwFieldParser: FieldParser = undefined;
  static get zwFieldParser(): FieldParser {
    if (!VerityUI._zwFieldParser) {
      VerityUI._zwFieldParser = new FieldParser(zwFieldDefinition);
    }
    return VerityUI._zwFieldParser;
  }

  /**
   * Workaround to those damn omnipresent async constructs.
   * Always create your VerityUI this way or it won't have an Identity 🤷
   */
  static async Construct(node: fullNode): Promise<VerityUI> {
    const ui: VerityUI = new VerityUI(node);
    await ui.initializeIdentity();
    return ui;
  }

  node: fullNode = undefined;  // TODO: change this to a Node base class that still needs to be defined, so we can transparently use the UI with full and light nodes (actually not "Node", "Node" is a DOM class... make it VerityNode or something)
  annotationEngine: ZwAnnotationEngine;
  identity: Identity;

  cubeDisplay: CubeDisplay = undefined;
  peerDisplay: PeerDisplay = undefined;


  constructor(node: fullNode) {
    this.node = node;

    this.peerDisplay = new PeerDisplay(this);
    this.peerDisplay.redisplayPeers();

    this.annotationEngine = new ZwAnnotationEngine(this.node.cubeStore);
    this.cubeDisplay = new CubeDisplay(this.node.cubeStore, this.annotationEngine);
  }

  shutdown() {
    this.cubeDisplay.shutdown();
  }

  async initializeIdentity(): Promise<void> {
    this.identity = await Identity.retrieve(this.node.cubeStore);
    (document.getElementById("idname") as HTMLInputElement).value = this.identity.name;
  }

  saveIdentity(): void {
    this.identity.name = (document.getElementById("idname") as HTMLInputElement).value;
    this.identity.store();
  }

  async makeNewPost(text: string) {
    this.node.cubeStore.addCube(await makePost(text, undefined, this.identity));
    this.identity.store();
  }

  async postReply(text: string, replyto: string) {
    this.node.cubeStore.addCube(await makePost(text, Buffer.from(replyto, 'hex'), this.identity));
    this.identity.store();
  }
}

async function webmain() {
  logger.info('Starting web node');
  await sodium.ready;

  const node = new fullNode();
  await node.onlinePromise;
  logger.info("Node is online");

  const verityUI = await VerityUI.Construct(node);
  // @ts-ignore TypeScript does not like us creating extra window attributes
  window.verityUI = verityUI;

  await node.shutdownPromise;
  verityUI.shutdown();
}

if (isBrowser) webmain();
