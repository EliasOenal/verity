import { Cube, CubeKey } from "../model/cube";
import { CubeInfo } from "../model/cubeInfo";
import { CubeStore } from "../model/cubeStore";

import { Identity } from "../viewmodel/identity";
import { ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from "../viewmodel/zwFields";
import { ZwAnnotationEngine } from "../viewmodel/zwAnnotationEngine";

import { PostView } from "./PostView";

import { logger } from "../model/logger";

import { Buffer } from 'buffer';

export interface PostData {
  key: string;
  timestamp: number;
  author: string;
  text: string;

  /** @param If this is a reply, this refers to the superior post. */
  superior?: PostData;

  /**
   * @param The DOM object this post is displayed in.
   * Undefined if this post is not currently displayed.
   */
  displayElement?: HTMLLIElement;
}

/** This is the presenter class for viewing posts */
export class PostDisplay {
  private view: PostView;
  private displayedPosts: Map<string, PostData> = new Map();
  private cubeAuthorRedisplayTimer: NodeJS.Timeout = undefined;  // TODO replace, ugly.

  constructor(
      private cubeStore: CubeStore,
      private annotationEngine: ZwAnnotationEngine) {
    this.view = new PostView();
    this.annotationEngine.on('cubeDisplayable', (binaryKey) => this.displayPost(binaryKey)) // list cubes
    this.redisplayPosts();
    this.cubeAuthorRedisplayTimer = setInterval(() => this.redisplayAllCubeAuthors(), 10000);
  }

  shutdown() {
    clearInterval(this.cubeAuthorRedisplayTimer);
  }

  redisplayPosts() {
    // clear all currently displayed cubes:
    this.clearAllPosts();
    // redisplay them one by one:
    // logger.trace("CubeDisplay: Redisplaying all cubes");
    for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
        if (this.annotationEngine.isCubeDisplayable(cubeInfo.key)) {
            this.displayPost(cubeInfo.key);
        }
    }
  }

  /**
   * Must always be called when clearing the cube display, otherwise
   * CubeDisplay will still think the cubes are being displayed.
   */
  clearAllPosts(): void {
    this.displayedPosts.clear();
    this.view.clearAllPosts();
  }

  // Show all new cubes that are displayable.
  // This will handle cubeStore cubeDisplayable events.
  displayPost(key: CubeKey): void {
    // is this post already displayed?
    if (this.displayedPosts.has(key.toString('hex'))) return;
    const cube = this.cubeStore.getCube(key);

    // gather PostData
    const keystring = key.toString('hex');
    const text = ZwFields.get(cube).getFirstField(ZwFieldType.PAYLOAD).value.toString();

    let superior: PostData = undefined;
    // is this a reply?
    const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(key);
    const reply: ZwRelationship = ZwFields.get(cubeInfo.getCube()).getFirstRelationship(ZwRelationshipType.REPLY_TO);
    if (reply !== undefined) {  // yes
      const originalpostkey: CubeKey = reply.remoteKey;
      superior = this.displayedPosts.get(originalpostkey.toString('hex'));
      if (superior.displayElement === undefined) {
        // Apparently the original post has not yet been displayed, so let's display it
        this.displayPost(originalpostkey);
        if (superior.displayElement === undefined) {  // STILL not displayed?!?!
          logger.error("PostDisplay: Failed to display a post because the superior post cannot be displayed. This indicates displayPost was called on a non-displayable post, which should not be done.");
          return;
        }
      }
    }

    // compile all post information into a neat object
    const data: PostData = {
      key: keystring,
      timestamp: cube.getDate(),
      author: this.getAuthorString(key),
      text: text,
      superior: superior,
    }
    this.view.displayPost(data);  // have the view display the post
    this.displayedPosts.set(keystring, data);  // remember the displayed post
  }


  redisplayAllCubeAuthors() {
    logger.trace("CubeDisplay: Redisplaying all cube authors");
    for (const data of this.displayedPosts.values()) {
      const author: Identity = this.annotationEngine.cubeAuthor(Buffer.from(data.key, 'hex'));
      data.author = author.name;
      this.view.redisplayCubeAuthor(data);
    }
  }

  private getAuthorString(key: CubeKey) {
    const authorObject: Identity = this.annotationEngine.cubeAuthor(key);
    let authorstring: string = "";
    if (authorObject) {
      // TODO: display if this authorship information is authenticated,
      // i.e. if it comes from a MUC we trust
      authorstring = authorObject.name;
    } else {
      authorstring = "Unknown user";
    }
    return authorstring;
  }
}
