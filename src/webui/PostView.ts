import { PostData } from "./PostDisplay";

export class PostView {
  private cubelist: HTMLUListElement = (document.getElementById("cubelist") as HTMLUListElement);

  clearAllPosts() {
    this.cubelist.innerText='';
  }

  displayPost(data: PostData): void {
    const container = this.getOrCreateContainer(data);
    const li: HTMLLIElement = document.createElement("li");
    li.setAttribute("cubekey", data.key);  // do we still need this?
    li.setAttribute("timestamp", String(data.timestamp)); // keep raw timestamp for later reference

    // Display cube display header (timestamp, user)
    const header: HTMLParagraphElement = document.createElement("p");
    let headercontent = "";

    // show author
    headercontent += `<small><b id="${data.key}-author" class="cubeauthor">${data.author}</b></small><br />` // TODO: DO NOT USE innerHTML as partial strings (e.g. author name) are untrusted

    // show date
    const date: Date = new Date(data.timestamp*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    headercontent += `<small>${date.toLocaleDateString(navigator.language, dateformat)} ${date.toLocaleTimeString(navigator.language)}</small><br />`
    header.innerHTML = headercontent;
    li.appendChild(header);

    // Display post text
    const text: HTMLParagraphElement = document.createElement('p');
    text.innerText = data.text;
    li.append(text);

    // Show cube key as tooltip
    li.title = `Cube Key ${data.key}`;

    // Display reply input field
    const replyfield: HTMLParagraphElement = document.createElement("p");
    replyfield.setAttribute("class", "input-group");
    replyfield.innerHTML += `<input class="form-control" placeholder="Reply" id="replyinput-${data.key}" type="text" size="60" /> `;
    replyfield.innerHTML += `<button class="btn btn-primary" id="replybutton-${data.key}" onclick="window.verityUI.postReply(document.getElementById('replyinput-${data.key}').value, '${data.key}');">Post</button>`;
    li.append(replyfield);

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

    if (data.author) authorelement.innerText = data.author;
    else authorelement.innerText = "Unknown user";
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