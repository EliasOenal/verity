import { CubeKey, CubeType } from "../core/cube/cubeDefinitions";
import { Cube } from "../core/cube/cube";
import { CubeInfo } from "../core/cube/cubeInfo";
import { CubeStore } from "../core/cube/cubeStore";
import { logger } from "../core/logger";
import { AnnotationEngine, defaultGetFieldsFunc } from "../cci/annotationEngine";
import { Identity } from "../cci/identity";
import { MediaTypes, cciFieldLength, cciFieldType, cciFields, cciRelationship, cciRelationshipLimits, cciRelationshipType } from "../cci/cciFields";

import { assertZwCube, assertZwMuc } from "./zwCubes";
import { cciCube } from "../cci/cciCube";

// TODO: Split post selection and associated criteria out of here, moving it to
// a new class ContentSelector. Instead of purely binary criteria, assign them
// scores to heuristically determine the best posts to show based on multiple
// factors.

export enum SubscriptionRequirement {
  none = 0,
  subscribedInTree = 2,
  subscribedReply = 3,
  subscribedOnly = 4,
}

export class ZwAnnotationEngine extends AnnotationEngine {
  identityMucs: Map<string, CubeInfo> = new Map();
  subscribedMucs: Map<string, CubeInfo> = new Map();
  authorsCubes: Map<string, Set<string>> = new Map();

