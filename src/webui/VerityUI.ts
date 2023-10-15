import { SupportedTransports } from '../core/networkDefinitions';

import { AddressAbstraction } from '../core/peerDB';
import { VerityNode } from '../core/verityNode';
import { Cube, CubeKey } from '../core/cube';
import { logger } from '../core/logger'
import { FieldParser } from '../core/fieldParser';

import { Identity } from '../app/identity';
import { zwFieldDefinition } from '../app/zwFields';
import { SubscriptionRequirement, ZwAnnotationEngine } from '../app/zwAnnotationEngine';
import { makePost } from '../app/zwCubes';

import { PostDisplay } from './PostDisplay';
import { PeerDisplay } from './PeerDisplay';

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers'
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
    await ui.node.cubeStore.readyPromise;
    await ui.initializeIdentity();
    ui.navPostsWithAuthors();
    return ui;
  }

  node: VerityNode = undefined;
  annotationEngine: ZwAnnotationEngine;
  identity: Identity = undefined;

  postDisplay: PostDisplay = undefined;
  peerDisplay: PeerDisplay = undefined;


  constructor(node: VerityNode) {
    this.node = node;

    this.peerDisplay = new PeerDisplay(this);
    this.peerDisplay.redisplayPeers();
  }

  shutdown() {
    this.node.shutdown();
    this.postDisplay.shutdown();
  }

  async initializeIdentity(): Promise<void> {
    this.identity = await Identity.retrieve(this.node.cubeStore);
    if (this.identity.name) {
      (document.getElementById("idname") as HTMLInputElement).
        value = this.identity.name;
    }
  }

  async saveIdentity(): Promise<Cube> {
    const username = (document.getElementById("idname") as HTMLInputElement).value;
    if (username.length) this.identity.name = username;
    else this.identity.name = "New user";
    return this.identity.store();
  }

  async makeNewPost(input: HTMLFormElement) {
    const replytostring: string = input.getAttribute("data-cubekey");
    const replyto: CubeKey =
      replytostring? Buffer.from(replytostring, 'hex') : undefined;
    const textarea: HTMLTextAreaElement =
      input.getElementsByTagName("textarea")[0] as HTMLTextAreaElement;
    const text = textarea.value;
    if (!text.length) return;  // don't make empty posts
    // clear the input
    textarea.value = '';
    // @ts-ignore Typescript doesn't like us using custom window attributes
    window.onTextareaInput(textarea);
    // First create the post, then update the identity, then add the cube.
    // This way the UI directly displays you as the author.
    const post = await makePost(text, replyto, this.identity);
    await this.saveIdentity();
    this.node.cubeStore.addCube(post);
  }

  async subscribeUser(subscribeButton: HTMLButtonElement) {
    const authorkeystring = subscribeButton.getAttribute("data-authorkey");
    const authorkey = Buffer.from(authorkeystring, 'hex');
    // subscribing or unsubscribing?
    if (subscribeButton.classList.contains("active")) {
      logger.trace("VerityUI: Unsubscribing from " + authorkeystring);
      this.identity.removeSubscriptionRecommendation(authorkey);
      subscribeButton.classList.remove("active");
      await this.identity.store();
    } else {
      logger.trace("VerityUI: Subscribing to " + authorkeystring);
      this.identity.addSubscriptionRecommendation(authorkey);
      subscribeButton.classList.add("active");
      await this.identity.store();
    }
    this.postDisplay.redisplayAuthor(this.node.cubeStore.getCubeInfo(authorkeystring));
  }

  navPostsAll() {
    logger.trace("VerityUI: Displaying all posts including anonymous ones");
    this.navbarMarkActive("navPostsAll");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.none,  // show all posts
      [],       // subscriptions don't play a role in this mode
      true,     // auto-learn MUCs to display authorship info if available
      true);    // allow anonymous posts
    this.postDisplay = new PostDisplay(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsWithAuthors() {
    logger.trace("VerityUI: Displaying posts associated with a MUC");
    this.navbarMarkActive("navPostsWithAuthors");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.none,
      [],       // no subscriptions as they don't play a role in this mode
      true,     // auto-learn MUCs (posts associated with any Identity MUC are okay)
      false);   // do not allow anonymous posts
    this.postDisplay = new PostDisplay(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsSubscribedInTree() {
    if (!this.identity) return;
    logger.trace("VerityUI: Displaying posts from trees with subscribed author activity");
    this.navbarMarkActive("navPostsSubscribedInTree");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.subscribedInTree,
      this.identity.subscriptionRecommendations,  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false);    // do not allow anonymous posts
    this.postDisplay = new PostDisplay(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsSubscribedReplied(wotDepth: number = 0) {
    if (!this.identity) return;
    logger.trace("VerityUI: Displaying posts from subscribed authors and their preceding posts");
    let navName: string = "navPostsSubscribedReplied";
    if (wotDepth) navName += wotDepth;
    this.navbarMarkActive(navName);
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.subscribedReply,
      this.identity.recursiveWebOfSubscriptions(wotDepth),  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false);    // do not allow anonymous posts
    this.postDisplay = new PostDisplay(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsSubscribedStrict() {
    if (!this.identity) return;
    logger.trace("VerityUI: Displaying posts from subscribed authors strictly");
    this.navbarMarkActive("navPostsSubscribedStrict");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.subscribedOnly,  // strictly show subscribed
      this.identity.subscriptionRecommendations,  // subscriptions
      false,     // do no auto-learn MUCs (strictly only posts by subscribed will be displayed)
      false);    // do not allow anonymous posts
    this.postDisplay = new PostDisplay(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  private navbarMarkActive(id: string) {
    for (const nav of document.getElementsByClassName("nav-item")) {
      if (nav.id == id) nav.classList.add("active");
      else nav.classList.remove("active");
    }
  }
}

async function webmain() {
  logger.info('Starting web node');
  await sodium.ready;

  // default params
  const initialPeers = [
    // new AddressAbstraction("verity.hahn.mt:1984"),
    // new AddressAbstraction("/dnsaddr/verity.hahn.mt/tcp/1985/ws"),
    // new AddressAbstraction("verity.hahn.mt:1985"),
    // new AddressAbstraction("verity.hahn.mt:1986"),
    // new AddressAbstraction("132.145.174.233:1984"),
    // new AddressAbstraction("158.101.100.95:1984"),
    new AddressAbstraction("/ip4/127.0.0.1/tcp/1985/ws"),
  ];

  // construct node and UI
  // const node = new VerityNode(lightNode, port, initialPeers, announceToTorrentTrackers);
  const node = new VerityNode(
    new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
    initialPeers,
    {
      announceToTorrentTrackers: false,
      autoConnect: true,
      enableCubePersistance: true,
      lightNode: false,
      peerExchange: true,
    });
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
