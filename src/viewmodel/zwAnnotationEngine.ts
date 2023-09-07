import { Cube, CubeKey } from "../model/cube";
import { CubeMeta, CubeInfo } from "../model/cubeInfo";
import { CubeStore } from "../model/cubeStore";
import { AnnotationEngine } from "./annotationEngine";
import { ZwFields, ZwRelationship, ZwRelationshipType } from "./zwFields";

import { Buffer } from 'buffer';

export class ZwAnnotationEngine extends AnnotationEngine {
  constructor(cubeStore: CubeStore) {
    super(cubeStore, ZwFields.get);
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeDisplayable(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeMakesOthersDisplayable(cube.key));
  }

  /** Emits cubeDisplayable events if a Cube is, well... displayable */
  isCubeDisplayable(key: CubeKey, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
    if (!cube) cube = cubeInfo.getCube();

    // is this even a valid ZwCube?
    const fields: ZwFields = this.getFields(cube);
    if (!fields) return false;

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

  cubeOwner(key: CubeKey): undefined {
    // TODO implement
    return undefined;
  }

  private emitIfCubeDisplayable(
    key: CubeKey, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    const displayable: boolean = this.isCubeDisplayable(key, cubeInfo, cube);
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
}