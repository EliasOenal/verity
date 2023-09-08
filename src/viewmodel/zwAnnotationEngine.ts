import { Cube, CubeKey } from "../model/cube";
import { CubeMeta, CubeInfo } from "../model/cubeInfo";
import { CubeStore } from "../model/cubeStore";
import { AnnotationEngine } from "./annotationEngine";
import { Identity } from "./identity";
import { MediaTypes, ZwFieldLengths, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from "./zwFields";

import { Buffer } from 'buffer';

export class ZwAnnotationEngine extends AnnotationEngine {
  identityMucs: Map<string, CubeInfo> = new Map();

  constructor(cubeStore: CubeStore) {
    super(cubeStore, ZwFields.get);
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.rememberIdentityMucs(cube.key));
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

  // TODO test this
  // TODO recurse through the linked list of owned posts
  cubeAuthor(key: CubeKey): Identity {
    // check all MUCs
    for (const mucInfo of this.identityMucs.values()) {
      const postrels: Array<ZwRelationship> = ZwFields.get(mucInfo.getCube())?.
        getRelationships(ZwRelationshipType.MYPOST);
      if (!postrels) continue;  // not a valid MUC
      for (const postrel of postrels) {
        if (postrel.remoteKey.equals(key)) {
          const id: Identity = new Identity(mucInfo.getCube());
          return id;
        }
      }
    }
    return undefined;
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

  // TODO write test
  private async rememberIdentityMucs(key: CubeKey) {
    const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(key);
    let id: Identity;
    try {
      id = new Identity(cubeInfo.getCube());
    } catch (error) { return; }
    this.identityMucs.set(cubeInfo.key.toString('hex'), cubeInfo);
  }
}