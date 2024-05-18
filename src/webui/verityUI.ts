import { SupportedTransports } from '../core/networking/networkDefinitions';
import { VerityNode, VerityNodeOptions } from '../core/verityNode';
import { AddressAbstraction } from '../core/peering/addressing';
import { EnableCubePersitence } from '../core/cube/cubeStore';

import { cciFamily } from '../cci/cube/cciCube';
import { Identity } from '../cci/identity/identity';

import { ControllerContext, VerityController } from './controller/verityController';
import { PeerController } from './controller/peerController';
import { IdentityController } from './controller/identityController';
import { NavigationController } from './controller/navigationController';
import { VeraAnimationController } from './controller/veraAnimationController';
import { CubeExplorerController } from './controller/cubeExplorerController';

import { logger } from '../core/logger'

// TODO remove
localStorage.setItem('debug', 'libp2p:*') // then refresh the page to ensure the libraries can read this when spinning up.

export const defaultInitialPeers: AddressAbstraction[] = [
  new AddressAbstraction("verity.hahn.mt:1984"),
  new AddressAbstraction("/dns4/verity.hahn.mt/tcp/1985/wss/"),
  // new AddressAbstraction("/ip4/127.0.0.1/tcp/1985/wss"),
  // new AddressAbstraction("verity.hahn.mt:1985"),
  // new AddressAbstraction("verity.hahn.mt:1986"),
  // new AddressAbstraction("132.145.174.233:1984"),
  // new AddressAbstraction("158.101.100.95:1984"),
  // new AddressAbstraction("/ip4/127.0.0.1/tcp/1985/ws"),
];

const defaultControllerClasses: Array<Array<string | typeof VerityController>> = [
  ["identity", IdentityController],
  ["peer", PeerController],
  ["cubeExplorer", CubeExplorerController],
  // Note: NavigationController is not listed here as it does not need to
  // register with itself.
  // VeraAnimationController is not listed here as it's not actually a
  // VerityController but basically just a helper used on startup.
]

export interface VerityUiOptions {
  controllerClasses: Array<Array<string | typeof VerityController>>,
  initialPeers?: AddressAbstraction[],
  initialController: string;
  initialNav: string;
};

export type VerityOptions = VerityNodeOptions & VerityUiOptions;


// Tell Typescript we're planning to use the custom window.verity attribute
// in the browser.
declare global {
  interface Window {
    verity: VerityUI;
    webmain: () => Promise<void>,
  }
}

export class VerityUI implements ControllerContext {
  /**
   * Workaround to those damn omnipresent async constructs.
   * Always create your VerityUI this way or it won't have an Identity 🤷
   */
  static async Construct(options: VerityOptions): Promise<VerityUI> {
    logger.info('Starting web node');
    const veraStartupAnim =  new VeraAnimationController();
    veraStartupAnim.start();

    // set default options if requred
    options.enableCubePersistence = options.enableCubePersistence ?? EnableCubePersitence.PRIMARY;
    options.lightNode = options.lightNode ?? true;
    options.useRelaying = options.useRelaying ?? true;
    options.family = options.family ?? cciFamily;
    // Torrent tracker usage must be enforced off as it's not supported
    // in the browser environment.
    options.announceToTorrentTrackers = false;

    const node = new VerityNode(
      new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      options?.initialPeers ?? defaultInitialPeers,
      options
    );
    await node.readyPromise;
    logger.info("Verity node is ready");

    // Construct UI and link it to window.verity
    const ui: VerityUI = new VerityUI(node);
    window.verity = ui;
    // Shut node down cleanly when user exits
    window.onbeforeunload = function(){ window.verity.shutdown() }

    // Register controllers
    for (const [name, controllerClass] of
          [...defaultControllerClasses, ...options.controllerClasses]) {
      ui.nav.registerControllerClass(
        name as string, controllerClass as typeof VerityController);
    }

    await ui.initializeIdentity();
    await ui.nav.showNewExclusive(options.initialController, options.initialNav);
    veraStartupAnim.stop();
    return ui;
  }

  get identity(): Identity { return this.identityController.identity; }

  nav: NavigationController = new NavigationController(this);
  peerController: PeerController;
  identityController: IdentityController;

  get currentController(): VerityController { return this.nav.currentController }

  constructor(
      readonly node: VerityNode,
      readonly veraAnimationController: VeraAnimationController = new VeraAnimationController(),
    ){
    this.peerController = new PeerController(this);
  }

  shutdown() {
    this.node.shutdown();
  }

  initializeIdentity(): Promise<boolean> {
    this.identityController = new IdentityController(this);
    return this.identityController.loadLocal();
  }
}
