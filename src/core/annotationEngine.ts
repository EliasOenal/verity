import { CubeStore } from './cubeStore';
import { CubeInfo, CubeMeta } from './cubeInfo'
import { Cube, CubeKey } from './cube';
import { logger } from './logger';

import { EventEmitter } from 'events';
import { CubeRelationship } from './cubeFields';
import { BaseFields, BaseRelationship } from './baseFields';

import { Buffer } from 'buffer';

type RelationshipClassConstructor = new (type: number, remoteKey: CubeKey) => BaseRelationship;

export class AnnotationEngine extends EventEmitter {
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

  constructor(
  /**
   * The AnnotationEngine can be used on (top-level) Cube fields as well as on
   * any application-defined sub-fields, as long as they are similar enough.
   * getFieldsFunc refers to a function which returns the fields this AnnotationEngine
   * is supposed to work on. By default, for top-level Cube fields, it is just an
   * alias to cube.getFields().
   */
      public readonly cubeStore,
      public readonly getFields: (cube: Cube) => BaseFields = (cube) => { return cube.getFields() },
      public readonly relationshipClass: RelationshipClassConstructor = CubeRelationship) {
    super();
    // set CubeStore and subscribe to events
    this.cubeStore = cubeStore;
    this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.autoAnnotate(cubeInfo));
    this.crawlCubeStore();  // we may have missed some events
  }

  autoAnnotate(cubeInfo: CubeInfo): void {
    // logger.trace(`AnnotationEngine: Auto-annotating cube ${key.toString('hex')}`);
    const cube: Cube = cubeInfo.getCube();

    // does this Cube even have a valid field structure?
    const fields: BaseFields = this.getFields(cube);
    if (!fields) return;

    for (const relationship of fields.getRelationships()) {
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
        this.getReverseRelationships(remoteCubeRels, relationship.type, cubeInfo.key);
      if (alreadyKnown.length === 0) {
        remoteCubeRels.push(
          new this.relationshipClass(relationship.type, cubeInfo.key));
        // logger.trace(`AnnotationEngine: learning reverse relationship type ${relationship.type} from ${relationship.remoteKey.toString('hex')} to ${key.toString('hex')}`);
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

  getFirstReverseRelationship(
    cubeKey: CubeKey | string | Array<BaseRelationship>,
    type?: number,  // e.g. one of CubeRelationshipType
    remoteKey?: CubeKey): BaseRelationship {
      // note this is not efficient, but the list of reverse relationships will be small
      const rels = this.getReverseRelationships(cubeKey, type, remoteKey);
      if (rels.length) return rels[0];
      else return undefined;
  }

  protected crawlCubeStore(): void {
    for (const cubeInfo of this.cubeStore.getAllCubeInfo()) {
      this.autoAnnotate(cubeInfo);
    }
  }

}