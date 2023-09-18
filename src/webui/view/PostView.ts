import { PostData } from "../PostDisplay";

export class PostView {
  private cubelist: HTMLUListElement = (document.getElementById("cubelist") as HTMLUListElement);

  clearAllPosts() {
    this.cubelist.innerText='';
  }

  displayPost(data: PostData): void {
    const container = this.getOrCreateContainer(data);
    const li: HTMLLIElement = document.createElement("li");
    li.setAttribute("cubekey", data.keystring);  // do we still need this?
    li.setAttribute("timestamp", String(data.timestamp)); // keep raw timestamp for later reference
    li.setAttribute("class", "move-fade-in");

    // Display cube display header (timestamp, user)
    const header: HTMLDivElement = document.createElement('div');
    header.setAttribute("class", "postHeader")

    // Profile pic part of header
    const profilepic: HTMLImageElement = document.createElement('img');
    profilepic.setAttribute("class", "postProfilePic");
    this.displayCubeProfilepic(data, profilepic);

    // Text part of header
    const headertext: HTMLParagraphElement = document.createElement("p");

    // show author
    const authorelem: HTMLElement = document.createElement("b");
    this.displayCubeAuthor(data, authorelem);
    headertext.appendChild(authorelem);
    headertext.appendChild(document.createElement("br"));

    // show date
    const date: Date = new Date(data.timestamp*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateelem: HTMLElement = document.createElement("small");
    dateelem.appendChild(document.createTextNode(
      date.toLocaleDateString(navigator.language, dateformat) + " " +
      date.toLocaleTimeString(navigator.language)
    ));
    dateelem.appendChild(document.createElement("br"));
    headertext.appendChild(dateelem);

    header.appendChild(profilepic);
    header.appendChild(headertext);
    li.appendChild(header);  // display whole header now

    // Display post text
    const text: HTMLParagraphElement = document.createElement('p');
    text.innerText = data.text;
    text.title = `Cube Key ${data.keystring}`;  // show cube key as tooltip
    li.append(text);

    // Display reply input field
    const replypara: HTMLParagraphElement = document.createElement("p");
    const replyform: HTMLFormElement = document.createElement("form");
    replypara.appendChild(replyform);
    replyform.setAttribute("action", "javascript:void(0);");
    replyform.setAttribute("onsubmit", `window.verityUI.postReply(document.getElementById('replyinput-${data.keystring}').value, '${data.keystring}');`)
    replyform.setAttribute("class", "input-group");
    const replyfield: HTMLTextAreaElement = document.createElement("textarea");
    replyfield.setAttribute("class", "form-control veritypostinput");
    replyfield.setAttribute("rows", "1");
    replyfield.setAttribute("placeholder", "Reply");
    replyfield.setAttribute("id", `replyinput-${data.keystring}`);
    replyfield.setAttribute("type", "text");
    replyfield.setAttribute("required", "");
    // auto-resize textares
    replyfield.setAttribute("style", `height: ${replyfield.scrollHeight}px;`);
    replyfield.addEventListener("input", function(){
        this.style.height = "0"; this.style.height = `${this.scrollHeight}px`
      }, false);
    replyform.appendChild(replyfield);
    const replybutton: HTMLButtonElement = document.createElement("button");
    replybutton.setAttribute("type", "submit");
    replybutton.setAttribute("class", "btn btn-primary");
    replybutton.setAttribute("id", `replybutton-${data.keystring}`);
    replybutton.appendChild(document.createTextNode("Post"));
    replyform.appendChild(replybutton);
    li.append(replypara);

    // Insert sorted by date
    let appended: boolean = false;
    for (const child of container.children) {
        const timestamp: string | null = child.getAttribute("timestamp");
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

    // save the display element to the PostData record
    data.displayElement = li;
  }

  redisplayCubeAuthor(data: PostData): void {
    // Get the HTML element the author of this post is displayed in.
    // Fail silently if there isn't any (shouldn't happen).
    const authorelementCollection = data.displayElement.getElementsByClassName("cubeauthor");
    if (!authorelementCollection) return;
    const authorelement = authorelementCollection[0] as HTMLElement;
    if (!authorelement) return;
    this.displayCubeAuthor(data, authorelement);
    const profilepicCollection = data.displayElement.getElementsByClassName("postProfilePic");
    if (!profilepicCollection) return;
    const profilepicElem = profilepicCollection[0] as HTMLImageElement;
    if (!profilepicElem) return;
    this.displayCubeProfilepic(data, profilepicElem);
  }

  private displayCubeAuthor(data: PostData, authorelem: HTMLElement) {
    authorelem.innerText = '';  // start with a clean slate
    authorelem.setAttribute("id", data.keystring + "-author");
    authorelem.setAttribute("class", "cubeauthor");
    if (data.authorkey) authorelem.setAttribute("title", "MUC key " + data.authorkey);
    authorelem.appendChild(document.createTextNode(data.author));
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