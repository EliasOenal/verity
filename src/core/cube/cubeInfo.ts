import { ApiMisuseError } from '../settings';

import { CubeType, CubeKey } from './cube.definitions';
import { Cube, coreCubeFamily } from './cube'
import { CubeFamilyDefinition } from './cubeFields';
import { activateCube, dateFromBinary, typeFromBinary } from './cubeUtil';

import { Buffer } from 'buffer';
import { logger } from '../logger';

/**
 * @interface CubeMeta is a restricted view on CubeInfo containing metadata only.
 *            Basically, it's the CubeInfo without the actual Cube :)
*/
export interface CubeMeta {
  key: CubeKey;
  cubeType: CubeType;
  date: number;
  difficulty: number;
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
   * The type of Cube (e.g. Frozen, MUC, IPC, ...)
   * Thus param is only used for incomplete Cubes. For complete Cubes, type is
   * always inferred from the Cube itself.
   */
  cubeType?: CubeType;

  date?: number;
  difficulty?: number;

  // TODO update comment to adequately reflect new type CubeFamilyDefinition
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
  family?: CubeFamilyDefinition|CubeFamilyDefinition[];
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
 * information even when dormant, and allows us to activate
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
  get cubeType(): CubeType { return typeFromBinary(this.binaryCube) ?? this._cubeType }

  private _date: number = undefined;
  /**
   * Returns this Cube's sculpting date.
   * Note that this getter may reactivate a dormant Cube in the background if
   * the requested information was not provided when this CubeInfo was created.
   **/
  get date(): number {
    if (this._date === undefined) {
      const cube = this.getCube();
      this._date = cube?.getDate();  // if Cube unavailable, _date will stay undefined
    }
    return this._date;
  }

  private _difficulty: number = undefined;
  /**
  * Returns this Cube's difficulty, i.e. it's achieved hashcash challenge level.
  * Note that this getter may reactivate a dormant Cube in the background if
  * the requested information was not provided when this CubeInfo was created.
  **/
  get difficulty(): number {
    if (this._difficulty === undefined) {
      const cube = this.getCube();
      this._difficulty = cube?.getDifficulty();  // if Cube unavailable, _difficulty will stay undefined
    }
    return this._difficulty;
  }

  readonly families: CubeFamilyDefinition[];

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
  /**
   * @throws ApiMisuseError on invalid combination of options;
   *         May throw CubeError on invalid input, e.g. corrupt binary data
   */
  constructor(options: CubeInfoOptions) {
    // we'll believe the caller that the provided cube information is correct,
    // but if we're able to read those ourselves we'll override them below
    this._date = options.date;
    this._difficulty = options.difficulty;

    if (options.cube instanceof Cube) {
      // active Cube
      this.binaryCube = options.cube.getBinaryDataIfAvailable();
      if(!this.binaryCube) {
        throw new ApiMisuseError("CubeInfo can only be constructed for compiled Cubes, call and await Cube's getBinaryData() first");
      }
      this.key = options.cube.getKeyIfAvailable();
      if(!this.key) {
        throw new ApiMisuseError("CubeInfo can only be constructed for Cubes which know their key, call and await Cube's getKey() first");
      }
      this.objectCache = new WeakRef(options.cube);
      this.families = [options.cube.family];
    } else if (options.cube instanceof Buffer) {
      // dormant Cube
      this.binaryCube = options.cube;
      this.key = options.key;
      this._date = dateFromBinary(this.binaryCube);
      if(!this.key) {
        throw new ApiMisuseError("CubeInfo on dormant Cubes can only be contructed if you supply the Cube key.");
      }
      // Set family, normalising it or using the default if necessary
      let families = options?.family ?? [coreCubeFamily];
      if (!Array.isArray(families)) families = [families];
      this.families = families;
    } else {
      // incomplete Cube
      this.binaryCube = undefined;
      this._cubeType = options.cubeType;
      this.key = options.key;
      // Set family, normalising it or using the default if necessary
      let families = options?.family ?? [coreCubeFamily];
      if (!Array.isArray(families)) families = [families];
      this.families = families;
    }
  }

  /**
   * Gets the Cube object representing this Cube.
   * If the cube is currently in dormant state, this instantiates the Cube object
   * for you.
   * We use an object cache (WeakRef) to prevent unnecessary re-instantiations of
   * Cube objects, so there's no need for the caller to cache them unless you
   * use a custom family setting.
   * @param family - If you want to have this Cube parsed differently than
   *   the default setting, you can provide a custom CubeFamily here.
   *   The Cube will not be cached in this case, so you should cache it yourself.
   * @returns The requested Cube, or undefined if the Cube is incomplete or
   *  unparseable.
   * @throws Should not throw.
   */
  getCube(
      families: CubeFamilyDefinition|CubeFamilyDefinition[] = this.families,
  ): Cube {
    // normalise input
    if (!Array.isArray(families)) families = [families];
    // Keep returning the same Cube object until it gets garbage collected.
    // Can only used cached object when using default parser and Cube class.
    if (this.objectCache) {  // is there anything cached?
      if (families[0] === this.families[0]) {  // don't use cache unless default parsing
        const cachedCube: Cube = this.objectCache.deref();
        if (cachedCube) {
          // logger.trace("cubeInfo: Yay! Saving us one instantiation");
          return this.objectCache.deref();
        }
      } else {
        logger.trace(`${this.toString()}: Re-instantiating Cube instead of using cached instance due to diverging CubeFamily setting`);
      }
    }

    // Nope, no Cube object cached. Create a new one and remember it.
    const cube = activateCube(this.binaryCube, families);

    // Still not returned? Looking bad then.
    if (cube === undefined) {
      logger.error(`${this.toString()}: Could not instantiate Cube using any configured family setting`);
      return undefined;
    }

    // Let's cache the new Cube object --
    // however, we can only do that when using the default Cube family
    if (cube.family === this.families[0]) {
      this.objectCache = new WeakRef(cube);
    }

    return cube;
  }

  toString(): string { return `CubeInfo for ${this.keyString}` }

  get valid(): boolean {
    if (this.key !== undefined && this.binaryCube !== undefined) return true;
    else return false;
  }

}
