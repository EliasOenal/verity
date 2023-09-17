import { Cube, CubeKey } from "../core/cube";
import { CubeInfo } from "../core/cubeInfo";
import { CubeStore } from "../core/cubeStore";

import { Identity } from "../app/identity";
import { ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from "../app/zwFields";
import { ZwAnnotationEngine } from "../app/zwAnnotationEngine";

import { PostView } from "./PostView";

import { logger } from "../core/logger";

import { Buffer } from 'buffer';
import multiavatar from '@multiavatar/multiavatar'

export interface PostData {
  binarykey?: CubeKey;
  keystring?: string;
  timestamp?: number;
  author?: string;
  authorkey?: string
  text?: string;
  profilepic?: string;  // SVG or base64 representation of a raster image

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
    this.cubeAuthorRedisplayTimer = setInterval(() => this.redisplayAllCubeAuthors(), 5000);
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
  displayPost(binarykey: CubeKey): void {
    // logger.trace(`PostDisplay: Attempting to display post ${binarykey.toString('hex')}`)
    // get Cube
    const cube = this.cubeStore.getCube(binarykey);
    const fields: ZwFields = ZwFields.get(cube);

    // gather PostData
    const data: PostData = {};
    data.binarykey = binarykey;
    data.keystring = binarykey.toString('hex');
    data.timestamp = cube.getDate();
    data.text = fields.getFirstField(ZwFieldType.PAYLOAD).value.toString();
    this.findAuthor(data);  // this sets data.author and data.authorkey

    // is this post already displayed?
    if (this.displayedPosts.has(data.keystring)) return;

    // is this a reply?
    const reply: ZwRelationship = fields.getFirstRelationship(ZwRelationshipType.REPLY_TO);
    if (reply !== undefined) {  // yes
      const superiorPostKey: CubeKey = reply.remoteKey;
      data.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
      if (!data.superior) {
        // Apparently the original post has not yet been displayed, so let's display it
        this.displayPost(superiorPostKey);
        data.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
        if (!data.superior || !data.superior.displayElement) {  // STILL not displayed?!?!
          logger.error("PostDisplay: Failed to display a post because the superior post cannot be displayed. This indicates displayPost was called on a non-displayable post, which should not be done.");
          return;
        }
      }
    }

    this.view.displayPost(data);  // have the view display the post
    this.displayedPosts.set(data.keystring, data);  // remember the displayed post
  }


  redisplayAllCubeAuthors(): void {
    logger.trace("CubeDisplay: Redisplaying all cube authors");
    for (const data of this.displayedPosts.values()) {
      this.findAuthor(data);  // this (re-)sets data.author and data.authorkey
      this.view.redisplayCubeAuthor(data);
    }
  }

  private findAuthor(data: PostData): void {
    const authorObject: Identity = this.annotationEngine.cubeAuthor(data.binarykey);
    if (authorObject) {
      data.authorkey = authorObject.key.toString('hex');
      // TODO: display if this authorship information is authenticated,
      // i.e. if it comes from a MUC we trust
      data.author = authorObject.name;
    } else {
      data.author = "Unknown user";
    }
    if (data.author.length > 60) {
      data.author = data.author.slice(0, 57) + "...";
    }

    // Get profile image if the use has one, otherwise generate an avatar
    // for them based on their MUC key. Use the post key if there's no MUC.
    // TODO: real profile pictures not implemented yet
    if (data.authorkey) data.profilepic = multiavatar(data.authorkey);
    else data.profilepic = multiavatar(data.keystring);
    data.profilepic = "data:image/svg+xml;base64," + btoa(data.profilepic);
  }
}
