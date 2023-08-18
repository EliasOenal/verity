import { Cube } from './cube'
import * as fp from './fieldProcessing';

export interface CubeMeta {
  key: Buffer;
  binaryCube: Buffer;
  cubeType: number;
  date: number;
  challengeLevel: number;
}

/**
 * @classdesc CubeInfo describes a cube as seen by our local node.
 * While a cube is always a cube, our view of it changes over time.
 * From our local point of view, in this specific Verity instance any cube can
 * be in any of these three states:
 * - active:     The most complete state: We know the cube, have its binary
 *               representation stored and we have a Cube object in memory that we
 *               can use and call methods on.
 * - dormant:    We know the cube and have its binary representation stored,
 *               but we don't currently hold a Cube object. Cubes will be dormant
 *               over most of their lifespan, because the number of cubes actually
 *               in active use on our node at any time is usually small and keeping
 *               a Cube object is much more memory intense than just keeping the
 *               binary blob.
 * - incomplete: This is the most incomplete state and only exists when the
 *               AnnotationEngine is switched on. (TODO move reverse relations stuff etc to a new class AnnotationEngine)
 *               It means we have heard of this cube and know its key (e.g. because
 *               it was referenced in a RELATES_TO field) but we have not received
 *               the actual cube yet.
 *
 * We also call a cube `complete` if we actually have its data, i.e. if it is
 * either in the active or dormant state.
 *
 * CubeInfo keeps track of cubes and their local states, provides useful
 * information even in the dormant and unseen states, and allows us to activate
 * a dormant cube (i.e. instantiate it and get a Cube object).
*/
export class CubeInfo {
  // @member key: Uniquely identifies this cube and is the only information
  //              that must always be present. Knowledge of the key is what
  //              gives us a perception of this cube and (apparently)
  //              justified creating a CubeInfo object for it.
  key: Buffer;

  // @member binaryCube: The binary representation of this cube.
  binaryCube: Buffer = undefined;
  cubeType: number = undefined;
  date: number = undefined;
  challengeLevel: number = undefined;

  reverseRelationships: Array<fp.Relationship> = [];
  applicationNotes: Map<any, any> = new Map();

  constructor(
          key: Buffer, binaryCube?: Buffer, cubeType?: number,
          date?: number,  challengeLevel?: number) {
      this.key = key;
      this.binaryCube = binaryCube;
      this.cubeType = cubeType;
      this.date = date;
      this.challengeLevel = challengeLevel;
  }

  isComplete(): boolean { return this.binaryCube? true : false }

  instantiate(): Cube | undefined {
    if (this.isComplete()) return new Cube(this.binaryCube);
    else return undefined;
  }

  // TODO: use fp.getRelationships for that
  getReverseRelationships(
        type?: fp.RelationshipType,
        remoteKey?: Buffer)
    :Array<fp.Relationship> {
      let ret = [];
      for (const reverseRelationship of this.reverseRelationships) {
        if (
          (!type || type == reverseRelationship.type) &&
          (!remoteKey) || remoteKey == reverseRelationship.remoteKey ) {
            ret.push(reverseRelationship);
          }
      }
      return ret;
    }

}
