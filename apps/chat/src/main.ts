import { VerityUI } from "../../../src/webui/verityUI";
import { isBrowser } from "browser-or-node";
import { logger } from "../../../src/core/logger";
import { ChatAppController } from "./chatAppController";
import type { NavItem } from "../../../src/webui/navigation/navigationDefinitions";

export async function webmain() {
  // For the standalone chat app, we use a single controller that manages both chat and peers
  const navItems: NavItem[] = [
    {controller: ChatAppController, navAction: ChatAppController.prototype.showChatApp, text: "Chat", exclusive: true},
  ];
  
  const ui = await VerityUI.Construct({
    navItems: navItems,
    initialNav: navItems[0], // Start with chat as the default
    lightNode: true,
    // Disable startup animation to avoid issues with missing elements
    startupAnimation: false,
  });
  
  await ui.node.shutdownPromise;
};

if (isBrowser) webmain();
else logger.error("This Verity Chat app must be run in the browser.");