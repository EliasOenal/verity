import { CubeKey } from "../../../../core/cube/cube.definitions";
import { Cube } from "../../../../core/cube/cube";
import { CubeInfo } from "../../../../core/cube/cubeInfo";
import { keyVariants } from "../../../../core/cube/cubeUtil";
import { CubeEmitter } from "../../../../core/cube/cubeStore";
import { logger } from "../../../../core/logger";

import { FieldLength, FieldType, MediaTypes } from "../../../../cci/cube/cciCube.definitions";
import { VerityFields } from "../../../../cci/cube/verityFields";
import { cciCube, cciFamily } from "../../../../cci/cube/cciCube";
import { Relationship, RelationshipType } from "../../../../cci/cube/relationship";
import { ensureCci, isCci } from "../../../../cci/cube/cciCubeUtil";
import { GetPostsGenerator, Identity, PostFormat, PostInfo } from "../../../../cci/identity/identity";
import { UNKNOWNAVATAR } from "../../../../cci/identity/avatar";

import { ZwConfig } from "../../model/zwConfig";
import { assertZwCube, makePost } from "../../model/zwUtil";
import { SubscriptionRequirement, ZwAnnotationEngine } from "../../model/zwAnnotationEngine";

import { ControllerContext, VerityController } from "../../../../webui/verityController";
import { PostView } from "./postView";

import { FileApplication } from '../../../fileApplication';

import { Buffer } from 'buffer';
import DOMPurify from 'dompurify';
import { eventsToGenerator, mergeAsyncGenerators, MergedAsyncGenerator } from "../../../../core/helpers/asyncGenerators";
import { CubeRetriever } from "../../../../core/networking/cubeRetrieval/cubeRetriever";
import { IdentityStore } from "../../../../cci/identity/identityStore";
import { notifyingIdentities } from "../../../../cci/identity/identityUtil";


// TODO refactor: just put the damn CubeInfo in here
export interface PostData {
  binarykey?: CubeKey;
  keystring?: string;
  timestamp?: number;
  identity?: Identity;
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
  private postGenerator: MergedAsyncGenerator<Cube|PostInfo<Cube>>;
  private idStore: IdentityStore;

  constructor(
      parent: ControllerContext,
  ){
    super(parent);
    this.contentAreaView = new PostView(this);

    this.idStore = this.identity?.identityStore ?? new IdentityStore(this.cubeRetriever);
  }

  //***
  // Navigation methods
  //***

  async navSubscribed(depth: number = 1): Promise<void> {
    logger.trace("PostController: Displaying posts by subscriptions");
    this.shutdownComponents();
    this.contentAreaView.clearAlerts();

    if (!this.identity) {  // must be logged in
      this.contentAreaView.makeAlert("Please log in to follow your subscribed authors");
      return;
    }

    this.postGenerator = this.identity.getPosts({
      depth,
      format: PostFormat.Cube,
      postInfo: true,
      subscribe: true,
    })
    return this.redisplayPosts((this.postGenerator as GetPostsGenerator<CubeInfo>).existingYielded);
  }

  navWot(): Promise<void> {
    return this.navSubscribed(5);
  }

  async navExplore(): Promise<void> {
    logger.trace("PostController: Displaying posts by notifications");
    this.shutdownComponents();

    // start an endless fetch of ZW Identities and store them all in a list
    this.postGenerator = mergeAsyncGenerators();
    this.postGenerator.setEndless();

    const identityGen: AsyncGenerator<Identity> = notifyingIdentities(
      this.cubeRetriever,
      ZwConfig.NOTIFICATION_KEY,
      this.idStore,
      { subscribe: true },
    );
    (async() => {
      for await (const identity of identityGen) {
        const postsGen = identity.getPosts({
          depth: 0,
          format: PostFormat.Cube,
          postInfo: true,
          subscribe: true,
        });
        this.postGenerator.addInputGenerator(postsGen);
      }
    })();

    // TODO stop generators on teardown
    // maybe TODO: expose getting posts from multiple Identities as a common
    //   IdentityUtil building block. Maybe introduce a new class IdentityGroup
    //   following Identity's API for getting posts and subscriptions from all
    //   group members.

    // TODO define a sensible done promise
    return this.redisplayPosts(new Promise(resolve => setTimeout(resolve, 100)));
  }

  //***
  // View assembly methods
  //***

  redisplayPosts(donePromise: Promise<void> = Promise.resolve()): Promise<void> {
    let displayPromises: Promise<void>[] = [];
    // clear all currently displayed cubes...
    this.clearAllPosts();
    // ...and redisplay them one by one
    // logger.trace("CubeDisplay: Redisplaying all cubes");
    if (this.postGenerator) {
      (async() => {
        for await (const post of this.postGenerator) {
          const displayPromise = this.displayPost(post);
          if (displayPromises) displayPromises.push(displayPromise);
        }
      })();
    } else {
      logger.warn("PostController.redisplayPosts() called, but we either have no post Generator. You will not see any posts.");
    }
    return donePromise.then(() => {
      const promises = displayPromises;
      displayPromises = undefined;
      return Promise.all(promises).then();
    });
  }

