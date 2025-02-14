import { CubeKey } from '../core/cube/cube.definitions';
import { CubeInfo } from '../core/cube/cubeInfo'
import { Cube } from '../core/cube/cube';

import { VerityFields } from './cube/verityFields';
import { cciRelationship } from './cube/cciRelationship';

import { EventEmitter } from 'events';
import { BaseFields } from '../core/fields/baseFields';

import { Buffer } from 'buffer';
import { Settings } from 'core/settings';
import { NetConstants } from '../core/networking/networkDefinitions';
import { logger } from '../core/logger';
import { CubeEmitter } from '../core/cube/cubeStore';

type RelationshipClassConstructor = new (type: number, remoteKey: CubeKey) => cciRelationship;
export function defaultGetFieldsFunc(cube: Cube): BaseFields {
  return cube?.fields;
}

export class AnnotationEngine extends EventEmitter {
  static Construct(
    cubeEmitter: CubeEmitter,
    getFields: (cube: Cube) => BaseFields = defaultGetFieldsFunc,
    relationshipClass: RelationshipClassConstructor = cciRelationship,
    limitRelationshipTypes: Map<number, number> = undefined
  ): Promise<AnnotationEngine> {
    const ae: AnnotationEngine = new this(
      cubeEmitter, getFields, relationshipClass, limitRelationshipTypes);
    return ae.ready;
  }

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
  reverseRelationships: Map<string, Array<cciRelationship>> = new Map();  // using string representation of CubeKey as maps don't work well with Buffers

  // Provide a ready promise
  private readyPromiseResolve: Function;
  private readyPromiseReject: Function;
  private _ready: Promise<AnnotationEngine> = new Promise<AnnotationEngine>(
      (resolve, reject) => {
          this.readyPromiseResolve = resolve;
          this.readyPromiseReject = reject;
      });
  /**
   * Kindly always await ready before using an AnnotationEngine, or it might not yet
   * be fully initialized.
   **/
  get ready(): Promise<AnnotationEngine> { return this._ready }

  constructor(
  /**
   * The AnnotationEngine can be used on (top-level) Cube fields as well as on
   * any application-defined sub-fields, as long as they are similar enough.
   * getFieldsFunc refers to a function which returns the fields this AnnotationEngine
   * is supposed to work on. By default, for top-level Cube fields, it is just an
   * alias to cube.fields.
   */
      public readonly cubeEmitter: CubeEmitter,
      public readonly getFields: (cube: Cube) => BaseFields = defaultGetFieldsFunc,
      public readonly relationshipClass: RelationshipClassConstructor = cciRelationship,

      /**
   * A map mapping a numeric RelationshipType to the maximum number of Relationships
   * allowed per Cube for this type.
   * If specified, the AnnotationEngine will only create annotations of the specified
   * types.
   * If the maximum number of Relationships of a specific type allowed per Cube
   * is undefined it will be considered unlimited.
   */
      readonly limitRelationshipTypes: Map<number, number> = undefined)
    {
    super();
    // set CubeStore and subscribe to events
    this.cubeEmitter = cubeEmitter;
    this.cubeEmitter?.on('cubeAdded', this.autoAnnotate);
    this.crawlCubeStore();  // we may have missed some events
  }

  autoAnnotate = (cubeInfo: CubeInfo): void => {
    // TODO: Prevent the annotation engine from loading obviously corrupt cubes
    // This is not the right place to catch this. Why do we even have them in the store?
    if ( !cubeInfo || !cubeInfo.binaryCube || cubeInfo.binaryCube.length == 4)
    {
      logger.error(`AnnotationEngine: Tried to load corrupt cube ${cubeInfo.key.toString('hex')}`);
      return;
    }

    // logger.trace(`AnnotationEngine: Auto-annotating cube ${cubeInfo.key.toString('hex')}`);
    const cube: Cube = cubeInfo.getCube();  // TODO: CCI CubeInfos should learn what kind of Cube they represent much earlier in the process

    // does this Cube even have a valid field structure?
    const fields: VerityFields = this.getFields(cube) as VerityFields;
    if (!(fields instanceof VerityFields)) return;  // no CCI, no rels, no annotations

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
      const alreadyKnown: Array<cciRelationship> =
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
      cubeKey: CubeKey | string | Array<cciRelationship>,
      type?: number,  // e.g. one of CubeRelationshipType
      remoteKey?: CubeKey): Array<cciRelationship> {
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
    cubeKey: CubeKey | string | Array<cciRelationship>,
    type?: number,  // e.g. one of CubeRelationshipType
    remoteKey?: CubeKey): cciRelationship {
      // note this is not efficient, but the list of reverse relationships will be small
      const rels = this.getReverseRelationships(cubeKey, type, remoteKey);
      if (rels.length) return rels[0];
      else return undefined;
  }

  shutdown(): void {
    this.cubeEmitter?.removeListener('cubeAdded', this.autoAnnotate);
  }

  // This does not scale well as it forces CubeStore to read every single
  // Cube from persistent storage every time Verity starts.
  // TODO: Provide an option not to crawl (for apps only interested in recent
  // Cubes) AND provide an option to persist annotations.
  // This is a low priority, non-breaking todo which only needs to be addressed
  // once we actually have a userbase.
  protected async crawlCubeStore(): Promise<void> {
    if (this.cubeEmitter) {
      for await (const cubeInfo of this.cubeEmitter.getAllCubeInfos()) {
        // TODO: This is not efficient. We should instead fire those off all at
        // once, collect them and later await Promises.all
        await this.crawlCubeStoreEach(cubeInfo);
      }
    } else {
      logger.warn("AnnotationEngine.crawlCubeStore() called, but cubeEmitter is undefined. This AnnotationEngine will still work, but it will probably be rather useless.");
    }
    this.readyPromiseResolve(this);
  }

  // Split out into it's own method so subclasses have more flexibility
  // in mixing in their own code. (Namely, ZwAnnotationEngine uses this.)
  protected async crawlCubeStoreEach(cubeInfo: CubeInfo): Promise<void> {
    this.autoAnnotate(cubeInfo);
  }
}