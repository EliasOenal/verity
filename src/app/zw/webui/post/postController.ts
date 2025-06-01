import { CubeKey } from "../../../../core/cube/cube.definitions";
import { Cube } from "../../../../core/cube/cube";
import { keyVariants } from "../../../../core/cube/cubeUtil";
import { logger } from "../../../../core/logger";

import { FieldType } from "../../../../cci/cube/cciCube.definitions";
import { cciCube } from "../../../../cci/cube/cciCube";
import { RelationshipType } from "../../../../cci/cube/relationship";
import { RecursiveRelResolvingGetPostsGenerator, PostInfo, RecursiveRelResolvingPostInfo } from "../../../../cci/identity/identity.definitions";
import { Identity } from "../../../../cci/identity/identity";
import { IdentityStore } from "../../../../cci/identity/identityStore";
import { ResolveRelsRecursiveResult } from "../../../../cci/veritum/veritumRetrievalUtil";

import { explorePostGenerator, isPostDisplayable, makePost, wotPostGenerator } from "../../model/zwUtil";

import { ControllerContext, VerityController } from "../../../../webui/verityController";
import { PostView } from "./postView";

import { FileApplication } from '../../../fileApplication';

import { Buffer } from 'buffer';
import DOMPurify from 'dompurify';

export interface PostData extends RecursiveRelResolvingPostInfo<Cube> {
  displayname?: string;
  authorsubscribed?: boolean | "self" | "none";
  text?: string;

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
  private postGenerator: RecursiveRelResolvingGetPostsGenerator<Cube>;

  // TODO remove this, use IdentityController's store instead
  private idStore: IdentityStore;

  constructor(
      parent: ControllerContext,
  ){
    super(parent);
    this.contentAreaView = new PostView(this);

    this.idStore = this.identity?.identityStore ?? new IdentityStore(this.node.cubeRetriever);
  }

  //***
  // Navigation methods
  //***

  async navSubscribed(subscriptionDepth: number = 1): Promise<void> {
    logger.trace("PostController: Displaying posts by subscriptions");
    this.shutdownComponents();
    this.contentAreaView.clearAlerts();

    if (!this.identity) {  // must be logged in
      this.contentAreaView.makeAlert("Please log in to follow your subscribed authors");
      return;
    }

    this.postGenerator = wotPostGenerator(this.identity, subscriptionDepth);
    return this.redisplayPosts(this.postGenerator.existingYielded);
  }

  navWot(): Promise<void> {
    return this.navSubscribed(5);
  }

