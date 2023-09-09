import { Cube, CubeKey } from "../model/cube";
import { CubeMeta, CubeInfo } from "../model/cubeInfo";
import { CubeStore } from "../model/cubeStore";
import { logger } from "../model/logger";
import { AnnotationEngine } from "./annotationEngine";
import { Identity } from "./identity";
import { MediaTypes, ZwFieldLengths, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from "./zwFields";

import { Buffer } from 'buffer';

export class ZwAnnotationEngine extends AnnotationEngine {
  identityMucs: Map<string, CubeInfo> = new Map();

  constructor(cubeStore: CubeStore) {
    super(cubeStore, ZwFields.get);
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.rememberIdentityMucs(cube.key));
    this.reloadIdentityMucs();
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeDisplayable(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeMakesOthersDisplayable(cube.key));
  }

  /** Emits cubeDisplayable events if a Cube is, well... displayable */
  isCubeDisplayable(
      key: CubeKey, cubeInfo?: CubeInfo, cube?: Cube,
      mediaType: MediaTypes = MediaTypes.TEXT): boolean {
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
    if (!cube) cube = cubeInfo.getCube();

    // is this even a valid ZwCube?
    const fields: ZwFields = this.getFields(cube);
    if (!fields) return false;

    // does this have a ZwPayload field?
    const payload = fields.getFirstField(ZwFieldType.PAYLOAD);
    if (!payload) return false;

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
      if (!this.isCubeDisplayable(basePost.key, basePost)) return false;
    }
    // logger.trace("annotationEngine: Confiming cube " + key.toString('hex') + " is displayable.");
    return true;
  }

  /**
   * Finds the author of a post, i.e. the Identity object of a cube's author.
   */
  cubeAuthor(key: CubeKey): Identity {
    // check all MUCs
    for (const mucInfo of this.identityMucs.values()) {
      const muc = mucInfo.getCube();
      logger.trace("ZwAnnotationEngine: Searching for author of cube " + key.toString('hex') + " in MUC " + muc.getKeyIfAvailable()?.toString('hex'));
      if (!muc) {
        logger.error("ZwAnnotationEngine: A MUC we remembered has gone missing.");
        continue;
      }
      const potentialResult: Identity = this.cubeAuthorRecursion(key, muc, muc);
      if (potentialResult) {
        logger.trace("ZwAnnotationEngine: I found out that the author of cube " + key.toString('hex') + " is " + potentialResult.name);
        return potentialResult;
      }
    }
    logger.trace("ZwAnnotationEngine: Failed to find author for cube " + key.toString('hex'));
    return undefined;
  }

  /** This is the recursive part of cubeAuthor() */
  private cubeAuthorRecursion(key: CubeKey, mucOrMucExtension: Cube, rootmuc: Cube): Identity {
    const zwFields = ZwFields.get(mucOrMucExtension);
    if (!zwFields) return undefined;  // not a valid MUC or MUC extension cube
    const postrels: Array<ZwRelationship> = zwFields.getRelationships(ZwRelationshipType.MYPOST);
    if (!postrels) return undefined;  // not a valid MUC or MUC extension cube

    logger.trace("ZwAnnotationEngine: Searching for author of cube " + key.toString('hex') + " in subcube " + mucOrMucExtension.getKeyIfAvailable()?.toString('hex') + " extending MUC " + rootmuc.getKeyIfAvailable()?.toString('hex'));
    for (const postrel of postrels) {
      if (postrel.remoteKey.equals(key)) {  // bingo!
        let id: Identity = undefined;
        try {
          id = new Identity(this.cubeStore, rootmuc);
        } catch(error) {
          logger.info("ZwAnnotationEngine: While searching for author of " + key.toString('hex') + " I failed to create an Identity out of MUC " + rootmuc.getKeyIfAvailable()?.toString('hex') + " even though there's a MYPOST chain through " + mucOrMucExtension.getKeyIfAvailable()?.toString('hex'));
        }
        if (id) return id;
      } else {  // maybe this other post contains the authorship information we seek?
        const subpost = this.cubeStore.getCube(postrel.remoteKey);
        const potentialResult: Identity = this.cubeAuthorRecursion(key, subpost, rootmuc);
        if (potentialResult) return potentialResult;
      }
    }
    return undefined;  // no authorship information found, not even really deep down
  }

  private emitIfCubeDisplayable(
      key:  CubeKey, cubeInfo?: CubeInfo, cube?: Cube,
      mediaType: MediaTypes = MediaTypes.TEXT): boolean {
    const displayable: boolean = this.isCubeDisplayable(key, cubeInfo, cube, mediaType);
    if (displayable) this.emit('cubeDisplayable', key);
    return displayable;
  }

  // Emits cubeDisplayable events if this is the case
  private emitIfCubeMakesOthersDisplayable(
    key: CubeKey, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    let ret: boolean = false;
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
    if (!cube) cube = cubeInfo.getCube();

    // Am I the base post to a reply we already have?
    if (this.isCubeDisplayable(key, cubeInfo, cube)) {
      // In a base-reply relationship, I as a base can only make my reply
      // displayable if I am displayable myself.
      const replies: Array<ZwRelationship> = this.getReverseRelationships(
        cubeInfo.key,
        ZwRelationshipType.REPLY_TO);
      for (const reply of replies) {
        if (this.emitIfCubeDisplayable(reply.remoteKey)) {  // will emit a cubeDisplayable event for reply.remoteKey if so
          ret = true;
          this.emitIfCubeMakesOthersDisplayable(reply.remoteKey);
        }
      }
    }
    return ret;
  }

  private rememberIdentityMucs(key: CubeKey) {
    const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(key);
    let id: Identity;
    try {
      id = new Identity(this.cubeStore, cubeInfo.getCube());
    } catch (error) { return; }
    logger.trace("ZwAnnotationEngine: Remembering Identity MUC " + key.toString('hex'));
    this.identityMucs.set(cubeInfo.key.toString('hex'), cubeInfo);
  }

  private reloadIdentityMucs() {
    for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
      this.rememberIdentityMucs(cubeInfo.key);
    }
  }
}