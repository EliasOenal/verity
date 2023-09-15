import { VerityNode } from '../core/verityNode';
import { logger } from '../core/logger'

import { PostDisplay } from './PostDisplay';
import { PeerDisplay } from './PeerDisplay';
import { Identity } from '../app/identity';
import { FieldParser } from '../core/fieldParser';
import { zwFieldDefinition } from '../app/zwFields';
import { isBrowser } from 'browser-or-node';
import { ZwAnnotationEngine } from '../app/zwAnnotationEngine';
import { makePost } from '../app/zwCubes';

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
  static async Construct(node: VerityNode): Promise<VerityUI> {
    const ui: VerityUI = new VerityUI(node);
    await ui.initializeIdentity();
    return ui;
  }

  node: VerityNode = undefined;
  annotationEngine: ZwAnnotationEngine;
  identity: Identity;

  postDisplay: PostDisplay = undefined;
  peerDisplay: PeerDisplay = undefined;


  constructor(node: VerityNode) {
    this.node = node;

    this.peerDisplay = new PeerDisplay(this);
    this.peerDisplay.redisplayPeers();

    this.annotationEngine = new ZwAnnotationEngine(this.node.cubeStore);
    this.postDisplay = new PostDisplay(this.node.cubeStore, this.annotationEngine);
  }

  shutdown() {
    this.node.shutdown();
    this.postDisplay.shutdown();
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

  // default params
  const lightNode = false;
  const port = undefined;  // no listening web sockets allowed, need WebRTC :(
  const initialPeers = [
      "verity.hahn.mt:1984",
      // "verity.hahn.mt:1985",
      // "verity.hahn.mt:1986",
      // "132.145.174.233:1984",
      // "158.101.100.95:1984",
    ];
  const announceToTorrentTrackers = false;

  // construct node and UI
  const node = new VerityNode(lightNode, port, initialPeers, announceToTorrentTrackers);
  await node.cubeStoreReadyPromise;
  logger.info("Cube Store is ready");
  const verityUI = await VerityUI.Construct(node);
  await node.onlinePromise;
  logger.info("Node is online");

  // @ts-ignore TypeScript does not like us creating extra window attributes
  window.verityUI = verityUI;

  // Shut node down cleanly when user exits
  // @ts-ignore TypeScript does not like us creating extra window attributes
  window.onbeforeunload = function(){ window.verityUI.shutdown() }
}

if (isBrowser) webmain();
