import { CubeStore } from '../model/cubeStore';
import { CubeInfo, CubeMeta } from '../model/cubeInfo'
import { Cube, CubeKey } from '../model/cube';
import { logger } from '../model/logger';

import { EventEmitter } from 'events';
import { CubeRelationship, CubeRelationshipType } from '../model/cubeFields';
import { BaseFields } from '../model/baseFields';

export class AnnotationEngine extends EventEmitter {
  private cubeStore: CubeStore;

  /**
   * Stores reverse relationships for each Cube.
   * Getting the relationships of any particular Cube is easy -- just read the
   * appropriate fields. But how do you find out if any *other* cubes have
   * references to your cube at hand? Cube relationships are not double-linked,
   * so there would be now way of finding out but traversing every single cube
   * in your store.
   * That's why we recreate this double-linkage whenever we receive a cube.
   * reverseRelations stores a List of reverse relationships (that's the map's value)
   * for every Cube we know (the map's key is the stringified Cube key).
   */
  reverseRelationships: Map<string, Array<CubeRelationship>> = new Map();  // using string representation of CubeKey as maps don't work well with Buffers

  /**
   * The AnnotationEngine can be used on (top-level) Cube fields as well as on
   * any application-defined sub-fields, as long as they are similar enough.
   * getFieldsFunc refers to a function which returns the fields this AnnotationEngine
   * is supposed to work on. By default, for top-level Cube fields, it is just an
   * alias to cube.getFields().
   */
  getFieldsFunc: Function;
  defaultGetFieldsFunc(cube: Cube): BaseFields {
    return cube.getFields();
  }

  constructor(cubeStore: CubeStore, getFieldsFunc = undefined) {
    super();

    // define how this AnnotationEngine reaches the fields it is supposed to work on
    if (getFieldsFunc === undefined) getFieldsFunc = this.defaultGetFieldsFunc;
    this.getFieldsFunc = getFieldsFunc;

    // set CubeStore and subscribe to events
    this.cubeStore = cubeStore;
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.autoAnnotate(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeDisplayable(cube.key));
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.emitIfCubeMakesOthersDisplayable(cube.key));
  }

  private autoAnnotate(key: CubeKey) {
    const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(key);
    const cube: Cube = cubeInfo.getCube();

    for (const relationship of this.getFieldsFunc(cube).getRelationships()) {
      // The the remote Cubes's reverse-relationship list
      let remoteCubeRels = this.reverseRelationships.get(
        relationship.remoteKey.toString('hex'));
      if (!remoteCubeRels) {
        remoteCubeRels = [];
        this.reverseRelationships.set(
          relationship.remoteKey.toString('hex'), remoteCubeRels);
      }

      // Now add a reverse relationship for the remote Cube, but only
      // it that actually something we didn't know before:
      const alreadyKnown: Array<CubeRelationship> =
        this.getReverseRelationships(remoteCubeRels, relationship.type, key);
      if (alreadyKnown.length === 0) {
        remoteCubeRels.push(
          new CubeRelationship(relationship.type, key));
        // logger.trace(`cubeStore: learning reverse relationship from ${relationship.remoteKey} to ${key}`)
      }
    }
  }

  /**
   * @param cubeKey Key of the Cube you'd like to get reverse relationships for.
   *             (If you already have the appropriate array reference at hand,
   *             you may pass that instead, but do so at your own risk.)
   * @param type Only include this type of relationship.
   * @param remoteKey Only include relationships to the Cube with this key.
   * @returns An array of reversed relationship objects.
   */
  getReverseRelationships(
      cubeKey: CubeKey | string | Array<CubeRelationship>,
      type?: CubeRelationshipType,
      remoteKey?: CubeKey): Array<CubeRelationship> {
    let reverseRelationshipArray;
    if (cubeKey instanceof Array) {
      reverseRelationshipArray = cubeKey;
    } else if (cubeKey instanceof Buffer) {
      cubeKey = cubeKey.toString('hex');
      reverseRelationshipArray = this.reverseRelationships.get(cubeKey);
    }
    if (!reverseRelationshipArray) return [];  // we don't know any relationships for this cube

    const ret = [];
    for (const reverseRelationship of reverseRelationshipArray) {
      // filter reverse relationships if requested:
      if (
        (!type || type == reverseRelationship.type) &&
        (!remoteKey) || remoteKey == reverseRelationship.remoteKey) {
        ret.push(reverseRelationship);
      }
    }
    return ret;
  }


  /** Emits cubeDisplayable events if a Cube is, well... displayable */
  isCubeDisplayable(key: CubeKey, cubeInfo?: CubeInfo, cube?: Cube): boolean {
    if (!cubeInfo) cubeInfo = this.cubeStore.getCubeInfo(key);
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
      const replies: Array<CubeRelationship> = this.getReverseRelationships(
        cubeInfo.key,
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