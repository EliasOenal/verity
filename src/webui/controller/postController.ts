import { CubeKey } from "../../core/cube/cubeDefinitions";
import { CubeInfo } from "../../core/cube/cubeInfo";
import { CubeStore } from "../../core/cube/cubeStore";

import { cciFieldType } from "../../cci/cube/cciField";
import { cciFieldParsers, cciFields } from "../../cci/cube/cciFields";
import { cciCube, cciFamily } from "../../cci/cube/cciCube";
import { cciRelationship, cciRelationshipType } from "../../cci/cube/cciRelationship";
import { ensureCci } from "../../cci/cube/cciCubeUtil";
import { Identity } from "../../cci/identity/identity";
import { UNKNOWNAVATAR } from "../../cci/identity/avatar";

import { makePost } from "../../app/zwCubes";
import { ZwAnnotationEngine } from "../../app/zwAnnotationEngine";

import { PostView } from "../view/postView";
import { VerityController } from "./verityController";

import { logger } from "../../core/logger";

import { Buffer } from 'buffer';

// TODO refactor: just put the damn CubeInfo in here
export interface PostData {
  binarykey?: CubeKey;
  keystring?: string;
  timestamp?: number;
  author?: string;
  authorkey?: string
  authorsubscribed?: boolean;
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
export class PostController extends VerityController {
  private displayedPosts: Map<string, PostData> = new Map();
  private cubeAuthorRedisplayTimer: NodeJS.Timeout = undefined;  // TODO replace, ugly.

  constructor(
      private cubeStore: CubeStore,
      private annotationEngine: ZwAnnotationEngine,
      private identity: Identity = undefined,
      public view: PostView = new PostView()) {
    super();
    this.annotationEngine.on('cubeDisplayable', (binaryKey: CubeKey) => this.displayPost(binaryKey)); // list cubes
    this.annotationEngine.on('authorUpdated', (cubeInfo: CubeInfo) => this.redisplayAuthor(cubeInfo));
    this.redisplayPosts();
    // this.cubeAuthorRedisplayTimer = setInterval(() => this.redisplayAllCubeAuthors(), 5000);
  }

  async makeNewPost(input: HTMLFormElement) {
    const replytostring: string = input.getAttribute("data-cubekey");
    const replyto: CubeKey =
      replytostring? Buffer.from(replytostring, 'hex') : undefined;
    const textarea: HTMLTextAreaElement =
      input.getElementsByTagName("textarea")[0] as HTMLTextAreaElement;
    const text = textarea.value;
    if (!text.length) return;  // don't make empty posts
    // clear the input
    textarea.value = '';
    // @ts-ignore Typescript doesn't like us using custom window attributes
    window.onTextareaInput(textarea);
    // First create the post, then update the identity, then add the cube.
    // This way the UI directly displays you as the author.
    const post = await makePost(text, replyto, this.identity);
    if (this.identity) await this.identity.store("ID/ZW");  // TODO: move this to constructor
    this.cubeStore.addCube(post);
  }

  async subscribeUser(subscribeButton: HTMLButtonElement) {
    const authorkeystring = subscribeButton.getAttribute("data-authorkey");
    const authorkey = Buffer.from(authorkeystring, 'hex');
    // subscribing or unsubscribing?
    if (subscribeButton.classList.contains("active")) {
      logger.trace("VerityUI: Unsubscribing from " + authorkeystring);
      this.identity.removeSubscriptionRecommendation(authorkey);
      subscribeButton.classList.remove("active");
      await this.identity.store("ID/ZW");
    } else {
      logger.trace("VerityUI: Subscribing to " + authorkeystring);
      this.identity.addSubscriptionRecommendation(authorkey);
      subscribeButton.classList.add("active");
      await this.identity.store("ID/ZW");
    }
    this.redisplayAuthor(this.cubeStore.getCubeInfo(authorkeystring));
  }


  shutdown(): Promise<void> {
    clearInterval(this.cubeAuthorRedisplayTimer);
    // Return a resolved promise
    return new Promise<void>(resolve => resolve());
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
    this.view.clearAll();
  }

  // Show all new cubes that are displayable.
  // This will handle cubeStore cubeDisplayable events.
  displayPost(binarykey: CubeKey): void {
    // logger.trace(`PostDisplay: Attempting to display post ${binarykey.toString('hex')}`)
    // get Cube
    const cube: cciCube = ensureCci(this.cubeStore.getCube(binarykey, cciFamily));
    if (cube === undefined) return;
    const fields: cciFields = cube.fields;

    // gather PostData
    const data: PostData = {};
    data.binarykey = binarykey;
    data.keystring = binarykey.toString('hex');
    data.timestamp = cube.getDate();
    data.text = fields.getFirst(cciFieldType.PAYLOAD).value.toString();
    this.findAuthor(data);  // this sets data.author and data.authorkey

    // is this post already displayed?
    if (this.displayedPosts.has(data.keystring)) return;

    // is this a reply?
    const reply: cciRelationship = fields.getFirstRelationship(cciRelationshipType.REPLY_TO);
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

  /** Redisplays authorship information for a single post */
  redisplayPostAuthor(key: CubeKey | string) {
    if (key instanceof Buffer) key = key.toString('hex');
    const postData: PostData = this.displayedPosts.get(key);
    if (!postData) return;
    this.findAuthor(postData);  // this (re-)sets data.author and data.authorkey
    this.view.redisplayCubeAuthor(postData);
  }

  /** Redisplays authorship information for all of one author's posts */
  redisplayAuthor(mucInfo: CubeInfo) {
    const muc = ensureCci(mucInfo.getCube(cciFamily));
    if (muc === undefined) {
      logger.trace(`PostController.redisplayAuthor: Cannot get author for post ${mucInfo.keyString} as it does not appear to be a CCI cube`);
      return;  // not CCI or garbage
    }
    let id: Identity;
    // maybe TODO: Recreating the whole Identity is unnecessary.
    // Identity should split out the post list retrieval code into a static method.
    try {
      id = new Identity(
        this.cubeStore,
        muc,
        {parsers: cciFieldParsers});
    } catch(error) { return; }
    for (const post of id.posts) {
      const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(post);
      if (!cubeInfo) continue;
      this.redisplayPostAuthor(cubeInfo.key);
    }
  }

  // Maybe TODO remove? This should no longer be needed.
  redisplayAllAuthors(): void {
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
      data.profilepic = authorObject.avatar.render();

      // is this author subscribed?
      if (this.identity) {
        data.authorsubscribed = this.identity.isSubscribed(authorObject.key);
      } else {
        data.authorsubscribed = false;  // no Identity, no subscriptions
      }
    } else {
      data.author = "Unknown user";
      data.profilepic = UNKNOWNAVATAR;
    }
    if (data.author.length > 60) {
      data.author = data.author.slice(0, 57) + "...";
    }
  }
}
