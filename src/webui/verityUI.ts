import { SupportedTransports } from '../core/networking/networkDefinitions';

import { logger } from '../core/logger'
import { VerityNode } from '../core/verityNode';
import { AddressAbstraction } from '../core/peering/addressing';
import { Cube } from '../core/cube/cube';

import { Identity } from '../cci/identity/identity';
import { SubscriptionRequirement, ZwAnnotationEngine } from '../app/zwAnnotationEngine';

import { PostController } from './controller/postController';
import { PeerController } from './controller/peerController';
import { CubeExplorerController } from './controller/cubeExplorerController';
import { IdentityController } from './controller/identityController';

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo'

// TODO remove
localStorage.setItem('debug', 'libp2p:*') // then refresh the page to ensure the libraries can read this when spinning up.

export class VerityUI {
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

  annotationEngine: ZwAnnotationEngine;
  get identity(): Identity { return this.identityController.identity; }

  postController: PostController = undefined;
  peerController: PeerController;
  identityController: IdentityController;
  cubeExplorerController: CubeExplorerController;


  constructor(
      readonly node: VerityNode
    ){
    this.peerController = new PeerController(this.node.networkManager, this.node.peerDB);
    this.cubeExplorerController = new CubeExplorerController(this.node.cubeStore);
  }

  shutdown() {
    this.node.shutdown();
    this.postController.shutdown();
  }

  async initializeIdentity(): Promise<void> {
    const idlist: Identity[] = await Identity.retrieve(this.node.cubeStore);
    let identity: Identity = undefined;
    if (idlist?.length) identity = idlist[0];
    this.identityController = new IdentityController(this.node.cubeStore, identity);
    this.identityController.showLoginStatus();
  }

  // Navigation
  // maybe TODO: Move this to a new NavController/NavView
  navPostsAll(): void {
    logger.trace("VerityUI: Displaying all posts including anonymous ones");
    this.navbarMarkActive("navPostsAll");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.none,  // show all posts
      [],       // subscriptions don't play a role in this mode
      true,     // auto-learn MUCs to display authorship info if available
      true);    // allow anonymous posts
    this.postController = new PostController(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsWithAuthors(): void {
    logger.trace("VerityUI: Displaying posts associated with a MUC");
    this.navbarMarkActive("navPostsWithAuthors");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.none,
      [],       // no subscriptions as they don't play a role in this mode
      true,     // auto-learn MUCs (posts associated with any Identity MUC are okay)
      false);   // do not allow anonymous posts
    this.postController = new PostController(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsSubscribedInTree(): void {
    if (!this.identity) return;
    logger.trace("VerityUI: Displaying posts from trees with subscribed author activity");
    this.navbarMarkActive("navPostsSubscribedInTree");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.subscribedInTree,
      this.identity.subscriptionRecommendations,  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false);    // do not allow anonymous posts
    this.postController = new PostController(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsSubscribedReplied(wotDepth: number = 0): void {
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
    this.postController = new PostController(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPostsSubscribedStrict(): void {
    if (!this.identity) return;
    logger.trace("VerityUI: Displaying posts from subscribed authors strictly");
    this.navbarMarkActive("navPostsSubscribedStrict");
    this.annotationEngine = new ZwAnnotationEngine(
      this.node.cubeStore,
      SubscriptionRequirement.subscribedOnly,  // strictly show subscribed
      this.identity.subscriptionRecommendations,  // subscriptions
      false,     // do no auto-learn MUCs (strictly only posts by subscribed will be displayed)
      false);    // do not allow anonymous posts
    this.postController = new PostController(this.node.cubeStore, this.annotationEngine, this.identity);
  }

  navPeers() {
    this.peerController.peerView.show();
    this.navbarMarkActive("navPeers");
  }

  navCubeExplorer(): void {
    this.navbarMarkActive("navCubeExplorer");
    this.cubeExplorerController.redisplay();
    this.cubeExplorerController.view.show();
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
    new AddressAbstraction("verity.hahn.mt:1984"),
    new AddressAbstraction("/dns4/verity.hahn.mt/tcp/1985/wss/"),
    // new AddressAbstraction("/ip4/127.0.0.1/tcp/1985/wss"),
    // new AddressAbstraction("verity.hahn.mt:1985"),
    // new AddressAbstraction("verity.hahn.mt:1986"),
    // new AddressAbstraction("132.145.174.233:1984"),
    // new AddressAbstraction("158.101.100.95:1984"),
    // new AddressAbstraction("/ip4/127.0.0.1/tcp/1985/ws"),
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
      useRelaying: true,
    });
  await node.cubeStoreReadyPromise;
  logger.info("Cube Store is ready");
  const verityUI = await VerityUI.Construct(node);
  // @ts-ignore TypeScript does not like us creating extra window attributes
  window.verityUI = verityUI;

  await node.onlinePromise;
  logger.info("Node is online");

  // Shut node down cleanly when user exits
  // @ts-ignore TypeScript does not like us creating extra window attributes
  window.onbeforeunload = function(){ window.verityUI.shutdown() }
}

if (isBrowser) webmain();
