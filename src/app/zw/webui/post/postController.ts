import { CubeKey } from "../../../../core/cube/cubeDefinitions";
import { CubeInfo } from "../../../../core/cube/cubeInfo";
import { CubeStore } from "../../../../core/cube/cubeStore";

import { cciFieldType } from "../../../../cci/cube/cciField";
import { cciFieldParsers, cciFields } from "../../../../cci/cube/cciFields";
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
import { NavigationController } from "../../../../webui/navigation/navigationController";
import { VerityUI } from "../../../../webui/verityUI";

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
  private displayedPosts: Map<string, PostData> = new Map();
  private annotationEngine: ZwAnnotationEngine;

  constructor(
      parent: ControllerContext,
      public contentAreaView: PostView = new PostView(),
  ){
    super(parent);

    // set nav methods
    this.viewSelectMethods.set("all", this.selectAllPosts);
    this.viewSelectMethods.set("withAuthors", this.selectPostsWithAuthors);
    this.viewSelectMethods.set("subscribedInTree", this.selectSubscribedInTree);
    this.viewSelectMethods.set("subscribedReplied", this.selectSubscribedReplied);
    this.viewSelectMethods.set("wot", this.selectWot);
  }

  //***
  // View selection methods
  //***
  async selectAllPosts(): Promise<void> {
    logger.trace("PostController: Displaying all posts including anonymous ones");
    this.removeAnnotationEngineListeners();
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
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
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
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
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      SubscriptionRequirement.subscribedInTree,
      await this.cubeStore.getCubeInfos(this.identity.subscriptionRecommendations),  // subscriptions
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
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      SubscriptionRequirement.subscribedReply,
      await this.cubeStore.getCubeInfos(
        await this.identity.recursiveWebOfSubscriptions(0)),  // subscriptions
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
    this.annotationEngine = await ZwAnnotationEngine.ZwConstruct(
      this.cubeStore,
      SubscriptionRequirement.subscribedReply,
      await this.cubeStore.getCubeInfos(
        await this.identity.recursiveWebOfSubscriptions(3)),  // subscriptions
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
    for await (const cubeInfo of this.cubeStore.getAllCubeInfos()) {
        if (await this.annotationEngine.isCubeDisplayable(cubeInfo.key)) {
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
    if (key instanceof Buffer) key = key.toString('hex');
    const postData: PostData = this.displayedPosts.get(key);
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
      id = await Identity.Construct(
        this.cubeStore,
        muc,
        {family: cciFamily});
    } catch(error) { return; }
    for (const post of id.posts) {
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
        data.authorsubscribed = this.identity.isSubscribed(authorObject.key);
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

  //***
  // Cleanup methods
  //***
  shutdown(): Promise<void> {
    this.removeAnnotationEngineListeners();
    return super.shutdown();
  }

}
