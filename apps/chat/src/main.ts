import { ChatAppController } from "./chatAppController";
import "../chat.css";
import { isBrowser } from "browser-or-node";
import { logger } from "../../../src/core/logger";
import { VerityNode } from "../../../src/cci/verityNode";
import { SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { defaultInitialPeers } from "../../../src/core/coreNode";
import { cciFamily } from "../../../src/cci/cube/cciCube";
import { coreCubeFamily } from "../../../src/core/cube/cube";
import sodium from "libsodium-wrappers-sumo";

export async function webmain() {
  try {
    logger.info("Starting chat app");

    await sodium.ready;

    // Construct a Verity light node.
    // Key options (most apps can start from this same shape):
    // - transports: choose libp2p over WebRTC (browser‑friendly). Each entry is a tuple of transport -> multiaddrs
    // - initialPeers: known bootstrap peers
    // - inMemory: false => persist cubes to IndexedDB/Level (chat history survives reload)
    // - lightNode: true => don't store/relay *all* cubes, only what we request (smaller resource footprint)
    // - useRelaying: enable WebRTC relay usage for NAT traversal
    // - family: restrict accepted cube families (CCI + core primitives)
    // - announceToTorrentTrackers: disabled (not supported in browsers)
    const nodeOptions = {
      transports: new Map([[SupportedTransports.libp2p, ["/webrtc"]]]),
      initialPeers: defaultInitialPeers,
      inMemory: false,
      lightNode: true,
      useRelaying: true,
      family: [cciFamily, coreCubeFamily],
      announceToTorrentTrackers: false,
    };

    const node = new VerityNode(nodeOptions);
    // readyPromise resolves only after networking + stores + crypto subsystems have initialised.
    await node.readyPromise;
    logger.info("Verity node is ready");

    const chatController = new ChatAppController({ node });

    (window as any).verity = { node };

    await chatController.showChatApp();

    logger.info("Chat app initialized successfully");

    // (Optional) If the page lifecycle wants to coordinate clean shutdown, wait here.
    // For a single‑page application this will usually never resolve until tab close.
    await node.shutdownPromise;
  } catch (error) {
    logger.error(`Failed to start chat app: ${error}`);
  }
}

if (isBrowser) webmain();
else logger.error("This Verity Chat app must be run in the browser.");
