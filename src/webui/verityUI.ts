import { SupportedTransports } from '../core/networking/networkDefinitions';

import { logger } from '../core/logger'
import { VerityNode } from '../core/verityNode';
import { AddressAbstraction } from '../core/peering/addressing';

import { cciFamily } from '../cci/cube/cciCube';
import { Identity } from '../cci/identity/identity';

import { PeerController } from './controller/peerController';
import { IdentityController } from './controller/identityController';
import { NavigationController } from './controller/navigationController';
import { VeraAnimationController } from './controller/veraAnimationController';

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo'
import { VerityController } from './controller/verityController';
import { EnableCubePersitence } from '../core/cube/cubeStore';

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

    const node = new VerityNode(
      new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      initialPeers,
      {
        announceToTorrentTrackers: false,
        autoConnect: true,
        enableCubePersistence: EnableCubePersitence.PRIMARY,
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
    await ui.nav.navPostsAll();
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
    this.peerController = new PeerController(this.node.networkManager, this.node.peerDB);
  }

  shutdown() {
    this.node.shutdown();
  }

  initializeIdentity(): Promise<boolean> {
    this.identityController = new IdentityController(this.node.cubeStore);
    return this.identityController.loadLocal();
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
