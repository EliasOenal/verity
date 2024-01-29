import { Cube } from './cube'
import { CubeType, CubeKey } from './cubeDefinitions';
import { FieldParserTable, coreFieldParsers } from './cubeFields';

/**
 * @interface CubeMeta is a restricted view on CubeInfo containing metadata only.
 *            Basically, it's the CubeInfo without the actual Cube :)
*/
export interface CubeMeta {
  key: CubeKey;
  cubeType: number;
  date: number;
  challengeLevel: number;
}

// maybe TODO: consolidate this with CubeMeta
export interface CubeInfoParams {
  key: CubeKey;
  binaryCube?: Buffer;
  cubeType?: number;
  date?: number;
  challengeLevel?: number
}

/**
 * @classdesc CubeInfo describes a cube as seen by our local node.
 * While a cube is always a cube, our view of it changes over time.
 * From our local point of view, in this specific Verity instance any cube can
 * be in any of these two states:
 * - active:     The most complete state: We know the cube, have its binary
 *               representation stored and we have a Cube object in memory that we
 *               can use and call methods on.
 * - dormant:    We know the cube and have its binary representation stored,
 *               but we don't currently hold a Cube object. Cubes will be dormant
 *               over most of their lifespan, because the number of cubes actually
 *               in active use on our node at any time is usually small and keeping
 *               a Cube object is much more memory intense than just keeping the
 *               binary blob.
 *
 * There's a third state that's not actually relevant in the context of CubeInfo
 * or in fact anywhere in the core library, but it still exists and is tracked by
 * AnnotationEngine:
 * - incomplete: It means we have heard of this cube and know its key (e.g. because
 *               it was referenced in a RELATES_TO field) but we have not received
 *               the actual cube yet. There is no CubeInfo for incomplete cubes.
 *
 * CubeInfo keeps track of cubes and their local states, provides useful
 * information even in the dormant state, and allows us to activate
 * a dormant cube (i.e. instantiate it and get a Cube object).
*/
export class CubeInfo {
  // @member key: Uniquely identifies this cube and is the only information
  //              that must always be present. Knowledge of the key is what
  //              gives us a perception of this cube and (apparently)
  //              justified creating a CubeInfo object for it.
  key: CubeKey;

  get keystring() { return this.key.toString('hex'); }

  // @member binaryCube: The binary representation of this cube.
  binaryCube: Buffer = undefined;
  cubeType: CubeType = undefined;
  date: number = undefined;
  challengeLevel: number = undefined;

  /**
   * Application code may store any notes they may have on a Cube here.
   * This is currently unused.
   */
  applicationNotes: object = {}

  // @member objectCache: Will remember the last instantiated Cube object
  //                      for as long as the garbage collector keeps it alive
  private objectCache: WeakRef<Cube> = undefined;

  // NOTE, maybe TODO: If binaryCube is specified, this CubeInfo could contain
  // contradictory information as we currently don't validate the details
  // provided against the information contained in the actual (binary) Cube.
  constructor(
      params: CubeInfoParams,
      readonly fieldParserTable: FieldParserTable = coreFieldParsers) {
    this.key = params.key;
    this.binaryCube = params.binaryCube;
    this.cubeType = params.cubeType;
    this.date = params.date;
    this.challengeLevel = params.challengeLevel;
  }

  /**
   * Gets the Cube object representing this Cube.
   * If the cube is currently in dormant state, this instantiates the Cube object
   * for you.
   * We use an object cache (WeakRef) to prevent unnecessary re-instantiations of
   * Cube objects, so there's no need for the caller to cache them.
   */
  getCube(): Cube | undefined {
    // Keep returning the same Cube object until it gets garbage collected
    if (this.objectCache) {
      const cachedCube: Cube = this.objectCache.deref();
      if (cachedCube) {
        // logger.trace("cubeInfo: Yay! Saving us one instantiation");
        return this.objectCache.deref();
      }
    }

    // Nope, no Cube object cached. Create a new one and remember it.
    const cube = new Cube(this.binaryCube, this.fieldParserTable);
    this.objectCache = new WeakRef(cube);
    return cube;
  }

}
