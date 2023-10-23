import { CubeInfo, CubeMeta } from '../core/cube/cubeInfo'
import { Cube, CubeKey } from '../core/cube/cube';
import { CubeRelationship } from '../core/cube/cubeFields';

import { EventEmitter } from 'events';
import { BaseFields, BaseRelationship } from '../core/cube/baseFields';

import { Buffer } from 'buffer';

type RelationshipClassConstructor = new (type: number, remoteKey: CubeKey) => BaseRelationship;
export function defaultGetFieldsFunc(cube: Cube): BaseFields {
  return cube.getFields();
}

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
      public readonly getFields: (cube: Cube) => BaseFields = defaultGetFieldsFunc,
      public readonly relationshipClass: RelationshipClassConstructor = CubeRelationship,

      /**
   * A map mapping a numeric RelationshipType to the maximum number of Relationships
   * allowed per Cube for this type.
   * If specified, the AnnotationEngine will only create annotations of the specified
   * types.
   * If the maximum number of Relationships of a specific type allowed per Cube
   * is undefined it will be considered unlimited.
   */
      private readonly limitRelationshipTypes: Map<number, number> = undefined)
    {
    super();
    // set CubeStore and subscribe to events
    this.cubeStore = cubeStore;
    this.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => this.autoAnnotate(cubeInfo));
    this.crawlCubeStore();  // we may have missed some events
  }

  autoAnnotate(cubeInfo: CubeInfo): void {
    // logger.trace(`AnnotationEngine: Auto-annotating cube ${cubeInfo.key.toString('hex')}`);
    const cube: Cube = cubeInfo.getCube();

    // does this Cube even have a valid field structure?
    const fields: BaseFields = this.getFields(cube);
    if (!fields) return;

    // Keep track of how many relationships of each type this cube has
    const relsPerType: Map<number, number> = new Map();

    // Let's get real and handle those relationships
    for (const relationship of fields.getRelationships()) {
      if (this.limitRelationshipTypes) {
        // Is this a type of Relationship we care about?
        if (!this.limitRelationshipTypes.has(relationship.type)) {
          continue;
        }
        // Did we reach the relationship limit for this type?
        let relsPerThisType = relsPerType.get(relationship.type) || 0;
        if (relsPerThisType >= this.limitRelationshipTypes.get(relationship.type)) {
          continue;
        }
        // Okay, the rel's good, count it:
        relsPerThisType++;
        relsPerType.set(relationship.type, relsPerThisType);
      }

      // Get or create the remote Cubes's reverse-relationship list
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
    }  // for each relationship
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