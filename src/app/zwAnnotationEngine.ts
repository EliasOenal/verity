import { Cube, CubeKey } from "../core/cube";
import { CubeMeta, CubeInfo } from "../core/cubeInfo";
import { CubeStore } from "../core/cubeStore";
import { logger } from "../core/logger";
import { AnnotationEngine } from "../core/annotationEngine";
import { Identity } from "./identity";
import { MediaTypes, ZwFieldLengths, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipLimits, ZwRelationshipType } from "./zwFields";

import { Buffer } from 'buffer';
import { CubeType } from "../core/cubeDefinitions";

export class ZwAnnotationEngine extends AnnotationEngine {
  identityMucs: Map<string, CubeInfo> = new Map();
  authorsCubes: Map<string, Set<string>> = new Map();
  readonly autoLearnMucs: boolean;

  constructor(
      cubeStore: CubeStore,
      learnMucs: CubeKey[] | boolean = true,
      private handleAnonymousCubes: boolean = true,
      limitRelationshipTypes: Map<number, number> = ZwRelationshipLimits,
    ) {
    super(cubeStore, ZwFields.get, ZwRelationship, limitRelationshipTypes);
    if (learnMucs instanceof Array) {
      this.autoLearnMucs = false;
      for (const key of learnMucs) this.learnMuc(key);
    } else if (learnMucs === true) {
      this.autoLearnMucs = true;
      this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.learnMuc(cubeInfo));
    } else {
      this.autoLearnMucs = false;
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
      mediaType: MediaTypes = MediaTypes.TEXT,
      allowAnonymous = this.handleAnonymousCubes): boolean {
    if (!(cubeInfo instanceof CubeInfo)) cubeInfo = this.cubeStore.getCubeInfo(cubeInfo) as CubeInfo;

    if (!allowAnonymous) {
      // Is this owned by one if the authors in this.identityMucs?
      if (!this.isAuthorKnown(cubeInfo.key)) return false;
    }

    // is this even a valid ZwCube?
    const fields: ZwFields = this.getFields(cubeInfo.getCube());
    if (!fields) return false;

    // does this have a ZwPayload field and does it contain something??
    const payload = fields.getFirstField(ZwFieldType.PAYLOAD);
    if (!payload || !payload.length) return false;

    // does it have the correct media type?
    const typefield = fields.getFirstField(ZwFieldType.MEDIA_TYPE);
    if (!typefield) return;
    if (mediaType && mediaType != typefield.value.readUIntBE(0, ZwFieldLengths[ZwFieldType.MEDIA_TYPE])) {
      return false;
    }

    // TODO: handle continuation chains
    // TODO: parametrize and handle additional relationship types on request

    // are we a reply?
    // if we are, we can only be displayed if we have the original post,
    // and the original post is displayable too
    const reply_to: ZwRelationship =
      fields.getFirstRelationship(ZwRelationshipType.REPLY_TO);
    if (reply_to) {
      // logger.trace("annotationEngine: Checking for displayability of a reply")
      const basePost: CubeInfo = this.cubeStore.getCubeInfo(reply_to.remoteKey);
      if (!basePost) return false;
      if (!this.isCubeDisplayable(basePost, mediaType)) return false;
    }
    // logger.trace("annotationEngine: Confiming cube " + key.toString('hex') + " is displayable.");
    return true;
  }

  isAuthorKnown(key: CubeKey): boolean {
    // TODO: maybe following the ownership chain of this cube up to the author
    // is actually faster than checking all know posts
    for (const knownSet of this.authorsCubes.values()) {
      if(knownSet.has(key.toString('hex'))) return true;
    }
    return false;
  }

  /**
   * Finds the author of a post, i.e. the Identity object of a cube's author.
   * It does that by leveraging the stored reverse-MYPOST relationships created
   * by this engine.
   */
  cubeAuthor(key: CubeKey): Identity {
    const parentrel = this.getFirstReverseRelationship(key, ZwRelationshipType.MYPOST);
    // logger.trace(`ZwAnnotationEngine: Looking for the author of ${key.toString('hex')} whose parent is ${parentrel?.remoteKey?.toString('hex')}`);
    if (!parentrel) return undefined;
    const parentkey = parentrel.remoteKey;
    if (this.identityMucs.has(parentkey.toString('hex'))) {
      const idmuc = this.cubeStore.getCube(parentkey);
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
      const muc = mucInfo.getCube();
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
  private cubeAuthorWithoutAnnotationsRecursion(key: CubeKey, mucOrMucExtension: Cube, rootmuc: Cube): Identity {
    const zwFields = ZwFields.get(mucOrMucExtension);
    if (!zwFields) return undefined;  // not a valid MUC or MUC extension cube
    const postrels: Array<ZwRelationship> = zwFields.getRelationships(ZwRelationshipType.MYPOST);
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
      const replies: Array<ZwRelationship> = this.getReverseRelationships(
        cubeInfo.key,
        ZwRelationshipType.REPLY_TO);
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
  private learnMuc(input: CubeInfo | CubeKey): void {
    let mucInfo: CubeInfo;
    if (input instanceof CubeInfo) mucInfo = input;
    else mucInfo = this.cubeStore.getCubeInfo(input);
    // is this even a MUC?
    if (mucInfo.cubeType != CubeType.CUBE_TYPE_MUC) return;

    // Check if this is an Identity MUC by trying to create an Identity object
    // for it.
    // I'm not sure if that's efficient.
    let id: Identity;
    try {
      id = new Identity(this.cubeStore, mucInfo.getCube());
    } catch (error) { return; }
    // logger.trace("ZwAnnotationEngine: Remembering Identity MUC " + key.toString('hex'));
    this.identityMucs.set(mucInfo.key.toString('hex'), mucInfo);
    // logger.trace(`ZwAnnotationEngine: Learned Identity MUC ${key.toString('hex')}, user name ${id.name}`);
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
    if (mucInfo.cubeType != CubeType.CUBE_TYPE_MUC) return;
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
  }

  /** Recursive part of learnAuthorsPosts */
  private learnAuthorsPostsRecursion(mucInfo: CubeInfo, postInfo: CubeInfo): void {
    const muckeystring: string = mucInfo.key.toString('hex');
    // If we either don't have this cube or know it already, do nothing...
    // except if it's a MUC, then it could have changed
    if (postInfo?.cubeType != CubeType.CUBE_TYPE_MUC && this.authorsCubes.has(muckeystring)) {
      return;
    }
    // otherwise, process all MYPOST references
    const fields: ZwFields = this.getFields(postInfo.getCube());
    if (!fields) return;
    const postRefs: ZwRelationship[] = fields.getRelationships(ZwRelationshipType.MYPOST);
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
          this.learnAuthorsPostsRecursion(mucInfo, postInfo);
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