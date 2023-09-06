import { CubeStore } from '../model/cubeStore';
import { CubeInfo, CubeMeta } from '../model/cubeInfo'
import { Cube, CubeKey } from '../model/cube';
import { logger } from '../model/logger';

import { EventEmitter } from 'events';
import { CubeRelationship } from '../model/cubeFields';
import { BaseFields, BaseRelationship } from '../model/baseFields';

export class AnnotationEngine extends EventEmitter {
  protected cubeStore: CubeStore;

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
  reverseRelationships: Map<string, Array<BaseRelationship>> = new Map();  // using string representation of CubeKey as maps don't work well with Buffers

  /**
   * The AnnotationEngine can be used on (top-level) Cube fields as well as on
   * any application-defined sub-fields, as long as they are similar enough.
   * getFieldsFunc refers to a function which returns the fields this AnnotationEngine
   * is supposed to work on. By default, for top-level Cube fields, it is just an
   * alias to cube.getFields().
   */
  getFields: Function;
  static defaultGetFieldsFunc(cube: Cube): BaseFields {
    return cube.getFields();
  }

  relationshipClass: any = CubeRelationship;  // e.g. CubeRelationship

  constructor(cubeStore: CubeStore, getFieldsFunc?, relationshipClass?) {
    super();

    // define how this AnnotationEngine reaches the fields it is supposed to work on
    if (getFieldsFunc === undefined) getFieldsFunc = AnnotationEngine.defaultGetFieldsFunc;
    this.getFields = getFieldsFunc;

    // define on which kind of Relationships this AnnotationEngine works on
    if (relationshipClass === undefined) relationshipClass = CubeRelationship;
    this.relationshipClass = relationshipClass;

    // set CubeStore and subscribe to events
    this.cubeStore = cubeStore;
    this.cubeStore.on('cubeAdded', (cube: CubeMeta) => this.autoAnnotate(cube.key));
  }

  private autoAnnotate(key: CubeKey) {
    const cubeInfo: CubeInfo = this.cubeStore.getCubeInfo(key);
    const cube: Cube = cubeInfo.getCube();

    for (const relationship of this.getFields(cube).getRelationships()) {
      // The the remote Cubes's reverse-relationship list
      let remoteCubeRels = this.reverseRelationships.get(
        relationship.remoteKey.toString('hex'));
      if (!remoteCubeRels) {
        remoteCubeRels = [];
        this.reverseRelationships.set(
          relationship.remoteKey.toString('hex'), remoteCubeRels);
      }

      // Now add a reverse relationship for the remote Cube, but only if
      // that's actually something we didn't know before:
      const alreadyKnown: Array<BaseRelationship> =
        this.getReverseRelationships(remoteCubeRels, relationship.type, key);
      if (alreadyKnown.length === 0) {
        remoteCubeRels.push(
          new this.relationshipClass(relationship.type, key));
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
      cubeKey: CubeKey | string | Array<BaseRelationship>,
      type?: number,  // e.g. one of CubeRelationshipType
      remoteKey?: CubeKey): Array<BaseRelationship> {
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

}