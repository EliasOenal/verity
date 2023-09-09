import { Cube, CubeKey } from "../model/cube";
import { CubeInfo } from "../model/cubeInfo";
import { CubeStore } from "../model/cubeStore";

import { Identity } from "../viewmodel/identity";
import { ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from "../viewmodel/zwFields";
import { ZwAnnotationEngine } from "../viewmodel/zwAnnotationEngine";

import { logger } from "../model/logger";

import { Buffer } from 'buffer';

export class CubeDisplay {
  private displayedCubes: Map<string, HTMLLIElement> = new Map();
  private cubelist: HTMLUListElement = (document.getElementById("cubelist") as HTMLUListElement);
  private cubeAuthorRedisplayTimer: NodeJS.Timeout = undefined;  // TODO replace, ugly.

  constructor(
      private cubeStore: CubeStore,
      private annotationEngine: ZwAnnotationEngine) {
    this.annotationEngine.on('cubeDisplayable', (binaryKey) => this.displayCube(binaryKey)) // list cubes
    this.redisplayCubes();
    this.cubeAuthorRedisplayTimer = setInterval(() => this.redisplayAllCubeAuthors(), 10000);
  }

  shutdown() {
    clearInterval(this.cubeAuthorRedisplayTimer);
  }

  redisplayCubes() {
    // clear all currently displayed cubes:
    this.clearAllCubes();
    // redisplay them one by one:
    // logger.trace("CubeDisplay: Redisplaying all cubes");
    for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
        if (this.annotationEngine.isCubeDisplayable(cubeInfo.key)) {
            this.displayCube(cubeInfo.key);
        }
    }
  }

  /**
   * Must always be called when clearing the cube display, otherwise
   * CubeDisplay will still think the cubes are being displayed.
   */
  clearAllCubes() {
    // logger.trace("CubeDisplay: Clearing all displayed cubes")
    this.displayedCubes.clear();
    this.cubelist.innerText='';
  }

  // Show all new cubes that are displayable.
  // This will handle cubeStore cubeDisplayable events.
  displayCube(key: CubeKey) {
    // is this post already displayed?
    if (this.displayedCubes.has(key.toString('hex'))) return;

    // is this a reply?
    const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(key);
    const reply: ZwRelationship = ZwFields.get(cubeInfo.getCube()).getFirstRelationship(ZwRelationshipType.REPLY_TO);
    if (reply !== undefined) {  // yes
      const originalpostkey: CubeKey = reply.remoteKey;
      let originalpostli: HTMLLIElement = this.displayedCubes.get(originalpostkey.toString('hex'));
      if (originalpostli === undefined) {  // apparently the original post has not yet been displayed
        this.displayCube(originalpostkey);
        originalpostli = this.displayedCubes.get(originalpostkey.toString('hex'));
      }
      this.displayCubeReply(key, cubeInfo, originalpostli);
    }
    else {  // no, this is an original post
    this.displayCubeInList(key, cubeInfo, this.cubelist as HTMLUListElement);
    }
  }

  // TODO: clean up this mess of params
  displayCubeReply(key: CubeKey, replyInfo: CubeInfo, original: HTMLLIElement) {
    // Does this post already have a reply list?
    let replylist: HTMLUListElement | null = original.getElementsByTagName("ul").item(0);
    if (!replylist) {  // no? time to create one
        replylist = document.createElement('ul');
        original.appendChild(replylist);
    }
    this.displayCubeInList(key, replyInfo, replylist);
  }

  // TODO: clean up this mess of params
  // TODO: move Cube stuff to viewmodel and just handle displayable data (i.e. text) here
  /**
   * @param localcubelist The cube list this cube should be displayed in.
   *                      Besides the global cube list (this.cubelist), this could
   *                      also be a sub-list representing replies.
   * @returns
   */
  displayCubeInList(key: CubeKey, cubeInfo: CubeInfo, localcubelist: HTMLUListElement): HTMLLIElement {
    const keystring = key.toString('hex');
    // Create cube entry
    const li: HTMLLIElement = document.createElement("li");
    li.setAttribute("cubekey", keystring);  // do we still need this?
    li.setAttribute("timestamp", String(cubeInfo.getCube().getDate())) // keep raw timestamp for later reference

    // Display cube display header (timestamp, user)
    const header: HTMLParagraphElement = document.createElement("p");

    // authorship information
    const author: Identity = this.annotationEngine.cubeAuthor(key);
    let authorText: string = ""
    if (author) {
      // TODO: display if this authorship information is authenticated,
      // i.e. if it comes from a MUC we trust
      authorText = author.name;
    } else {
      authorText = "Unknown user";
    }
    header.innerHTML += `<small><b id="${keystring}-author" class="cubeauthor">${authorText}</b></small><br />` // TODO: DO NOT USE innerHTML as partial strings (e.g. author name) are untrusted
    const date: Date = new Date(cubeInfo.getCube().getDate()*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    header.innerHTML += `<small>${date.toLocaleDateString(navigator.language, dateformat)} ${date.toLocaleTimeString(navigator.language)}</small><br />`
    li.appendChild(header);

    // Display cube payload
    const payload: HTMLParagraphElement = document.createElement('p');
    for (const field of ZwFields.get(cubeInfo.getCube()).getFieldsByType(ZwFieldType.PAYLOAD)) {
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
    if (localcubelist) {
        let appended: boolean = false;
        for (const child of localcubelist.children) {
            const timestamp: string | null = child.getAttribute("timestamp");
            if (timestamp) {
                const childdate: number = parseInt(timestamp);
                if (childdate < cubeInfo.getCube().getDate()) {
                    localcubelist.insertBefore(li, child);
                    appended = true;
                    break;
                }
            }
        }
        if (!appended) localcubelist.appendChild(li);
    }
    // save this post's li as application note in the cube store
    // so we can later append replies to it
    this.displayedCubes.set(keystring, li);
    return li;
  }

  redisplayAllCubeAuthors() {
    logger.trace("CubeDisplay: Redisplaying all cube authors");
    for (const [keystring, li] of this.displayedCubes) {
      const authorelementCollection = li.getElementsByClassName("cubeauthor");
      if (!authorelementCollection) continue;
      const authorelement = authorelementCollection[0] as HTMLElement;
      if (!authorelement) continue;

      const author: Identity = this.annotationEngine.cubeAuthor(Buffer.from(keystring, 'hex'));
      let authorText: string = ""
      if (author) {
        // TODO: display if this authorship information is authenticated,
        // i.e. if it comes from a MUC we trust
        authorText = author.name;
      } else {
        authorText = "Unknown user";
      }
      authorelement.innerText = authorText;
    }
  }
}
