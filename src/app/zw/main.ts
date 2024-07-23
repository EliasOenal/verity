import { PostController } from "./webui/post/postController";
import { VerityUI } from "../../webui/verityUI";
import { isBrowser } from "browser-or-node";
import { logger } from "../../core/logger";
import { CubeExplorerController } from "../../webui/cubeExplorer/cubeExplorerController";
import { FileManagerController } from "../../webui/fileManager/fileManagerController";
import type { NavItem } from "../../webui/navigation/navigationDefinitions";

export async function webmain() {
  const navItems: NavItem[] = [
    {controller: PostController, navAction: PostController.prototype.selectPostsWithAuthors, text: "All posts", exclusive: true},
    {controller: PostController, navAction: PostController.prototype.selectAllPosts, text: "All posts (incl. anon.)", exclusive: true},
    {controller: PostController, navAction: PostController.prototype.selectSubscribedReplied, text: "Subscribed", exclusive: true},
    {controller: PostController, navAction: PostController.prototype.selectWot, text: "Web of trust", exclusive: true},
    {controller: CubeExplorerController, navAction: CubeExplorerController.prototype.selectAll, text: "Cube Explorer"},
    {controller: FileManagerController, navAction: FileManagerController.prototype.showFileManager, text: "File Manager"},
  ];
  const ui = await VerityUI.Construct({
    navItems: navItems,
    initialNav: navItems[0],
    lightNode: false,
  });
  await ui.node.shutdownPromise;
};

if (isBrowser) webmain();
else logger.error("This Verity app must be run in the browser.");
