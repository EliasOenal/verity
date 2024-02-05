import { logger } from '../logger';
import { Cube } from './cube'
import { CubeType, CubeKey, CubeError } from './cubeDefinitions';
import { FieldParserTable, coreFieldParsers } from './cubeFields';

import { Buffer } from 'buffer';

/**
 * @interface CubeMeta is a restricted view on CubeInfo containing metadata only.
 *            Basically, it's the CubeInfo without the actual Cube :)
*/
export interface CubeMeta {
  key: CubeKey;
  cubeType: CubeType;
  date: number;
  challengeLevel: number;
}

export interface CubeInfoOptions {
  /**
   * Required and used only for incomplete and dormant Cubes.
   * For active Cubes, key is always inferred from the Cube itself.
   */
  key: CubeKey;

  /** The Cube this CubeInfo represents, either in binary form or as an instance */
  cube?: Buffer | Cube;

  /**
   * The type of Cube (e.g. Dumb, MUC, PIC, ...)
   * Thus param is only used for incomplete Cubes. For complete Cubes, type is
   * always inferred from the Cube itself.
   */
  cubeType?: CubeType;

  date?: number;
  challengeLevel?: number;

  /**
   * Choose the default parser to be used for the cube represented by this
   * CubeInfo. By default, we will use the coreFieldParsers, which only
   * parse the core or "boilerplate" fields and ignore any payload.
   * This default setting is really only useful for "server-only" nodes who
   * do nothing but store and forward Cubes.
   * For nodes actually doing stuff, chose the parser table matching your Cube
   * format. If you're using CCI, and we strongly recommend you do, choose
   * cciFieldParsers.
   */
  parsers?: FieldParserTable,

  /**
   * The implementation class the represented Cube is of, for example
   * plain old Cube, cciCube, or an application specific variant.
   * The class is only relevant locally -- all Cubes are just Cubes while in
   * transit over the network. Note that this is NOT the Cube's type
   * (e.g. Dumb, MUC, PIC, ...).
   * This param is only used for incomplete and dormant Cubes.
   * For active Cubes (= provided as Cube objects), the class is always inferred
   * from the Cube object itself.
   * If the class is neither provided nor can be inferred, we will just default
   * to plain old Cube, which is probably too generic.
   */
  cubeClass?: typeof Cube;
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
 * - incomplete: Signifies we have heard of this cube and know its key (e.g.
 *               because it was offered to us during Cube exchange, or maybe
 *               because it was referenced in another Cube's RELATES_TO field),
 *               but we have not received the actual cube yet.
 *               Incomplete Cubes are not tracked by CubeStore.
 *
 * We also call a cube `complete` if we actually have its data, i.e. if it is
 * either in the active or dormant state.
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
  get keyString() { return this.key.toString('hex'); }

  // @member binaryCube: The binary representation of this cube.
  // TODO: encapsulate writes to binaryCube -- supplying the Cube after the fact should come with consistency checks
  binaryCube: Buffer = undefined;

  private _cubeType: CubeType = undefined;
  get cubeType(): CubeType { return Cube.Type(this.binaryCube) ?? this._cubeType }

  cubeClass: typeof Cube = Cube;  // type class
  date: number = undefined;
  challengeLevel: number = undefined;

  /**
   * Application code may store any notes they may have on a Cube here.
   * This is currently unused.
   */
  applicationNotes: object = {}

  readonly parsers: FieldParserTable;

  // @member objectCache: Will remember the last instantiated Cube object
  //                      for as long as the garbage collector keeps it alive
  private objectCache: WeakRef<Cube> = undefined;

  // NOTE, maybe TODO: If binaryCube is specified, this CubeInfo could contain
  // contradictory information as we currently don't validate the details
  // provided against the information contained in the actual (binary) Cube.
  constructor(options: CubeInfoOptions) {
    this.date = options.date;
    this.challengeLevel = options.challengeLevel;
    this.parsers = options?.parsers ?? coreFieldParsers;

    if (options.cube instanceof Cube) {
      // active Cube
      this.binaryCube = options.cube.getBinaryDataIfAvailable();
      if(!this.binaryCube) {
        throw new CubeError("CubeInfo can only be constructed for compiled Cubes, call and await Cube's getBinaryData() first");
      }
      this.key = options.cube.getKeyIfAvailable();
      if(!this.key) {
        throw new CubeError("CubeInfo can only be constructed for Cubes which know their key, call and await Cube's getKey() first");
      }
      this.objectCache = new WeakRef(options.cube);
      this.cubeClass = options.cube.class;
    } else if (options.cube instanceof Buffer) {
      // dormant Cube
      this.binaryCube = options.cube;
      this.key = options.key;
      if(!this.key) {
        throw new CubeError("CubeInfo on dormant Cubes can only be contructed if you supply the Cube key.");
      }
      this.cubeClass = options.cubeClass ?? Cube;
    } else {
      // incomplete Cube
      this.binaryCube = undefined;
      this.cubeClass = options.cubeClass ?? Cube;
      this._cubeType = options.cubeType;
      this.key = options.key;
    }
  }

  /**
   * Gets the Cube object representing this Cube.
   * If the cube is currently in dormant state, this instantiates the Cube object
   * for you.
   * We use an object cache (WeakRef) to prevent unnecessary re-instantiations of
   * Cube objects, so there's no need for the caller to cache them.
   */
  getCube(
      parsers: FieldParserTable = this.parsers,
      cubeClass = this.cubeClass,
  ): Cube | undefined {
    // Keep returning the same Cube object until it gets garbage collected.
    // Can only used cached object when using default parser and Cube class.
    if (this.objectCache &&  // is there anything cached?
        parsers === this.parsers &&  // don't use cache unless default parsing
        cubeClass === this.cubeClass) {  // don't use cache unless default Cube class
      const cachedCube: Cube = this.objectCache.deref();
      if (cachedCube) {
        // logger.trace("cubeInfo: Yay! Saving us one instantiation");
        return this.objectCache.deref();
      }
    }

    // Nope, no Cube object cached. Create a new one and remember it.
    try {
      const cube = new cubeClass(this.binaryCube, parsers);
      // Can only cache object when using default parser and Cube class.
      if (parsers === this.parsers && cubeClass === this.cubeClass) {
        this.objectCache = new WeakRef(cube);
      }
      return cube;
    } catch (err) {
      logger.warn(
        "CubeInfo.getCube: Could not instantiate Cube: " + err.toString());
      return undefined;
    }
  }

}
