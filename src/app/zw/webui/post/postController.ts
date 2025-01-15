import { CubeKey } from "../../../../core/cube/cube.definitions";
import { CubeInfo } from "../../../../core/cube/cubeInfo";

import { cciFieldType } from "../../../../cci/cube/cciCube.definitions";
import { cciFields } from "../../../../cci/cube/cciFields";
import { cciCube, cciFamily } from "../../../../cci/cube/cciCube";
import { cciRelationship, cciRelationshipType } from "../../../../cci/cube/cciRelationship";
import { ensureCci } from "../../../../cci/cube/cciCubeUtil";
import { Identity } from "../../../../cci/identity/identity";
import { UNKNOWNAVATAR } from "../../../../cci/identity/avatar";

import { makePost } from "../../model/zwUtil";
import { SubscriptionRequirement, ZwAnnotationEngine } from "../../model/zwAnnotationEngine";

import { PostView } from "./postView";
import { ControllerContext, VerityController } from "../../../../webui/verityController";

import { logger } from "../../../../core/logger";

import { Buffer } from 'buffer';
import { FileApplication } from '../../../fileApplication';
import DOMPurify from 'dompurify';
import { keyVariants } from "../../../../core/cube/cubeUtil";
import { ArrayFromAsync } from "../../../../core/helpers/misc";

// TODO refactor: just put the damn CubeInfo in here
export interface PostData {
  binarykey?: CubeKey;
  keystring?: string;
  timestamp?: number;
  author?: string;
  authorkey?: string
  authorsubscribed?: boolean | "self" | "none";
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

export class PostController extends VerityController {
  declare public contentAreaView: PostView;
  private displayedPosts: Map<string, PostData> = new Map();
  private annotationEngine: ZwAnnotationEngine;

  constructor(
      parent: ControllerContext,
  ){
    super(parent);
    this.contentAreaView = new PostView(this);
  }

  //***
  // View selection methods
  //***
  async selectAllPosts(): Promise<void> {
    logger.trace("PostController: Displaying all posts including anonymous ones");
    this.removeAnnotationEngineListeners();
    this.annotationEngine?.shutdown();
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      this.cubeRetriever,
      SubscriptionRequirement.none,  // show all posts
      [],       // subscriptions don't play a role in this mode
      true,     // auto-learn MUCs to display authorship info if available
      true,     // allow anonymous posts
    );
    this.annotationEngine.on('cubeDisplayable', (binaryKey: CubeKey) => this.displayPost(binaryKey));
    this.annotationEngine.on('authorUpdated', (cubeInfo: CubeInfo) => this.redisplayAuthor(cubeInfo));
    return this.redisplayPosts();
  }

