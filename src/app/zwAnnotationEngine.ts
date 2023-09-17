import { Cube, CubeKey } from "../core/cube";
import { CubeMeta, CubeInfo } from "../core/cubeInfo";
import { CubeStore } from "../core/cubeStore";
import { logger } from "../core/logger";
import { AnnotationEngine } from "../core/annotationEngine";
import { Identity } from "./identity";
import { MediaTypes, ZwFieldLengths, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from "./zwFields";

import { Buffer } from 'buffer';
import { CubeType } from "../core/cubeDefinitions";

export class ZwAnnotationEngine extends AnnotationEngine {
  identityMucs: Map<string, CubeInfo> = new Map();
  authorsPosts: Map<string, Set<string>> = new Map();

  constructor(
      cubeStore: CubeStore,
      private autoLearnMucs = true) {
    super(cubeStore, ZwFields.get, ZwRelationship);
    this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.emitIfCubeDisplayable(cubeInfo));
    this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.emitIfCubeMakesOthersDisplayable(cubeInfo));
    if (autoLearnMucs) {
      this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.learnMuc(cubeInfo));
    }
    this.crawlCubeStore();
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
   * 4) Must be owned by a MUC we're interested in (TODO implement)
   * @param [mediaType] Only mark cubes displayable if they are of this media type.
   */
  isCubeDisplayable(
      cubeInfo: CubeInfo | CubeKey,
      mediaType: MediaTypes = MediaTypes.TEXT): boolean {
    if (!(cubeInfo instanceof CubeInfo)) cubeInfo = this.cubeStore.getCubeInfo(cubeInfo);

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
    // TODO: as discussed, this whole decision process (and the related attributes
    // in CubeDataset) should at some point not be applies to all cubes,
    // just to interesting ones that are actually to be displayed.

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
    if (!(cubeInfo instanceof CubeInfo)) cubeInfo = this.cubeStore.getCubeInfo(cubeInfo);
    const displayable: boolean = this.isCubeDisplayable(cubeInfo, mediaType);
    if (displayable) {
      // logger.trace(`ZwAnnotationEngine: Marking cube ${key.toString('hex')} displayable.`)
      this.emit('cubeDisplayable', cubeInfo.key);  // TODO: why not just emit the cubeInfo?
    }
    return displayable;
  }

  // Emits cubeDisplayable events if this is the case
  private emitIfCubeMakesOthersDisplayable(
      cubeInfo: CubeInfo | CubeKey,
      mediaType: MediaTypes = MediaTypes.TEXT): boolean {
    if (!(cubeInfo instanceof CubeInfo)) cubeInfo = this.cubeStore.getCubeInfo(cubeInfo);
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
  private learnMuc(mucInfo: CubeInfo): void {
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

  protected crawlCubeStore(): void {
    super.crawlCubeStore();
    if (this.autoLearnMucs) {
      for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
        this.learnMuc(cubeInfo);
      }
    }
    for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
      this.emitIfCubeDisplayable(cubeInfo.key);
      this.emitIfCubeMakesOthersDisplayable(cubeInfo.key);
    }
  }
}