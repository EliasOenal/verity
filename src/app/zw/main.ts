import { PostController } from "./webui/controller/postController";
import { VerityUI } from "../../webui/verityUI";
import { isBrowser } from "browser-or-node";
import { logger } from "../../core/logger";

export async function webmain() {
  const ui = await VerityUI.Construct({
    controllerClasses:[
        ["post", PostController],
      ],
    initialController: "post",
    initialNav: "withAuthors",
  });
  await ui.node.shutdownPromise;
};

if (isBrowser) webmain();
else logger.error("This Verity app must be run in the browser.");
