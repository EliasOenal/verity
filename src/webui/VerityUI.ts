import { fullNode } from '../fullNode';
import { logger } from '../model/logger'

import { CubeDisplay } from './CubeDisplay';
import { PeerDisplay } from './PeerDisplay';
import { AnnotationEngine } from '../viewmodel/annotationEngine';
import { Identity } from '../viewmodel/identity';
import { FieldParser } from '../model/fieldParser';
import { ZwFieldLengths, ZwField, zwFieldDefinition } from '../viewmodel/zwFields';
import { isBrowser } from 'browser-or-node';
import { ZwAnnotationEngine } from '../viewmodel/zwAnnotationEngine';
import { makePost } from '../viewmodel/zwCubes';


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

  cubeDisplay: CubeDisplay;
  peerDisplay: PeerDisplay;


  constructor(node: fullNode) {
    this.node = node;
    this.annotationEngine = new ZwAnnotationEngine(this.node.cubeStore);

    this.peerDisplay = new PeerDisplay(this);
    this.peerDisplay.redisplayPeers();

    this.cubeDisplay = new CubeDisplay(this);
    this.cubeDisplay.redisplayCubes();
  }

  async initializeIdentity(): Promise<void> {
    this.identity = await Identity.retrieve(this.node.cubeStore);
    (document.getElementById("idname") as HTMLInputElement).value = this.identity.name;
  }

  saveIdentity(): void {
    this.identity.name = (document.getElementById("idname") as HTMLInputElement).value;
    this.identity.store(this.node.cubeStore);
  }

  makeNewPost(text: string): void {
    this.node.cubeStore.addCube(makePost(text));
  }

  postReply(text: string, replyto: string) {
    this.node.cubeStore.addCube(makePost(text, Buffer.from(replyto, 'hex')));
  }
}

async function webmain(node: fullNode) {
  logger.trace("in web main");
  // @ts-ignore TypeScript does not like us creating extra window attributes.. TODO refactor this
  window.verityUI = await VerityUI.Construct(node);
  // @ts-ignore TypeScript does not recognize window.verityUI even though it was defined right in the previous line
  await node.shutdownPromise;
}

// @ts-ignore TypeScript does not like us creating extra window attributes
if (isBrowser) window.webmain = webmain;
