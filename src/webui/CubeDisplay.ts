import { Cube, CubeKey } from "../model/cube";
import { CubeInfo } from "../model/cubeInfo";
import { BaseRelationship } from "../model/baseFields";

import { Identity } from "../viewmodel/identity";
import { VerityUI } from "./VerityUI";
import { CubeFieldType, CubeRelationshipType } from "../model/cubeFields";
import { ZwFieldType, ZwFields } from "../viewmodel/zwFields";

export class CubeDisplay {
  parent: VerityUI;

  constructor(parent: VerityUI) {
    this.parent = parent;
    this.parent.annotationEngine.on('cubeDisplayable', (binaryKey) => this.displayCube(binaryKey)) // list cubes
  }



  redisplayCubes() {
    for (const cubeInfo of this.parent.node.cubeStore.getAllCubeInfo()) {
        if (this.parent.annotationEngine.isCubeDisplayable(cubeInfo.key)) {
            this.displayCube(cubeInfo.key);
        }
    }
  }

  // Show all new cubes that are displayable.
  // This will handle cubeStore cubeDisplayable events.
  displayCube(key: CubeKey) {
    const cubeInfo: CubeInfo = this.parent.node.cubeStore.getCubeInfo(key);
    const cube: Cube = cubeInfo.getCube() as Cube;

    // is this a reply?
    const replies: Array<BaseRelationship> = cube.getFields().getRelationships(CubeRelationshipType.REPLY_TO);
    if (replies.length > 0) {  // yes
      const originalpostkey: CubeKey = replies[0].remoteKey;
      const originalpost: CubeInfo = this.parent.node.cubeStore.getCubeInfo(
        originalpostkey);
      let originalpostli: HTMLLIElement = originalpost.applicationNotes.get('li');
      if (!originalpostli) {  // apparently the original post has not yet been displayed
        this.displayCube(originalpostkey);
        originalpostli = originalpost.applicationNotes.get('li');
      }
      this.displayCubeReply(key, cubeInfo, cube, originalpostli);
    }
    else {  // no, this is an original post
    const cubelist: HTMLElement | null = document.getElementById("cubelist")
    if (!cubelist) return;  // who deleted my cube list?!?!?!?!
    this.displayCubeInList(key, cubeInfo, cube, cubelist as HTMLUListElement);
    }
  }

  // TODO: clean up this mess of params
  displayCubeReply(key: CubeKey, replyInfo: CubeInfo, reply: Cube, original: HTMLLIElement) {
    // Does this post already have a reply list?
    let replylist: HTMLUListElement | null = original.getElementsByTagName("ul").item(0);
    if (!replylist) {  // no? time to create one
        replylist = document.createElement('ul');
        original.appendChild(replylist);
    }
    this.displayCubeInList(key, replyInfo, reply, replylist);
  }

  // TODO: clean up this mess of params
  // TODO: move Cube stuff to viewmodel and just handle displayable data (i.e. text) here
  displayCubeInList(key: CubeKey, cubeInfo: CubeInfo, cube: Cube, cubelist: HTMLUListElement): HTMLLIElement {
    const keystring = key.toString('hex');
    // Create cube entry
    const li: HTMLLIElement = document.createElement("li");
    li.setAttribute("cubekey", keystring);  // do we still need this?
    li.setAttribute("timestamp", String(cube.getDate())) // keep raw timestamp for later reference

    // Display cube display header (timestamp, user)
    const header: HTMLParagraphElement = document.createElement("p");

    // authorship information
    const author: Identity = this.parent.annotationEngine.cubeOwner(key);
    let authorText: string = ""
    if (author) {
      // TODO: display if this authorship information is authenticated,
      // i.e. if it comes from a MUC we trust
      authorText = author.name;
    } else {
      authorText = "Unknown user";
    }
    header.innerHTML += `<small><b>${authorText}</b></small><br />` // TODO: DO NOT USE innerHTML as partial strings (e.g. author name) are untrusted
    const date: Date = new Date(cube.getDate()*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    header.innerHTML += `<small>${date.toLocaleDateString(navigator.language, dateformat)} ${date.toLocaleTimeString(navigator.language)}</small><br />`
    li.appendChild(header);

    // Display cube payload
    const payload: HTMLParagraphElement = document.createElement('p');
    for (const field of ZwFields.get(cube).getFieldsByType(ZwFieldType.PAYLOAD)) {
        payload.innerText += field.value.toString();
    }
    li.append(payload);

    // Show cube key as tooltip
    li.title = `Cube Key ${keystring}`;

    // Display reply input field
    const replyfield: HTMLParagraphElement = document.createElement("p");
    replyfield.innerHTML += `<input id="replyinput-${keystring}" type="text" size="60" /> `;
    replyfield.innerHTML += `<button id="replybutton-${keystring}" onclick="window.verityUI.postReply(document.getElementById('replyinput-${keystring}').value, '${keystring}');">Reply</button>`;

    li.append(replyfield);

    // Insert sorted by date
    if (cubelist) {
        let appended: boolean = false;
        for (const child of cubelist.children) {
            const timestamp: string | null = child.getAttribute("timestamp");
            if (timestamp) {
                const childdate: number = parseInt(timestamp);
                if (childdate < cube.getDate()) {
                    cubelist.insertBefore(li, child);
                    appended = true;
                    break;
                }
            }
        }
        if (!appended) cubelist.appendChild(li);
    }
    // save this post's li as application note in the cube store
    // so we can later append replies to it
    cubeInfo.applicationNotes.set('li', li);
    return li;
  }
}
