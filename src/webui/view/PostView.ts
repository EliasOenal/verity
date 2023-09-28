import { ZwConfig } from "../../app/zwConfig";
import { logger } from "../../core/logger";
import { PostData } from "../PostDisplay";

export class PostView {
  private cubelist: HTMLUListElement = (document.getElementById("cubelist") as HTMLUListElement);

  clearAllPosts() {
    this.cubelist.innerText='';
  }

  displayPost(data: PostData): void {
    // Get the post template from HTML and clone it
    const container = this.getOrCreateContainer(data);
    const template: HTMLTemplateElement =
      document.getElementById("verityPostTemplate") as HTMLTemplateElement;
    const li: HTMLLIElement =
      template.content.firstElementChild.cloneNode(true) as HTMLLIElement;
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
    const date: Date = new Date(data.timestamp*1000);
    const dateformat: Intl.DateTimeFormatOptions =
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateelem.innerText =
      date.toLocaleDateString(navigator.language, dateformat) + " " +
      date.toLocaleTimeString(navigator.language);
    // post text
    const text: HTMLParagraphElement =
      li.getElementsByClassName("verityPostContent")[0] as HTMLParagraphElement;
    text.innerText = data.text;
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
    if (data.authorkey) {
      subscribeButton.setAttribute("data-authorkey", data.authorkey);
      if (data.authorsubscribed) subscribeButton.classList.add("active");
      else subscribeButton.classList.remove("active");
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
      return this.cubelist;
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
}