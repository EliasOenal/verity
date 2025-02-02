import { PostController } from "./webui/post/postController";
import { VerityUI } from "../../webui/verityUI";
import { isBrowser } from "browser-or-node";
import { logger } from "../../core/logger";
import { CubeExplorerController } from "../../webui/cubeExplorer/cubeExplorerController";
import { FileManagerController } from "../../webui/fileManager/fileManagerController";
import { ChatController } from "../../webui/chatApp/chatController";
import type { NavItem } from "../../webui/navigation/navigationDefinitions";
import { ZwConfig } from "./model/zwConfig";
import { keyVariants } from "../../core/cube/cubeUtil";

export async function webmain() {
  const navItems: NavItem[] = [
    // {controller: PostController, navAction: PostController.prototype.selectPostsWithAuthors, text: "All posts", exclusive: true},
    // {controller: PostController, navAction: PostController.prototype.selectAllPosts, text: "All posts (incl. anon.)", exclusive: true},
    {controller: PostController, navAction: PostController.prototype.navSubscribed, text: "Subscribed", exclusive: true},
    {controller: PostController, navAction: PostController.prototype.navWot, text: "My Network", exclusive: true},
    {controller: PostController, navAction: PostController.prototype.navExplore, text: "Explore", exclusive: true},
    {controller: CubeExplorerController, navAction: CubeExplorerController.prototype.selectAll, text: "Cube Explorer"},
    {controller: FileManagerController, navAction: FileManagerController.prototype.showFileManager, text: "File Manager"},
    {controller: ChatController, navAction: ChatController.prototype.showChatApp, text: "Chat"},
  ];
  const ui = await VerityUI.Construct({
    navItems: navItems,
    initialNav: navItems[2],
    lightNode: true,
    idmucNotificationKey: ZwConfig.NOTIFICATION_KEY,
  });
  await ui.node.shutdownPromise;
};

if (isBrowser) webmain();
else logger.error("This Verity app must be run in the browser.");