  async selectPostsWithAuthors(): Promise<void> {
    logger.trace("PostController: Displaying posts associated with a MUC");
    this.removeAnnotationEngineListeners();
    this.annotationEngine?.shutdown();
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      this.cubeRetriever,
      SubscriptionRequirement.none,
      [],       // no subscriptions as they don't play a role in this mode
      true,     // auto-learn MUCs (posts associated with any Identity MUC are okay)
      false,
    );
    this.annotationEngine.on('cubeDisplayable', (binaryKey: CubeKey) => this.displayPost(binaryKey));
    this.annotationEngine.on('authorUpdated', (cubeInfo: CubeInfo) => this.redisplayAuthor(cubeInfo));
    return this.redisplayPosts();
  }

  async selectSubscribedInTree(): Promise<void> {
    logger.trace("PostController: Displaying posts from trees with subscribed author activity");
    this.removeAnnotationEngineListeners();
    this.annotationEngine?.shutdown();
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      this.cubeRetriever,
      SubscriptionRequirement.subscribedInTree,
      await ArrayFromAsync(this.cubeStore.getCubeInfos(this.identity.getPublicSubscriptionStrings())),  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false,     // do not allow anonymous posts
    );
    this.annotationEngine.on('cubeDisplayable', (binaryKey: CubeKey) => this.displayPost(binaryKey));
    this.annotationEngine.on('authorUpdated', (cubeInfo: CubeInfo) => this.redisplayAuthor(cubeInfo));
    return this.redisplayPosts();
  }

  async selectSubscribedReplied(): Promise<void> {
    logger.trace("PostController: Displaying posts from subscribed authors and their preceding posts");
    this.removeAnnotationEngineListeners();
    this.annotationEngine?.shutdown();
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      this.cubeRetriever,
      SubscriptionRequirement.subscribedReply,
      await ArrayFromAsync(this.cubeStore.getCubeInfos(
        await this.identity.recursiveWebOfSubscriptions(0))),  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false,     // do not allow anonymous posts
    );
    this.annotationEngine.on('cubeDisplayable', (binaryKey: CubeKey) => this.displayPost(binaryKey));
    this.annotationEngine.on('authorUpdated', (cubeInfo: CubeInfo) => this.redisplayAuthor(cubeInfo));
    return this.redisplayPosts();
  }

  async selectWot(): Promise<void> {
    logger.trace("PostController: Displaying posts from subscribed, sub-subscribed and sub-sub-subscribed authors and their preceding posts (WOT3)");
    this.removeAnnotationEngineListeners();
    this.annotationEngine?.shutdown();
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      this.cubeRetriever,
      SubscriptionRequirement.subscribedReply,
      await ArrayFromAsync(this.cubeStore.getCubeInfos(
        await this.identity.recursiveWebOfSubscriptions(3))),  // subscriptions
      true,      // auto-learn MUCs (to be able to display authors when available)
      false,     // do not allow anonymous posts
    );
    this.annotationEngine.on('cubeDisplayable', (binaryKey: CubeKey) => this.displayPost(binaryKey));
    this.annotationEngine.on('authorUpdated', (cubeInfo: CubeInfo) => this.redisplayAuthor(cubeInfo));
    return this.redisplayPosts();
  }

  //***
  // View assembly methods
  //***

  async redisplayPosts(): Promise<void> {
    // clear all currently displayed cubes:
    this.clearAllPosts();
    // redisplay them one by one:
    // logger.trace("CubeDisplay: Redisplaying all cubes");
    // TODO: we need to get rid of this full CubeStore walk
    for await (const cubeInfo of this.cubeStore.getCubeInfoRange({ limit: Infinity })) {
        if (await this.annotationEngine.isCubeDisplayable(cubeInfo)) {
            await this.displayPost(cubeInfo.key);
        }
    }
  }

  /**
   * Must always be called when clearing the cube display, otherwise
   * CubeDisplay will still think the cubes are being displayed.
   */
  clearAllPosts(): void {
    this.displayedPosts.clear();
    this.contentAreaView.clearAll();
  }

  // Show all new cubes that are displayable.
  // This will handle cubeStore cubeDisplayable events.
  async displayPost(binarykey: CubeKey): Promise<void> {
    // logger.trace(`PostDisplay: Attempting to display post ${binarykey.toString('hex')}`)
    // get Cube
    const cube: cciCube = ensureCci(await this.cubeStore.getCube(binarykey, cciFamily));
    if (cube === undefined) return;
    const fields: cciFields = cube.fields;

    // gather PostData
    const data: PostData = {};
    data.binarykey = binarykey;
    data.keystring = binarykey.toString('hex');
    data.timestamp = cube.getDate();
    data.text = fields.getFirst(cciFieldType.PAYLOAD).value.toString();
    data.text = DOMPurify.sanitize(data.text, {
      ALLOWED_TAGS: ['b', 'i', 'u', 's', 'em', 'strong', 'mark', 'sub', 'sup', 'p', 'br', 'ul', 'ol', 'li'],
      ALLOWED_ATTR: []
    });
    data.text = await this.processImageTags(data.text);
    await this.findAuthor(data);  // this sets data.author and data.authorkey

    // is this post already displayed?
    if (this.displayedPosts.has(data.keystring)) return;

    // is this a reply?
    const reply: cciRelationship = fields.getFirstRelationship(cciRelationshipType.REPLY_TO);
    if (reply !== undefined) {  // yes
      const superiorPostKey: CubeKey = reply.remoteKey;
      data.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
      if (!data.superior) {
        // Apparently the original post has not yet been displayed, so let's display it
        await this.displayPost(superiorPostKey);
        data.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
        if (!data.superior || !data.superior.displayElement) {  // STILL not displayed?!?!
          logger.error("PostController: Failed to display a post because the superior post cannot be displayed. This indicates displayPost was called on a non-displayable post, which should not be done.");
          return;
        }
      }
    }

    this.contentAreaView.displayPost(data);  // have the view display the post
    this.displayedPosts.set(data.keystring, data);  // remember the displayed post
  }

  /** Redisplays authorship information for a single post */
  redisplayPostAuthor(key: CubeKey | string) {
    const postData: PostData = this.displayedPosts.get(keyVariants(key).keyString);
    if (!postData) return;
    this.findAuthor(postData);  // this (re-)sets data.author and data.authorkey
    this.contentAreaView.redisplayCubeAuthor(postData);
  }

  /** Redisplays authorship information for all of one author's posts */
  async redisplayAuthor(mucInfo: CubeInfo) {
    const muc = ensureCci(mucInfo.getCube(cciFamily));
    if (muc === undefined) {
      logger.trace(`PostController.redisplayAuthor: Cannot get author for post ${mucInfo.keyString} as it does not appear to be a CCI cube`);
      return;  // not CCI or garbage
    }
    let id: Identity;
    // maybe TODO: Recreating the whole Identity is unnecessary.
    // Identity should split out the post list retrieval code into a static method.
    try {
      id = await Identity.Construct(this.cubeStore, muc);
    } catch(error) { return; }
    for (const post of id.getPostKeyStrings()) {
      const cubeInfo: CubeInfo = await this.cubeStore.getCubeInfo(post);
      if (!cubeInfo) continue;
      this.redisplayPostAuthor(cubeInfo.key);
    }
  }

  // Maybe TODO remove? This should no longer be needed.
  redisplayAllAuthors(): void {
    logger.trace("CubeDisplay: Redisplaying all cube authors");
    for (const data of this.displayedPosts.values()) {
      this.findAuthor(data);  // this (re-)sets data.author and data.authorkey
      this.contentAreaView.redisplayCubeAuthor(data);
    }
  }

  //***
  // Navigation methods
  //***

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
    if (this.identity) await this.identity.store();
    this.cubeStore.addCube(post);
  }

  async subscribeUser(subscribeButton: HTMLButtonElement) {
    const authorkeystring = subscribeButton.getAttribute("data-authorkey");
    const authorkey = Buffer.from(authorkeystring, 'hex');
    // subscribing or unsubscribing?
    if (subscribeButton.classList.contains("active")) {
      logger.trace("VerityUI: Unsubscribing from " + authorkeystring);
      this.identity.removePublicSubscription(authorkey);
      subscribeButton.classList.remove("active");
      await this.identity.store();
    } else {
      logger.trace("VerityUI: Subscribing to " + authorkeystring);
      this.identity.addPublicSubscription(authorkey);
      subscribeButton.classList.add("active");
      await this.identity.store();
    }
    this.redisplayAuthor(await this.cubeStore.getCubeInfo(authorkeystring));
  }


  //***
  // Data conversion methods
  //***
  private async findAuthor(data: PostData): Promise<void> {
    const authorObject: Identity = await this.annotationEngine.cubeAuthor(data.binarykey);
    if (authorObject) {
      data.authorkey = authorObject.key.toString('hex');
      // TODO: display if this authorship information is authenticated,
      // i.e. if it comes from a MUC we trust
      data.author = authorObject.name;
      data.profilepic = authorObject.avatar.render();

      // is this author subscribed?
      if (this.identity) {
        data.authorsubscribed = this.identity.hasPublicSubscription(authorObject.key);
        // or is this even my own post?
        if (authorObject.key.equals(this.identity.publicKey)) data.authorsubscribed = "self";
      } else {
        data.authorsubscribed = "none";  // no Identity, no subscriptions
      }
    } else {
      data.author = "Unknown user";
      data.profilepic = UNKNOWNAVATAR;
    }
    if (data.author.length > 60) {
      data.author = data.author.slice(0, 57) + "...";
    }
  }

  //***
  // State management methods
  //***
  private removeAnnotationEngineListeners(): void {
    this.annotationEngine?.removeListener('cubeDisplayable', (binaryKey: CubeKey) => this.displayPost(binaryKey));
    this.annotationEngine?.removeListener('authorUpdated', (cubeInfo: CubeInfo) => this.redisplayAuthor(cubeInfo));
  }

  private async processImageTags(text: string): Promise<string> {
    const regex = /\[img\]([a-fA-F0-9]{64})\[\/img\]/g;
    const promises = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      const cubeKey = match[1];
      promises.push(this.getImageDataUrl(cubeKey));
    }

    const imageDataUrls = await Promise.all(promises);

    return text.replace(regex, (_, cubeKey) => {
      const dataUrl = imageDataUrls.shift();
      return dataUrl ? `<img src="${dataUrl}" alt="${cubeKey}">` : '[Image not found]';
    });
  }

  private async getImageDataUrl(cubeKey: string): Promise<string | null> {
    try {
      const { content, fileName } = await FileApplication.retrieveFile(Buffer.from(cubeKey, 'hex'), this.cubeStore);
      const base64 = Buffer.from(content).toString('base64');
      const mimeType = this.getMimeType(fileName);
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      console.error('Error retrieving image:', error);
      return null;
    }
  }

  private getMimeType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      default:
        return 'application/octet-stream';
    }
  }

  //***
  // Framework event handling
  //***
  async identityChanged(): Promise<boolean> {
    // TODO: we should handle Identity changes gracefully and update the
    // existing view.
    // As we currently don't do that, just return false which will cause us
    // to get restarted on Identity changes.
    return false;
  }

  //***
  // Cleanup methods
  //***
  shutdown(unshow: boolean = true, callback: boolean = true): Promise<void> {
    this.removeAnnotationEngineListeners();
    return super.shutdown(unshow, callback);
  }

}