  private isPostDisplayable(cube: Cube): boolean {
    // is this even a valid ZwCube?
    if (!assertZwCube(cube)) return false;

    // does this have a Payload field and does it contain something??
    const payload = cube.getFirstField(FieldType.PAYLOAD);
    if (!payload || !payload.length) return false;

    // does it have the correct media type?
    const typefield = cube.getFirstField(FieldType.MEDIA_TYPE);
    if (!typefield) return false;
    if (typefield.value.readUIntBE(0, FieldLength[FieldType.MEDIA_TYPE]) !== MediaTypes.TEXT) {
      return false;
    }

    return true;  // all checks passed
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
  private async displayPost(input: CubeKey|Cube|PostInfo<Cube>): Promise<void> {
    // normalise input:
    // setting cube:
    let cube: cciCube;
    if (input instanceof Cube) cube = input as cciCube;
    else if (input instanceof CubeInfo) cube = input.getCube() as cciCube;
    else if (Buffer.isBuffer(input)) cube = await this.cubeRetriever.getCube(input, {family: cciFamily});
    else if (input['post']) cube = input.post as cciCube;
    else {
      logger.error(`PostController.displayPost(): Invalid input type: ${typeof input}`);
      return;
    }

    // sanity checks
    if (!this.isPostDisplayable(cube)) {
      logger.trace(`PostController.displayPost(): Ignoring a non-displayable Cube`);
      return;
    }

    // logger.trace(`PostDisplay: Attempting to display post ${binarykey.toString('hex')}`)
    // get Cube
    const fields: VerityFields = cube.fields;

    // gather PostData
    const data: PostData = {};
    data.binarykey = await cube.getKey();
    data.keystring = keyVariants(data.binarykey).keyString;
    data.timestamp = cube.getDate();
    data.text = fields.getFirst(FieldType.PAYLOAD).value.toString();
    data.text = DOMPurify.sanitize(data.text, {
      ALLOWED_TAGS: ['b', 'i', 'u', 's', 'em', 'strong', 'mark', 'sub', 'sup', 'p', 'br', 'ul', 'ol', 'li'],
      ALLOWED_ATTR: []
    });
    data.text = await this.processImageTags(data.text);
    // Author known?
    data.identity = (input as PostInfo<Cube>).author ?? undefined;
    this.parseAuthor(data);

    // is this post already displayed?
    if (this.displayedPosts.has(data.keystring)) return;

    // is this a reply?
    const reply: Relationship = fields.getFirstRelationship(RelationshipType.REPLY_TO);
    if (reply !== undefined) {  // yes
      const superiorPostKey: CubeKey = reply.remoteKey;
      data.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
      if (!data.superior) {
        // Apparently the original post has not yet been displayed, so let's display it
        await this.displayPost(superiorPostKey);
        data.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
        if (!data.superior || !data.superior.displayElement) {  // STILL not displayed?!?!
          logger.debug(`PostController: Failed to display post ${superiorPostKey.toString('hex')} because the superior post cannot be displayed.`);
          return;
        }
      }
    }

    // we've awaited stuff, so let's check again: is this post already displayed?
    if (this.displayedPosts.has(data.keystring)) return;

    this.contentAreaView.displayPost(data);  // have the view display the post
    this.displayedPosts.set(data.keystring, data);  // remember the displayed post
  }

  private parseAuthor(data: PostData): void {
    // Is the author known?
    if (data.identity) {
      data.author = data.identity.name;
      data.authorkey = data.identity.keyString;
      data.profilepic = data.identity.avatar.render();

      // is this author subscribed?
      if (this.identity) {
        data.authorsubscribed = this.identity.hasPublicSubscription(data.identity.key);
        // or is this even my own post?
        if (data.identity.key.equals(this.identity.publicKey)) data.authorsubscribed = "self";
      } else {
        data.authorsubscribed = "none";  // no Identity, no subscriptions
      }
    } else {
      // Author not known
      data.author = "Unknown user";
      data.profilepic = UNKNOWNAVATAR;
    }
    // Limit author username length
    if (data.author.length > 60) {
      data.author = data.author.slice(0, 57) + "...";
    }
  }

  /** Redisplays authorship information for a single post */
  redisplayPostAuthor(key: CubeKey | string) {
    const postData: PostData = this.displayedPosts.get(keyVariants(key).keyString);
    if (!postData) return;
    this.parseAuthor(postData);  // this (re-)sets data.author and data.authorkey
    this.contentAreaView.redisplayCubeAuthor(postData);
  }

  /** Redisplays authorship information for all of one author's posts */
  redisplayAuthor = async (mucInfo: CubeInfo) => {
    const muc = ensureCci(mucInfo.getCube({family: cciFamily}));
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
    const post = await makePost(text, { replyto: replyto, id: this.identity});
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


  //***
  // State management methods
  //***
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
      const { content, fileName } = await FileApplication.retrieveFile(Buffer.from(cubeKey, 'hex'), this.cubeRetriever);
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
  private shutdownComponents(): void {
    if (this.postGenerator) this.postGenerator.return(undefined);  // TODO resolve final Promise once implemented
    this.postGenerator = undefined;
    if (this.idStore && this.idStore !== this.identity?.identityStore) this.idStore.shutdown();
  }

  shutdown(unshow: boolean = true, callback: boolean = true): Promise<void> {
    this.shutdownComponents();
    return super.shutdown(unshow, callback);
  }

}
