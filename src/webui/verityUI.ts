import type { AddressAbstraction } from '../core/peering/addressing';

import type { IdentityPersistenceOptions } from '../cci/identity/identityPersistence';
import type { IdentityOptions } from '../cci/identity/identity.definitions';
import type { Identity } from '../cci/identity/identity';

import type { ControllerContext, VerityController } from './verityController';
import type { NavItem } from './navigation/navigationDefinitions';

import { SupportedTransports } from '../core/networking/networkDefinitions';
import { defaultInitialPeers } from '../core/coreNode';
import { coreCubeFamily } from '../core/cube/cube';

import { cciFamily } from '../cci/cube/cciCube';
import { VerityNode, VerityNodeOptions } from '../cci/verityNode';
import { Cockpit } from '../cci/cockpit';

import { PeerController } from './peer/peerController';
import { IdentityController } from './identity/identityController';
import { NavigationController } from './navigation/navigationController';
import { VeraAnimationController } from './veraAnimationController';
import { CubeExplorerController } from './cubeExplorer/cubeExplorerController';

import { logger } from '../core/logger'

import sodium from 'libsodium-wrappers-sumo'

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

export interface VerityOptions extends VerityNodeOptions, VerityUiOptions, IdentityOptions, IdentityPersistenceOptions {
  /**
   * Whether or not to animate Vera while starting up
   * @default true
   **/
  startupAnimation?: boolean;
}


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
    // set default options
    options.startupAnimation ??= true;

    // Initiate startup animation (unless disabled)
    const vera = new VeraAnimationController();
    if (options.startupAnimation) vera.start();

    logger.info('Starting web node');

    await sodium.ready;

    // set default options if none specified
    options.transports ??= new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
    options.initialPeers ??= defaultInitialPeers,
    options.navItems ??= defaultNavItems;
    options.initialNav ??= defaultInitialNav;
    options.inMemory ??= false;
    options.lightNode ??= true;
    options.useRelaying ??= true;
    options.family ??= [cciFamily, coreCubeFamily];

    // Torrent tracker usage must be enforced off as it's not supported
    // in the browser environment.
    options.announceToTorrentTrackers = false;

    const node = new VerityNode(options);
    await node.readyPromise;
    logger.info("Verity node is ready");

    // Construct UI and link it to window.verity
    const ui: VerityUI = new VerityUI(node, options);
    ui.vera = vera;
    window.verity = ui;
    // Shut node down cleanly when user exits
    window.onbeforeunload = function(){ window.verity.shutdown() }

    // Make navbar items
    if (ui.options?.navItems) for (const navItem of ui.options.navItems) {
      ui.nav.makeNavItem(navItem);
    }

    // Now prepare the initial view.
    // If supplied (which the app really should do), perform an initial nav
    // action. Otherwise, the content area will just stay blank.
    let initialViewPromise: Promise<void>;
    if (ui.options.initialNav) {
      initialViewPromise = ui.identityController.ready.then(() =>
          ui.nav.show(ui.options.initialNav, false));
    } else {
      // no view specified, so nothing to prepare, so just make a resolved promise
      initialViewPromise = new Promise<void>(resolve => resolve());
    }

    // Wait till everything is ready to draw the UI
    await Promise.all([ui.identityController.ready, initialViewPromise]);

    // All done, now update the DOM and stop the startup animation
    ui.nav.navigationView.show();  // display navbar items
    ui.identityController.loginStatusView.show();  // display Identity status
    ui.peerController.onlineView.show();
    ui.currentController?.contentAreaView?.show();  // display initial nav
    if (options.startupAnimation) vera.stop();
    return ui;
  }

  get identity(): Identity { return this.identityController.identity; }

  readonly nav: NavigationController = new NavigationController(this);
  readonly peerController: PeerController;
  readonly identityController: IdentityController;
  readonly cockpit: Cockpit;

  // HACKHACK: will be set externally by our static Construct() method
  public vera: VeraAnimationController;

  get currentController(): VerityController { return this.nav.currentController }

  constructor(
      readonly node: VerityNode,
      readonly options: VerityOptions = {},
    ){
    // Create our components. Note the order: Create cockpit and IdentityController
    // first, as they're part of the mandatory controller context.
    this.cockpit = new Cockpit(this.node,
      { identity: () => this.identityController?.identity ?? undefined });
    this.identityController = new IdentityController(this, options);
    this.peerController = new PeerController(this);
  }

  shutdown() {
    this.node.shutdown();
  }
}
