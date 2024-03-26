import { SupportedTransports } from '../core/networking/networkDefinitions';

import { logger } from '../core/logger'
import { VerityNode } from '../core/verityNode';
import { AddressAbstraction } from '../core/peering/addressing';

import { cciFamily } from '../cci/cube/cciCube';
import { Identity } from '../cci/identity/identity';
import { SubscriptionRequirement, ZwAnnotationEngine } from '../app/zwAnnotationEngine';

import { VerityController } from './controller/verityController';
import { PostController } from './controller/postController';
import { PeerController } from './controller/peerController';
import { CubeExplorerController } from './controller/cubeExplorerController';
import { IdentityController } from './controller/identityController';

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo'
import { NavigationController } from './controller/navigationController';

// TODO remove
localStorage.setItem('debug', 'libp2p:*') // then refresh the page to ensure the libraries can read this when spinning up.

export class VerityUI {
  /**
   * Workaround to those damn omnipresent async constructs.
   * Always create your VerityUI this way or it won't have an Identity 🤷
   */
  static async Construct(initialPeers: AddressAbstraction[]): Promise<VerityUI> {
    logger.info('Starting web node');
    const veraStartupAnim =  new VeraAnimationController();
    veraStartupAnim.start();
    await sodium.ready;

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
        family: cciFamily,
      });
    await node.cubeStoreReadyPromise;
    logger.info("Cube Store is ready");

    const ui: VerityUI = new VerityUI(node);
    await ui.node.cubeStore.readyPromise;
    await ui.initializeIdentity();
    ui.nav.navPostsWithAuthors();
    veraStartupAnim.stop();
    return ui;
  }

  get identity(): Identity { return this.identityController.identity; }

  nav: NavigationController = new NavigationController(this);
  postController: PostController = undefined;
  peerController: PeerController;
  identityController: IdentityController;

  constructor(
      readonly node: VerityNode,
      readonly veraAnimationController: VeraAnimationController = new VeraAnimationController(),
    ){
    this.peerController = new PeerController(this.node.networkManager, this.node.peerDB);
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
}


class VeraAnimationController {
  private currentTimer: NodeJS.Timeout = undefined;  // it's actually not a NodeJS.Timeout in the browser environment, but we're developing on NodeJS so that's fine
  private veraNest: HTMLElement;
  private veraImg: HTMLImageElement;

  /**
   * Initiate startup animation:
   * Shows Vera centered on the screen doing some light animation
   */
  start(): void {
    this.veraNest = document.getElementById("veraNest") as HTMLImageElement;
    this.veraImg = document.getElementById("veralogo") as HTMLImageElement;
    const natRect: DOMRect = this.veraNest.getBoundingClientRect();
    // move vera to centera of screen
    this.veraNest.setAttribute("style", `transform: translate(${
        window.visualViewport.width/2 - natRect.x - natRect.width/2
      }px, ${
        window.visualViewport.height/2 - natRect.y - natRect.height
      }px);`);
    this.veraNest.classList.replace("hidden", "fade-in");  // fade vera in

    // start Vera animation after one second
    this.currentTimer = setTimeout(() => this.animRadiate(), 1000);
  }

  animRadiate(): void {
    // if Vera is doing something else, make her stop
    this.veraNest.classList.remove('fade-in');
    this.veraImg.classList.remove('vera-roll');
    this.veraImg.classList.remove("veraAnimRunning");

    // make vera radiate
    this.veraNest.classList.add("pulsateBlue");
    // make vera move up and down
    this.veraImg.classList.add("veraAnimRunning");

    // after three pulses, switch to roll
    this.currentTimer = setTimeout(() => this.animRoll(), 6000);
  }

  animRoll(): void {
    // if Vera is doing something else, make her stop
    this.veraNest.classList.remove('fade-in');
    this.veraNest.classList.remove("pulsateBlue");
    this.veraImg.classList.remove("veraAnimRunning");

    // make her roll
    this.veraImg.classList.add('vera-roll');

    // after one roll, make her pulse again
    this.currentTimer = setTimeout(() => this.animRadiate(), 1000);
  }

  /**
   * Terminate startup animation:
   * Move Vera back into her nest
   */
  stop(): void {
    // stop timer
    clearInterval(this.currentTimer);
    // clear all animations
    this.veraNest.classList.remove('fade-in');
    this.veraImg.classList.remove('vera-roll');
    this.veraNest.classList.remove("pulsateBlue");
    this.veraImg.classList.remove("veraAnimRunning");
    // smoothly move Vera back into her spot
    this.veraNest.classList.add("moving");
    this.veraNest.removeAttribute("style");
    // cleanup after move back animation done
    this.currentTimer = setTimeout(() => this.cleanup(), 1000);
  }

  cleanup(): void {
    clearInterval(this.currentTimer);
    this.veraNest.classList.remove('fade-in');
    this.veraImg.classList.remove('vera-roll');
    this.veraNest.classList.remove("pulsateBlue");
    this.veraImg.classList.remove("veraAnimRunning");
    this.veraNest.classList.remove("moving");
    this.veraNest.removeAttribute("style");
  }
}

async function webmain() {
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
  const verityUI = await VerityUI.Construct(initialPeers);
  // @ts-ignore TypeScript does not like us creating extra window attributes
  window.verityUI = verityUI;

  // Shut node down cleanly when user exits
  // @ts-ignore TypeScript does not like us creating extra window attributes
  window.onbeforeunload = function(){ window.verityUI.shutdown() }
}

if (isBrowser) webmain();
