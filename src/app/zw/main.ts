import { PostController } from "./webui/controller/postController";
import { VerityUI } from "../../webui/verityUI";
import { isBrowser } from "browser-or-node";
import { logger } from "../../core/logger";

export async function webmain() {
  const ui = await VerityUI.Construct({
    controllerClasses:[
        ["post", PostController],
      ],
    navItems: [
        {controller: "post", navAction: "withAuthors", text: "All posts", exclusive: true},
        {controller: "post", navAction: "all", text: "All posts (incl anonymous)", exclusive: true},
        {controller: "post", navAction: "subscribedReplied", text: "Subscribed", exclusive: true},
        {controller: "post", navAction: "wot", text: "Web of trust", exclusive: true},
        {controller: "cubeExplorer", navAction: "all", text: "Cube Explorer"},
      ],
    initialNav: {controller: "post", navAction: "withAuthors"},
  });
  await ui.node.shutdownPromise;
};

if (isBrowser) webmain();
else logger.error("This Verity app must be run in the browser.");
