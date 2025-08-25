import { ChatAppController } from "./chatAppController";
import { isBrowser } from "browser-or-node";
import { logger } from "../../../src/core/logger";
import { VerityNode } from "../../../src/cci/verityNode";
import { SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { defaultInitialPeers } from "../../../src/core/coreNode";
import { cciFamily } from "../../../src/cci/cube/cciCube";
import { coreCubeFamily } from "../../../src/core/cube/cube";
import { Cockpit } from "../../../src/cci/cockpit";
import sodium from 'libsodium-wrappers-sumo';

export async function webmain() {
  try {
    logger.info('Starting chat app');
    
    await sodium.ready;
    
    // Create a minimal Verity node for the chat app
    const nodeOptions = {
      transports: new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      initialPeers: defaultInitialPeers,
      inMemory: false,
      lightNode: true,
      useRelaying: true,
      family: [cciFamily, coreCubeFamily],
      announceToTorrentTrackers: false,
    };
    
    const node = new VerityNode(nodeOptions);
    await node.readyPromise;
    logger.info("Verity node is ready");
    
    // Create cockpit for cube operations
    const cockpit = new Cockpit(node, { identity: () => undefined });
    
    // Create a simple context for the controllers
    const context = {
      node,
      identity: undefined,
      cockpit
    };
    
    // Initialize the chat app controller directly
    const chatController = new ChatAppController(context);
    
    // Set up global access (for compatibility with existing templates)
    (window as any).verity = {
      node,
      currentController: {
        changeDisplayTo: (shallDisplay: number) => {
          chatController.getPeerController().changeDisplayTo(shallDisplay);
        }
      },
      peerController: chatController.getPeerController(),
      nav: {
        closeCurrentController: () => {} // No-op for standalone app
      }
    };
    
    // Initialize the chat app
    await chatController.showChatApp();
    
    logger.info('Chat app initialized successfully');
    
    // Wait for shutdown
    await node.shutdownPromise;
  } catch (error) {
    logger.error(`Failed to start chat app: ${error}`);
  }
};

if (isBrowser) webmain();
else logger.error("This Verity Chat app must be run in the browser.");