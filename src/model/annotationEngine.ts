// TODO: move to viewmodel, weaken strong coupling with CubeStore

import { CubeStore } from './cubeStore';
import { CubeInfo, CubeMeta } from './cubeInfo'
import { Cube } from './cube';
import { logger } from './logger';
import * as fp from './fieldProcessing';

import { EventEmitter } from 'events';

export class AnnotationEngine extends EventEmitter {
  private cubeStore: CubeStore;

  constructor(cubeStore: CubeStore) {
    super();
    this.cubeStore = cubeStore;
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.autoAnnotate(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeDisplayable(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeMakesOthersDisplayable(cube.key));
  }

  private autoAnnotate(key: Buffer, cube?: Cube, cubeInfo?: CubeInfo) {
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
    if (!cube) cube = cubeInfo.instantiate();
    for (const relationship of cube.getFields().getRelationships()) {
      const remoteDataset: CubeInfo =
        this.cubeStore.getCreateOrPopulateCubeInfo(relationship.remoteKey);
      const existingReverse: Array<fp.Relationship> =
        remoteDataset.getReverseRelationships(relationship.type, key);
      if (existingReverse.length == 0) {
        remoteDataset.reverseRelationships.push(
          new fp.Relationship(relationship.type, key));
        // logger.trace(`cubeStore: learning reverse relationship from ${relationship.remoteKey} to ${key}`)
      }
    }
  }

  // Emits cubeDisplayable events if this is the case
  isCubeDisplayable(key: Buffer, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    // TODO: move displayability logic somewhere else
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
    if (!cubeInfo.isComplete()) return false;  // we don't even have this cube yet
    if (!cube) cube = cubeInfo.instantiate();

    // TODO: handle continuation chains
    // TODO: parametrize and handle additional relationship types on request
    // TODO: as discussed, this whole decision process (and the related attributes
    // in CubeDataset) should at some point not be applies to all cubes,
    // just to interesting ones that are actually to be displayed.

    // are we a reply?
    // if we are, we can only be displayed if we have the original post,
    // and the original post is displayable too
    const reply_to: fp.Relationship =
      cube.getFields().getFirstRelationship(fp.RelationshipType.REPLY_TO);
    if (reply_to) {
      const basePost: CubeInfo = this.cubeStore.getCubeInfo(reply_to.remoteKey);
      if (!basePost) return false;
      if (!this.isCubeDisplayable(reply_to.remoteKey)) return false;
    }
    return true;
  }
  private emitIfCubeDisplayable(
    key: Buffer, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    const displayable: boolean = this.isCubeDisplayable(key, cubeInfo, cube);
    if (displayable) this.emit('cubeDisplayable', key);
    return displayable;
  }

  // Emits cubeDisplayable events if this is the case
  emitIfCubeMakesOthersDisplayable(
    key: Buffer, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    let ret: boolean = false;
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
    if (!cube) cube = cubeInfo.instantiate();

    // Am I the base post to a reply we already have?
    if (this.isCubeDisplayable(key, cubeInfo, cube)) {
      // In a base-reply relationship, I as a base can only make my reply
      // displayable if I am displayable myself.
      const replies: Array<fp.Relationship> = cubeInfo.getReverseRelationships(
        fp.RelationshipType.REPLY_TO);
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