import { SupportedTransports } from '../core/networking/networkDefinitions';
import { VerityNode, VerityNodeOptions, defaultInitialPeers } from '../core/verityNode';
import { AddressAbstraction } from '../core/peering/addressing';
import { EnableCubePersitence } from '../core/cube/cubeStore';

import { cciFamily } from '../cci/cube/cciCube';
import { Identity, IdentityOptions } from '../cci/identity/identity';

import { ControllerContext, VerityController } from './verityController';
import { PeerController } from './peer/peerController';
import { IdentityController } from './identity/identityController';
import { NavigationController } from './navigation/navigationController';
import { VeraAnimationController } from './veraAnimationController';
import { CubeExplorerController } from './cubeExplorer/cubeExplorerController';
import { FileManagerController } from './fileManager/fileManagerController';

import { logger } from '../core/logger'
import { IdentityPersistenceOptions } from '../cci/identity/identityPersistence';

import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { NavItem } from './navigation/navigationDefinitions';

// TODO remove
localStorage.setItem('debug', 'libp2p:*') // then refresh the page to ensure the libraries can read this when spinning up.

export const defaultNavItems: NavItem[] = [
  {controller: CubeExplorerController, navAction: CubeExplorerController.prototype.selectAll, text: "Cube Explorer"},
];
export const defaultInitialNav: NavItem = defaultNavItems[0];

export interface VerityUiOptions {
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

    await sodium.ready;

    // set default options if none specified
    options.transports ??= new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
    options.initialPeers ??= defaultInitialPeers,
    options.navItems ??= defaultNavItems;
    options.initialNav ??= defaultInitialNav;
    options.enableCubePersistence ??= EnableCubePersitence.PRIMARY;
    options.inMemoryLevelDB ??= false;
    options.lightNode ??= true;
    options.useRelaying ??= true;
    options.family ??= cciFamily;
    // Torrent tracker usage must be enforced off as it's not supported
    // in the browser environment.
    options.announceToTorrentTrackers = false;

    const node = new VerityNode(options);
    await node.readyPromise;
    logger.info("Verity node is ready");

    // Construct UI and link it to window.verity
    const ui: VerityUI = new VerityUI(node, options);
    window.verity = ui;
    // Shut node down cleanly when user exits
    window.onbeforeunload = function(){ window.verity.shutdown() }

    // Make navbar items
    if (ui.options?.navItems) for (const navItem of ui.options.navItems) {
      ui.nav.makeNavItem(navItem);
    }

    // Prepare user Identity, and then prepare the initial view
    const identityPromise: Promise<any> = ui.initializeIdentity(ui.options);
    // If supplied (which the app really should do), perform an initial nav
    // action. Otherwise, the content area will just stay blank.
    let initialViewPromise: Promise<void>;
    if (ui.options.initialNav) {
      initialViewPromise = new Promise(resolve =>
        identityPromise.then(() =>
          ui.nav.show(ui.options.initialNav, false).then(resolve)));
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
  fileManagerController: FileManagerController;

  get currentController(): VerityController { return this.nav.currentController }

  constructor(
      readonly node: VerityNode,
      readonly options: VerityOptions = {},
    ){
    this.peerController = new PeerController(this);
    this.fileManagerController = new FileManagerController(this);
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