  constructor(
      cubeStore: CubeStore,
      private subscriptionRequirement: SubscriptionRequirement = SubscriptionRequirement.none,
      subscribedMucs: CubeKey[] = undefined,
      private autoLearnMucs: boolean = true,
      private allowAnonymous: boolean = false,
      limitRelationshipTypes: Map<number, number> = cciRelationshipLimits,
    ) {
    super(cubeStore, defaultGetFieldsFunc, cciRelationship, limitRelationshipTypes);
    if (subscribedMucs) {
      for (const key of subscribedMucs) this.trustMuc(key);
    }
    if (autoLearnMucs === true) {
      this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.learnMuc(cubeInfo));
    }
    this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.learnAuthorsPosts(cubeInfo));
    this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.emitIfCubeDisplayable(cubeInfo));
    this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.emitIfCubeMakesOthersDisplayable(cubeInfo));
    this.crawlCubeStoreZw();
  }

  /**
   * Emits cubeDisplayable events if a Cube is, well... displayable.
   * Displayability depends on a number of criteria, all of which must be
   * fulfilled:
   * 1) Cube must contain a valid Zw structure, contain a "ZW" APPLICATION field,
   *    a MEDIA_TYPE field with the correct value.
   * 2) Have a PAYLOAD field that is not empty
   * 3) If it is a reply (= contains a RELATES_TO/REPLY_TO field) the referred
   *    post must already be displayable.
   * 4) Must be owned by a MUC we're interested in (unless allowAnonymous is set)
   * @param [mediaType] Only mark cubes displayable if they are of this media type.
   * @param [allowAnonymous] Unless set, only cubes which are owned by one of
   *                         authors in this.identityMucs are considered displayable.
   */
  isCubeDisplayable(
      cubeInfo: CubeInfo | CubeKey,
      mediaType: MediaTypes = MediaTypes.TEXT): boolean {
    if (!(cubeInfo instanceof CubeInfo)) cubeInfo = this.cubeStore.getCubeInfo(cubeInfo) as CubeInfo;

    // is this even a valid ZwCube?
    if (!assertZwCube) return false;
    const fields: cciFields = this.getFields(cubeInfo.getCube()) as cciFields;

    // does this have a ZwPayload field and does it contain something??
    const payload = fields.getFirst(cciFieldType.PAYLOAD);
    if (!payload || !payload.length) return false;

    // does it have the correct media type?
    const typefield = fields.getFirst(cciFieldType.MEDIA_TYPE);
    if (!typefield) return;
    if (mediaType && mediaType != typefield.value.readUIntBE(0, cciFieldLength[cciFieldType.MEDIA_TYPE])) {
      return false;
    }

    // Reject anonymous posts unless explicitly allowed
    if (!this.allowAnonymous && !this.isAuthorKnown(cubeInfo.key, false)) {
      return false;
    }
    // Reject posts by non-subscribed authors (unless laxer requirements specified)
    if (this.subscriptionRequirement >= SubscriptionRequirement.subscribedOnly &&
        !this.isAuthorKnown(cubeInfo.key, true)) {
      return false;
    }
    // Reject thread withut subscribed author participation (unless laxer requirements specified)
    if (this.subscriptionRequirement >= SubscriptionRequirement.subscribedInTree &&
        !this.isAuthorKnown(cubeInfo.key, true) &&
        !this.recursiveSubscribedAuthorInThread(cubeInfo.key)) {
      return false;
    }

    // TODO: handle continuation chains
    // TODO: parametrize and handle additional relationship types on request

    // are we a reply?
    // if we are, we can only be displayed if we have the original post,
    // and the original post is displayable too
    const reply_to: cciRelationship =
      fields.getFirstRelationship(cciRelationshipType.REPLY_TO);
    if (reply_to) {
      // logger.trace("annotationEngine: Checking for displayability of a reply")
      const basePost: CubeInfo = this.cubeStore.getCubeInfo(reply_to.remoteKey);
      if (!basePost) return false;
      if (!this.isCubeDisplayable(basePost, mediaType)) return false;
    }
    // logger.trace("annotationEngine: Confiming cube " + key.toString('hex') + " is displayable.");
    return true;
  }

  isAuthorKnown(key: CubeKey, mustBeSubscribed: boolean): boolean {
    // TODO: maybe following the ownership chain of this cube up to the author
    // is actually faster than checking all know posts
    for (const [authorkeystring, knownSet] of this.authorsCubes.entries()) {
      if(knownSet.has(key.toString('hex'))) {
        // Author is known! Depending on the specified authorship requirements,
        // this might already be enough or they might be subscribed as well.
        if (mustBeSubscribed) {
          if (this.subscribedMucs.has(authorkeystring)) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

  recursiveSubscribedAuthorInThread(key: CubeKey, alreadyTraversed: string[] = []): boolean {
    // prevent endless recursion
    if (alreadyTraversed.includes(key.toString('hex'))) return false;
    alreadyTraversed.push(key.toString('hex'));

    // check down the tree to find posts a subscribed author has replied to
    let toCheck: cciRelationship[];
    toCheck =
      this.getReverseRelationships(key, cciRelationshipType.REPLY_TO);
    // if specified authorship requirements are lax enough, also check
    // up the tree to find replies to a subscribed author's posts
    if (this.subscriptionRequirement <= SubscriptionRequirement.subscribedInTree) {
      const cube: Cube = this.cubeStore.getCube(key);
      if (!assertZwCube(cube)) return false;
      const fields: cciFields = cube.fields as cciFields;
      const replies: cciRelationship[] = fields.
        getRelationships(cciRelationshipType.REPLY_TO);
      if (replies) toCheck = toCheck.concat(replies);
    }
    for (const other of toCheck) {
      if (this.isAuthorKnown(other.remoteKey, true)) return true;
      if (this.recursiveSubscribedAuthorInThread(other.remoteKey, alreadyTraversed)) return true;
    }
    return false;
  }

  /**
   * Finds the author of a post, i.e. the Identity object of a cube's author.
   * It does that by leveraging the stored reverse-MYPOST relationships created
   * by this engine.
   */
  cubeAuthor(key: CubeKey): Identity {
    const parentrel = this.getFirstReverseRelationship(key, cciRelationshipType.MYPOST);
    // logger.trace(`ZwAnnotationEngine: Looking for the author of ${key.toString('hex')} whose parent is ${parentrel?.remoteKey?.toString('hex')}`);
    if (!parentrel) return undefined;
    const parentkey = parentrel.remoteKey;
    if (this.identityMucs.has(parentkey.toString('hex'))) {
      const idmuc = this.cubeStore.getCube(parentkey) as cciCube;  // TODO cciCube or document why not necessary
      if (!idmuc) return undefined;
      let id: Identity = undefined;
      try {
        id = new Identity(this.cubeStore, idmuc, undefined, false);
      } catch(error) {
        // logger.info("ZwAnnotationEngine: While searching for author of " + key.toString('hex') + " I failed to create an Identity out of MUC " + rootmuc.getKeyIfAvailable()?.toString('hex') + " even though there's a MYPOST chain through " + mucOrMucExtension.getKeyIfAvailable()?.toString('hex'));
      }
      if (id) return id;
      else return undefined;
    } else {
      return this.cubeAuthor(parentkey);
    }

  }

  /**
   * Unused, use cubeAuthor instead.
   * Finds the author of a post, i.e. the Identity object of a cube's author.
   * It does that by checking ALL MUCs and ALL their owned posts to find an
   * ownership association to the given post.
   * This is HORRIBLY inefficient and is only needed when displaying random
   * cubes whether or not they are associated with any MUC, which we probably
   * should not do anyway.
   * So TODO remove I guess?
   */
  cubeAuthorWithoutAnnotations(key: CubeKey): Identity {
    // check all MUCs
    for (const mucInfo of this.identityMucs.values()) {
      const muc = mucInfo.getCube() as cciCube;  // TODO subclass CubeInfo
      // logger.trace("ZwAnnotationEngine: Searching for author of cube " + key.toString('hex') + " in MUC " + muc.getKeyIfAvailable()?.toString('hex'));
      if (!muc) {
        logger.error("ZwAnnotationEngine: A MUC we remembered has gone missing.");
        continue;
      }
      const potentialResult: Identity = this.cubeAuthorWithoutAnnotationsRecursion(key, muc, muc);
      if (potentialResult) {
        // logger.trace("ZwAnnotationEngine: I found out that the author of cube " + key.toString('hex') + " is " + potentialResult.name);
        return potentialResult;
      }
    }
    // logger.trace("ZwAnnotationEngine: Failed to find author for cube " + key.toString('hex'));
    return undefined;
  }

  /** This is the recursive part of cubeAuthor() */
  private cubeAuthorWithoutAnnotationsRecursion(key: CubeKey, mucOrMucExtension: Cube, rootmuc: cciCube): Identity {
    if (!assertZwCube(mucOrMucExtension)) return undefined;
    const fields: cciFields = mucOrMucExtension.fields as cciFields;
    const postrels: Array<cciRelationship> = fields.getRelationships(cciRelationshipType.MYPOST);
    if (!postrels) return undefined;  // not a valid MUC or MUC extension cube

    // logger.trace("ZwAnnotationEngine: Searching for author of cube " + key.toString('hex') + " in subcube " + mucOrMucExtension.getKeyIfAvailable()?.toString('hex') + " extending MUC " + rootmuc.getKeyIfAvailable()?.toString('hex'));
    for (const postrel of postrels) {
      if (postrel.remoteKey.equals(key)) {  // bingo!
        let id: Identity = undefined;
        try {
          id = new Identity(this.cubeStore, rootmuc);
        } catch(error) {
          // logger.info("ZwAnnotationEngine: While searching for author of " + key.toString('hex') + " I failed to create an Identity out of MUC " + rootmuc.getKeyIfAvailable()?.toString('hex') + " even though there's a MYPOST chain through " + mucOrMucExtension.getKeyIfAvailable()?.toString('hex'));
        }
        if (id) return id;
      } else {  // maybe this other post contains the authorship information we seek?
        const subpost = this.cubeStore.getCube(postrel.remoteKey);
        const potentialResult: Identity = this.cubeAuthorWithoutAnnotationsRecursion(key, subpost, rootmuc);
        if (potentialResult) return potentialResult;
      }
    }
    return undefined;  // no authorship information found, not even really deep down
  }

  private emitIfCubeDisplayable(
      cubeInfo: CubeInfo | CubeKey,
      mediaType: MediaTypes = MediaTypes.TEXT): boolean {
    if (!(cubeInfo instanceof CubeInfo)) cubeInfo = this.cubeStore.getCubeInfo(cubeInfo) as CubeInfo;
    const displayable: boolean = this.isCubeDisplayable(cubeInfo, mediaType);
    if (displayable) {
      // logger.trace(`ZwAnnotationEngine: Marking cube ${key.toString('hex')} displayable.`)
      this.emit('cubeDisplayable', cubeInfo.key);  // TODO: why not just emit the cubeInfo?
    }
    return displayable;
  }

  // Emits cubeDisplayable events if this is the case
  // Note: In case anonymous posts are disallowed, learning authorship
  // information will make a post displayable. This case is not handled here but
  // in learnAuthorsPosts()
  private emitIfCubeMakesOthersDisplayable(
      cubeInfo: CubeInfo | CubeKey,
      mediaType: MediaTypes = MediaTypes.TEXT): boolean {
    if (!(cubeInfo instanceof CubeInfo)) cubeInfo = this.cubeStore.getCubeInfo(cubeInfo) as CubeInfo;
    let ret: boolean = false;

    // Am I the base post to a reply we already have?
    if (this.isCubeDisplayable(cubeInfo, mediaType)) {
      // In a base-reply relationship, I as a base can only make my reply
      // displayable if I am displayable myself.
      const replies: Array<cciRelationship> = this.getReverseRelationships(
        cubeInfo.key,
        cciRelationshipType.REPLY_TO);
      for (const reply of replies) {
        if (this.emitIfCubeDisplayable(reply.remoteKey, mediaType)) {  // will emit a cubeDisplayable event for reply.remoteKey if so
          ret = true;
          this.emitIfCubeMakesOthersDisplayable(reply.remoteKey, mediaType);
        }
      }
    }
    return ret;
  }

  /**
   * Add this MUC to the list of known MUCs. Annotations and events
   * will be created for these known MUCs and their owned cubes.
   * @param key Must be the key of a valid Identity MUC
   */
  // TODO move to CCI
  private learnMuc(input: CubeInfo | CubeKey): void {
    let mucInfo: CubeInfo;
    if (input instanceof CubeInfo) mucInfo = input;
    else mucInfo = this.cubeStore.getCubeInfo(input);
    if (this.validateMuc(mucInfo)) {
      this.identityMucs.set(mucInfo.key.toString('hex'), mucInfo);
      // logger.trace(`ZwAnnotationEngine: Learned Identity MUC ${key.toString('hex')}, user name ${id.name}`);
    }
  }

  /**
   * Add this MUC to the list of subscribed MUCs.
   * This is only relevant for determining displayability, and only when using
   * certain settings.
   * If the MUC is not yet known, it will also be marked known.
   * @param key Must be the key of a valid Identity MUC
   */
  private trustMuc(input: CubeInfo | CubeKey): void {
    let mucInfo: CubeInfo;
    if (input instanceof CubeInfo) mucInfo = input;
    else mucInfo = this.cubeStore.getCubeInfo(input);
    // TODO: We could probably skip this very inefficient check for subscribed MUCs.
    if (this.validateMuc(mucInfo)) {
      this.identityMucs.set(mucInfo.key.toString('hex'), mucInfo);
      this.subscribedMucs.set(mucInfo.key.toString('hex'), mucInfo);
      // logger.trace(`ZwAnnotationEngine: Trusting Identity MUC ${key.toString('hex')}, user name ${id.name}`);
    }
  }

  // TODO move to CCI
  private validateMuc(mucInfo: CubeInfo): boolean {
    // is this even a MUC?
    if (mucInfo.cubeType != CubeType.MUC) return false;

    // Check if this is an Identity MUC by trying to create an Identity object
    // for it.
    // I'm not sure if that's efficient.
    let id: Identity;
    try {
      id = new Identity(this.cubeStore, mucInfo.getCube() as cciCube);  // TODO: subclass CubeInfo
    } catch (error) { return false; }
    return true;  // all checks passed
  }

  /**
   * Takes a MUC CubeInfo representing an Identity, the author.
   * Will learn all posts by the author as represented by direct or indirect
   * MYPOST relations.
   * @emits "authorLearned" with a post CubeInfo if we just learned who the
   *        author of that post is.
   */
  private learnAuthorsPosts(mucInfo: CubeInfo): void {
    // Is this even a MUC? Otherwise, it's definitely not a valid Identity.
    if (mucInfo.cubeType != CubeType.MUC) return;
    // are we even interested in this author?
    const muckeystring: string = mucInfo.key.toString('hex');
    if (!this.identityMucs.has(muckeystring)) return;

    // if this is the first time we learn of this author, initialize their cube set
    let cubeSet: Set<string>;
    if (!this.authorsCubes.has(muckeystring)) {
      cubeSet = new Set();
      this.authorsCubes.set(muckeystring, cubeSet);
    } else {
      cubeSet = this.authorsCubes.get(muckeystring);
    }

    // traverse cube and unknown subcubes
    this.learnAuthorsPostsRecursion(mucInfo, mucInfo);

    // Let our listeners know we've just processed a new or updated MUC.
    // For example, PostView may use this to update the displayed authorship information.
    this.emit("authorUpdated", mucInfo);  }

  /** Recursive part of learnAuthorsPosts */
  private learnAuthorsPostsRecursion(mucInfo: CubeInfo, postInfo: CubeInfo, alreadyTraversed: Set<string> = new Set()): void {
    const muckeystring: string = mucInfo.key.toString('hex');
    if (alreadyTraversed.has(muckeystring)) return;  // prevent endless recursion
    // If we either don't have this cube or know it already, do nothing...
    // except if it's a MUC, then it could have changed
    if (postInfo?.cubeType != CubeType.MUC && this.authorsCubes.has(muckeystring)) {
      return;
    }
    // Otherwise, process all MYPOST references.
    // Mark this cube as already traversed to prevent endless recursion in case of
    // maliciously crafted circular references.
    alreadyTraversed.add(muckeystring);
    const cube: Cube = postInfo.getCube();
    if (!assertZwCube(cube)) return;
    const fields: cciFields = this.getFields(postInfo.getCube()) as cciFields;
    const postRefs: cciRelationship[] = fields.getRelationships(cciRelationshipType.MYPOST);
    for (const postRef of postRefs) {
      const postkeystring: string = postRef.remoteKey.toString('hex');
      // If we don't know the referred post already, learn it and
      // traverse it for further MYPOST references.
      if (!this.authorsCubes.get(muckeystring).has(postkeystring)) {
        this.authorsCubes.get(muckeystring).add(postkeystring);
        const postInfo: CubeInfo = this.cubeStore.getCubeInfo(postRef.remoteKey);
        // We learned the authorship -- but but have we actually received this post yet?
        // (It's about a 50/50 chance we see the post or the authorship reference first.)
        // Only if we actually have this post, emit an event, check for displayability
        // and continue traversing the post:
        if (postInfo) {
          this.emit('authorLearned', postInfo);
          this.emitIfCubeDisplayable(postInfo);
          this.learnAuthorsPostsRecursion(mucInfo, postInfo, alreadyTraversed);
        }
      }
    }
  }

  crawlCubeStoreZw(): void {
    if (this.autoLearnMucs) {
      for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
        this.learnMuc(cubeInfo);
      }
    }
    for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
      this.learnAuthorsPosts(cubeInfo);
      this.emitIfCubeDisplayable(cubeInfo);
      this.emitIfCubeMakesOthersDisplayable(cubeInfo);
    }
  }
}