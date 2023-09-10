import { PostData } from "./PostDisplay";

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

    // Display cube display header (timestamp, user)
    const header: HTMLParagraphElement = document.createElement("p");

    // show author
    const authorelem: HTMLElement = document.createElement("small");
    this.displayCubeAuthor(data, authorelem);
    header.appendChild(authorelem);
    header.appendChild(document.createElement("br"));

    // show date
    const date: Date = new Date(data.timestamp*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateelem: HTMLElement = document.createElement("small");
    dateelem.appendChild(document.createTextNode(
      date.toLocaleDateString(navigator.language, dateformat) + " " +
      date.toLocaleTimeString(navigator.language)
    ));
    dateelem.appendChild(document.createElement("br"));
    header.appendChild(dateelem);
    li.appendChild(header);  // display whole header now

    // Display post text
    const text: HTMLParagraphElement = document.createElement('p');
    text.innerText = data.text;
    text.title = `Cube Key ${data.keystring}`;  // show cube key as tooltip
    li.append(text);

    // Display reply input field
    const replyfield: HTMLParagraphElement = document.createElement("p");
    replyfield.setAttribute("class", "input-group");
    replyfield.innerHTML += `<input class="form-control" placeholder="Reply" id="replyinput-${data.keystring}" type="text" size="60" /> `;
    replyfield.innerHTML += `<button class="btn btn-primary" id="replybutton-${data.keystring}" onclick="window.verityUI.postReply(document.getElementById('replyinput-${data.keystring}').value, '${data.keystring}');">Post</button>`;
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
    this.displayCubeAuthor(data, authorelement);
  }

  private displayCubeAuthor(data: PostData, authorelem: HTMLElement) {
    authorelem.innerText = '';  // start with a clean slate
    authorelem.setAttribute("style", "font-weight: bold");
    authorelem.setAttribute("id", data.keystring + "-author");
    authorelem.setAttribute("class", "cubeauthor");
    if (data.authorkey) authorelem.setAttribute("title", "MUC key " + data.authorkey);
    authorelem.appendChild(document.createTextNode(data.author));
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