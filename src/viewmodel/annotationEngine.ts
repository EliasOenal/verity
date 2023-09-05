import { CubeStore } from '../model/cubeStore';
import { CubeInfo, CubeMeta } from '../model/cubeInfo'
import { Cube, CubeKey } from '../model/cube';
import { logger } from '../model/logger';

import { EventEmitter } from 'events';
import { CubeRelationship, CubeRelationshipType } from '../model/cubeFields';

export class AnnotationEngine extends EventEmitter {
  private cubeStore: CubeStore;

  constructor(cubeStore: CubeStore) {
    super();
    this.cubeStore = cubeStore;
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.autoAnnotate(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeDisplayable(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeMakesOthersDisplayable(cube.key));
  }

  private autoAnnotate(key: CubeKey) {
    const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(key);
    const cube: Cube = cubeInfo.getCube();

    for (const relationship of cube.getFields().getRelationships()) {
      const remoteDataset: CubeInfo =
        this.cubeStore.getCreateOrPopulateCubeInfo(relationship.remoteKey);
      const existingReverse: Array<CubeRelationship> =
        remoteDataset.getReverseRelationships(relationship.type, key);
      if (existingReverse.length == 0) {
        remoteDataset.reverseRelationships.push(
          new CubeRelationship(relationship.type, key));
        // logger.trace(`cubeStore: learning reverse relationship from ${relationship.remoteKey} to ${key}`)
      }
    }
  }

  // Emits cubeDisplayable events if this is the case
  isCubeDisplayable(key: CubeKey, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
    if (!cubeInfo.isComplete()) return false;  // we don't even have this cube yet
    if (!cube) cube = cubeInfo.getCube();

    // TODO: handle continuation chains
    // TODO: parametrize and handle additional relationship types on request
    // TODO: as discussed, this whole decision process (and the related attributes
    // in CubeDataset) should at some point not be applies to all cubes,
    // just to interesting ones that are actually to be displayed.

    // are we a reply?
    // if we are, we can only be displayed if we have the original post,
    // and the original post is displayable too
    const reply_to: CubeRelationship =
      cube.getFields().getFirstRelationship(CubeRelationshipType.REPLY_TO);
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
      const replies: Array<CubeRelationship> = cubeInfo.getReverseRelationships(
        CubeRelationshipType.REPLY_TO);
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