import { SupportedTransports } from '../core/networking/networkDefinitions';
import { VerityNode, VerityNodeOptions } from '../core/verityNode';
import { AddressAbstraction } from '../core/peering/addressing';
import { EnableCubePersitence } from '../core/cube/cubeStore';

import { cciFamily } from '../cci/cube/cciCube';
import { Identity, IdentityOptions } from '../cci/identity/identity';

import { ControllerContext, VerityController } from './verityController';
import { PeerController } from './peer/peerController';
import { IdentityController } from './identity/identityController';
import { NavItem, NavigationController } from './navigation/navigationController';
import { VeraAnimationController } from './veraAnimationController';
import { CubeExplorerController } from './cubeExplorer/cubeExplorerController';

import { logger } from '../core/logger'
import { IdentityPersistenceOptions } from '../cci/identity/identityPersistence';

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
  navItems?: NavItem[],
  initialNav?: NavItem;
};

export type VerityOptions = VerityNodeOptions & VerityUiOptions & IdentityOptions & IdentityPersistenceOptions;


// Tell Typescript we're planning to use the custom window.verity attribute
// in the browser.
declare global {
  interface Window { verity: VerityUI }
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

    // Make navbar items
    if (options?.navItems) for (const navItem of options.navItems) {
      ui.nav.makeNavItem(navItem);
    }

    // Prepare user Identity, and then prepare the initial view
    const identityPromise: Promise<any> = ui.initializeIdentity(options);
    // If supplied (which the app really should do), perform an initial nav
    // action. Otherwise, the content area will just stay blank.
    let initialViewPromise: Promise<void>;
    if (options.initialNav) {
      initialViewPromise = new Promise(resolve =>
        identityPromise.then(() =>
          ui.nav.show(options.initialNav, false).then(resolve)));
    } else {
      // no view specified, so nothing to prepare, so just make a resolved promise
      initialViewPromise = new Promise<void>(resolve => resolve());
    }

    // Wait till everything is ready to draw the UI
    await Promise.all([identityPromise, initialViewPromise]);

    // All done, now update the DOM and stop the startup animation
    ui.nav.navigationView.show();  // display navbar items
    ui.identityController.loginStatusView.show();  // display Identity status
    ui.peerController.onlineView.show();
    ui.currentController?.contentAreaView?.show();  // display initial nav
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

  initializeIdentity(
      options?: IdentityOptions&IdentityPersistenceOptions
  ): Promise<boolean> {
    this.identityController = new IdentityController(this, options);
    return this.identityController.loadLocal();
  }
}
