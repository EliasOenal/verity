import { ZwConfig } from "../../model/zwConfig";
import { logger } from "../../../../core/logger";
import { VerityView } from "../../../../webui/verityView";

import type { PostController, PostData } from "./postController";

import { loadTemplate } from "../../../../webui/helpers/dom";
import * as template from './postTemplate.html';
import { formatDate } from "../../../../webui/helpers/datetime";
loadTemplate(template);

export class PostView extends VerityView {
  private postList: HTMLUListElement;

  constructor(
      controller: PostController,
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityPostViewTemplate") as HTMLTemplateElement,
      show: boolean = false,
  ){
    super(controller, htmlTemplate);
    this.postList = this.renderedView.querySelector(".verityPostList") as HTMLUListElement;
    this.clearAll();
    if (!this.controller.identity) this.processNotLoggedIn();
    if (show) this.show();
  }

  clearAll() {
    this.postList.replaceChildren();
  }

  displayPost(data: PostData): void {
    // Get the post template from HTML and clone it
    const container = this.getOrCreateContainer(data);
    const li: HTMLLIElement = this.newFromTemplate(".verityPost") as HTMLLIElement;
    // save the display element to the PostData record
    data.displayElement = li;
    const form: HTMLFormElement =
      li.getElementsByTagName("form")[0] as HTMLFormElement;

    // Fill in this post's data
    // metadata
    li.setAttribute("data-cubekey", data.keystring);
    form.setAttribute("data-cubekey", data.keystring);
    li.setAttribute("data-timestamp", String(data.timestamp));
    // profile pic
    this.displayCubeProfilepic(data,
      li.getElementsByClassName("verityPostProfilePic")[0] as HTMLImageElement);
    // author
    this.displayCubeAuthor(data);
    // date
    const dateelem = li.getElementsByClassName("verityPostDate")[0] as HTMLElement;
    dateelem.innerText = formatDate(data.timestamp)
    // post text
    const text: HTMLParagraphElement =
      li.getElementsByClassName("verityPostContent")[0] as HTMLParagraphElement;
    text.innerHTML = data.text; // Was sanitized in controller
    text.title = `Cube Key ${data.keystring}`;  // show cube key as tooltip

    // Configure reply input field
    const replyform: HTMLFormElement =
      li.getElementsByClassName("verityReplyForm")[0] as HTMLFormElement;
    const replyfield: HTMLTextAreaElement =
      li.getElementsByClassName("verityPostInput")[0] as HTMLTextAreaElement;
    replyfield.setAttribute("maxlength", ZwConfig.MAXIMUM_POST_LENGTH.toString());
    replyfield.setAttribute("id", `verityReplyInput-${data.keystring}`);
    replyfield.setAttribute("style", `height: ${replyfield.scrollHeight}px;`);  // for auto-resize
    // @ts-ignore Typescript does not like us using custom window attributes
    const replybutton: HTMLButtonElement =
      li.getElementsByClassName("verityPostButton")[0] as HTMLButtonElement
    replybutton.setAttribute("id", `replybutton-${data.keystring}`);
    // disable reply input if necessary
    if (!ZwConfig.ALLOW_ANONYMOUS_POSTS && !this.controller.identity) {
      this.disableInput(replyform);
    }

    // Insert sorted by date
    let appended: boolean = false;
    for (const child of container.children) {
        const timestamp: string | null = child.getAttribute("data-timestamp");
        if (timestamp) {
            const childdate: number = parseInt(timestamp);
            if (childdate < data.timestamp) {
                container.insertBefore(li, child);
                appended = true;
                break;
            }
        }
    }
    if (!appended) container.appendChild(li);
  }

  redisplayCubeAuthor(data: PostData): void {
    this.displayCubeAuthor(data);
    const profilepicCollection =
      data.displayElement.getElementsByClassName("postProfilePic");
    if (!profilepicCollection) return;
    const profilepicElem = profilepicCollection[0] as HTMLImageElement;
    if (!profilepicElem) return;
    this.displayCubeProfilepic(data, profilepicElem);
  }

  private displayCubeAuthor(data: PostData) {
    // Get the HTML element the author of this post is displayed in.
    // Fail silently if there isn't any.
    const authorelementCollection =
      data.displayElement.getElementsByClassName("verityCubeAuthor");
    if (!authorelementCollection) return;
    const authorelement = authorelementCollection[0] as HTMLElement;
    if (!authorelement) return;
    authorelement.setAttribute("id", data.keystring + "-author");
    authorelement.setAttribute("class", "verityCubeAuthor");
    if (data.authorkey) authorelement.setAttribute("title", "MUC key " + data.authorkey);
    authorelement.innerText = data.author;

    const subscribeButton: HTMLButtonElement =
    data.displayElement.getElementsByClassName("veritySubscribeButton")[0] as HTMLButtonElement;
    if (data.authorkey && data.authorsubscribed !== "none") {
      subscribeButton.setAttribute("data-authorkey", data.authorkey);
      if (data.authorsubscribed === "self") {  // own post
        subscribeButton.innerText = "You"
        subscribeButton.classList.add("active");
        subscribeButton.removeAttribute("onclick");
      }
      else {
        if (data.authorsubscribed) subscribeButton.classList.add("active");
        else subscribeButton.classList.remove("active");
      }
    } else {
      subscribeButton.setAttribute("style", "display: none");
    }
  }

  displayCubeProfilepic(data: PostData, profilepicelem: HTMLImageElement) {
    profilepicelem.setAttribute("src", data.profilepic);
  }

  private getOrCreateContainer(data: PostData): HTMLUListElement {
    // Is this a reply?
    if (!data.superior || !data.superior.displayElement) {
      // No, just display it top level.
      return this.postList;
    }
    // Does this post already have a reply list?
    let replylist: HTMLUListElement | null =
      data.superior.displayElement.getElementsByTagName("ul").item(0);
    if (!replylist) {  // no? time to create one
        replylist = document.createElement('ul');
        replylist.setAttribute("class", "replyposts");
        data.superior.displayElement.appendChild(replylist);
    }
    return replylist;
  }

  processNotLoggedIn(): void {
    if (!ZwConfig.ALLOW_ANONYMOUS_POSTS) {
      const newPostForm: HTMLFormElement = this.renderedView.querySelector("#verityNewPostForm");
      this.disableInput(newPostForm);
    }
  }

  private disableInput(form: HTMLFormElement): void {
    try {
      const newPostTa: HTMLTextAreaElement = form.querySelector("textarea");
      newPostTa.disabled = true;
      newPostTa.value = "Please log in to post";
      const newPostButton: HTMLButtonElement = form.querySelector("button");
      newPostButton.disabled = true;
    } catch(e) {
      logger.error(`PostView.processNotLoggedIn(): Error manipulating DOM element, invalid template? Error: ${e}`);
    }
}
}