  async navExplore(): Promise<void> {
    logger.trace("PostController: Displaying posts by notifications");
    this.shutdownComponents();

    this.postGenerator = explorePostGenerator(this.node.cubeRetriever, this.idStore);

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
    // All done; just define a sensible return state:
    // We'll consider ourselves done, once all displayals started while the done
    // promise was pending have been completed.
    // This is completely irrelevant in production, but used for testing.
    return donePromise.then(() => {
      const promises = displayPromises;
      displayPromises = undefined;
      return Promise.all(promises).then();
    });
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
  private async displayPost(postInfo: PostData): Promise<void> {
    // is this post already displayed?
    const previouslyShown: PostData =
      this.displayedPosts.get(postInfo.main.getKeyStringIfAvailable());
    if (previouslyShown) {
      // Handle edge case: We may just have learned the authorship information
      // of a post previously displayed as by an unknown author.
      if (previouslyShown.author === undefined) {
        this.redisplayAuthor(postInfo.author.keyString);
      }
      return;
    }

    // normalise input:
    // setting cube:
    const cube: cciCube = postInfo.main as cciCube;

    // sanity checks
    if (!(await isPostDisplayable(postInfo))) {
      logger.trace(`PostController.displayPost(): Ignoring a non-displayable Cube`);
      return;
    }

    // gather PostData
    postInfo.text = cube.getFirstField(FieldType.PAYLOAD).value.toString();
    postInfo.text = DOMPurify.sanitize(postInfo.text, {
      ALLOWED_TAGS: ['b', 'i', 'u', 's', 'em', 'strong', 'mark', 'sub', 'sup', 'p', 'br', 'ul', 'ol', 'li'],
      ALLOWED_ATTR: []
    });
    postInfo.text = await this.processImageTags(postInfo.text);
    // Author known?
    this.parseAuthor(postInfo);

    // is this a reply?
    const superiorPostPromise: Promise<PostInfo<Cube> & ResolveRelsRecursiveResult<Cube>> =
      postInfo[RelationshipType.REPLY_TO]?.[0] as Promise<PostInfo<Cube> & ResolveRelsRecursiveResult<Cube>>;
    if (superiorPostPromise !== undefined) {  // yes
      const superiorPost: PostInfo<Cube> & ResolveRelsRecursiveResult<Cube> = await superiorPostPromise;
      const superiorPostKey: CubeKey = await superiorPost.main.getKey();
      postInfo.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
      if (!postInfo.superior) {
        // Apparently the original post has not yet been displayed, so let's display it
        await this.displayPost(superiorPost);
        postInfo.superior = this.displayedPosts.get(superiorPostKey.toString('hex'));
        if (!postInfo.superior || !postInfo.superior.displayElement) {  // STILL not displayed?!?!
          logger.debug(`PostController: Failed to display post ${superiorPostKey.toString('hex')} because the superior post cannot be displayed.`);
          return;
        }
      }
    }

    // we've awaited stuff, so let's check again: is this post already displayed?
    if (this.displayedPosts.has(postInfo.main.getKeyStringIfAvailable())) return;

    this.contentAreaView.displayPost(postInfo);  // have the view display the post
    this.displayedPosts.set(postInfo.main.getKeyStringIfAvailable(), postInfo);  // remember the displayed post
  }

  private parseAuthor(data: PostData): void {
    // Is the author known?
    if (data.author) {
      // Limit author username length
      data.displayname = data.author.name;
      if (data.displayname.length > 60) {
        data.displayname = data.displayname.slice(0, 57) + "...";
      }

      // is this author subscribed?
      if (this.identity) {
        data.authorsubscribed = this.identity.hasPublicSubscription(data.author.key);
        // or is this even my own post?
        if (data.author.key.equals(this.identity.publicKey)) data.authorsubscribed = "self";
      } else {
        data.authorsubscribed = "none";  // no Identity, no subscriptions
      }
    } else {
      // Author not known
      data.displayname = "Unknown user";
    }
  }

  /** Redisplays authorship information for all of one author's posts */
  async redisplayAuthor(idKey: string): Promise<void> {
    const id: Identity = await this.idStore.retrieveIdentity(idKey);
    if (id === undefined) {
      logger.trace(`PostController.redisplayAuthor: Failed to retrieve Identity ${idKey}`);
      return;
    }

    for (const postKey of id.getPostKeyStrings()) {
      const postData: PostData = this.displayedPosts.get(keyVariants(postKey).keyString);
      if (!postData) return;

      if (postData.author === undefined) {
        postData.author = id;
        this.parseAuthor(postData);  // this (re-)sets the displayname, profilepic and authorsubscribed properties
        this.contentAreaView.redisplayCubeAuthor(postData);
      }
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
    this.node.cubeStore.addCube(post);
  }

  /**
   * Toggle public subscription to an author (i.e., either subscribe or
   * unsubscribe them).
   * @param subscribeButton - The subscribe (or unsubscribe) button
   * @returns A Promise which will resolve when all operations have terminated,
   *   i.e. the user's Identity update has been published and the UI has been
   *   updated. This is only useful for testing.
   */
  subscribeUser(subscribeButton: HTMLButtonElement): Promise<void> {
    // fetch input data
    const authorkeystring = subscribeButton.getAttribute("data-authorkey");
    // keep track of async progress (for testing only)
    const donePromises: Promise<void>[] = [];

    // subscribing or unsubscribing?
    if (subscribeButton.classList.contains("active")) {
      logger.trace("VerityUI: Unsubscribing from " + authorkeystring);
      this.identity.removePublicSubscription(authorkeystring);
      subscribeButton.classList.remove("active");
      donePromises.push(this.identity.store().then());
    } else {
      logger.trace("VerityUI: Subscribing to " + authorkeystring);
      this.identity.addPublicSubscription(authorkeystring);
      subscribeButton.classList.add("active");
      donePromises.push(this.identity.store().then());
    }
    donePromises.push(this.redisplayAuthor(authorkeystring));
    return Promise.all(donePromises).then();
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
