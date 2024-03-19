// cubeStore.ts
import { Settings, VerityError } from '../settings';
import { Cube, coreCubeFamily } from './cube';
import { CubeInfo, CubeMeta } from './cubeInfo'
import { CubePersistence } from "./cubePersistence";
import { CubeType, CubeKey, InsufficientDifficulty } from './cubeDefinitions';
import { CubeFamilyDefinition } from './cubeFamily';
import { cubeContest, shouldRetainCube, getCurrentEpoch } from './cubeUtil';
import { TreeOfWisdom } from '../tow';
import { logger } from '../logger';

import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

// TODO: we need to be able to pin certain cubes
// to prevent them from being pruned. This may be used to preserve cubes
// authored by our local user, for example. Indeed, the social media
// application's Identity implementation relies on having our own posts preserved.

export interface CubeStoreOptions {
  /**
   * Save cubes to local storage.
   * Default: Settings.CUBE_PERSISTANCE
   **/
  enableCubePersistance?: boolean,

  /**
   * If enabled, do not accept or keep old cubes past their scheduled
   * recycling date. (Pruning not fully implemented yet.)
   * Default: Settings.CUBE_RETENTION_POLICY
   */
  enableCubeRetentionPolicy?: boolean,

  /**
   * When enabled, uses a Merckle-Patricia-Trie for efficient full node
   * synchronisation. Do not enable for light nodes.
   * Default: Settings.TREE_OF_WISDOM
   */
  enableTreeOfWisdom?: boolean,

  /**
   * Minimum hash cash level required to accept a Cube. Used for spam prevention.
   * Set to 0 to disable entirely (not recommended for prod use).
   * Default: Settings.REQUIRED_DIFFICULTY
   */
  requiredDifficulty?: number,

  // TODO update comment to reflect type change from FieldParserTable to CubeFamilyDefinition
  /**
   * Choose the default parser to be used for binary cubes store in this
   * CubeStore. By default, we will use the coreFieldParsers, which only
   * parse the core or "boilerplate" fields and ignore any payload.
   * This default setting is really only useful for "server-only" nodes who
   * do nothing but store and forward Cubes.
   * For nodes actually doing stuff, chose the parser table matching your Cube
   * format. If you're using CCI, and we strongly recommend you do, choose
   * cciFieldParsers.
   */
  family?: CubeFamilyDefinition,

  /**
   * The default implementation class this CubeStore will use when
   * re-instantiating a binary ("dormant") Cube. This could be plain old Cube,
   * cciCube, or an application specific variant.
   * Defaults to Cube, the Verity core implementation. Application will usually
   * want to change this; for CCI-compliant applications, cciCube will be the
   * right choice.
   * Note that this option will not affect "active" Cubes, i.e. Cubes locally
   * supplied as Cube or Cube-subclass objects.
   */
  cubeClass?: typeof Cube;
}

export class CubeStore extends EventEmitter {
  readyPromise: Promise<any>;

  private storage: Map<string, CubeInfo> = new Map();

  // Refers to the persistant cube storage database, if available and enabled
  private persistence: CubePersistence = undefined;
  // The Tree of Wisdom maps cube keys to their hashes.
  private treeOfWisdom: TreeOfWisdom = undefined;
  readonly enableCubeRetentionPolicy: boolean;

  readonly family: CubeFamilyDefinition;
  readonly cubeClass: typeof Cube;
  readonly required_difficulty: number;

  constructor(options: CubeStoreOptions) {
    super();
    this.required_difficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
    this.family = options?.family ?? coreCubeFamily;
    this.enableCubeRetentionPolicy = options?.enableCubeRetentionPolicy ?? Settings.CUBE_RETENTION_POLICY;
    this.cubeClass = options?.cubeClass ?? Cube;

    this.storage = new Map();
    if (options?.enableTreeOfWisdom ?? Settings.TREE_OF_WISDOM) {
      this.treeOfWisdom = new TreeOfWisdom();
    }

    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS * 10);  // one for each peer and a few for ourselves

    this.readyPromise = new Promise(resolve => this.once('ready', () => {
      resolve(undefined);
    }));

    const enablePersistence = options?.enableCubePersistance ?? Settings.CUBE_PERSISTANCE;
    if (enablePersistence) {
      this.persistence = new CubePersistence();

      this.persistence.on('ready', async () => {
        logger.trace("cubeStore: received ready event from cubePersistence");
        await this.syncPersistentStorage();
        this.pruneCubes();
        this.emit("ready");
      });
    } else this.emit("ready");
  }

  // TODO: implement importing CubeInfo directly
  /**
   * Add a binary Cube to storage.
   * @param parsers defines how this binary Cubes should be parsed.
   * Will use this store's default if not specified, which in turn will use the
   * core-only parsers if you didn't specify anything else on construction.
   */
  async addCube(
    cube_input: Buffer,
    family?: CubeFamilyDefinition): Promise<Cube>;
  /**
   * Add a Cube object to storage.
   * (Note you cannot specify a FieldParserTable in this variant as the Cube
   * object is already parsed and should hopefully know how this happened.)
   */
  async addCube(cube_input: Cube): Promise<Cube>;
  async addCube(
      cube_input: Cube | Buffer,
      family: CubeFamilyDefinition = this.family,
  ): Promise<Cube> {
    try {
      // Cube objects are ephemeral as storing binary data is more efficient.
      // Create cube object if we don't have one yet.
      let binaryCube: Buffer;
      let cube: Cube;
      if (cube_input instanceof Cube) {
        cube = cube_input;
        binaryCube = await cube_input.getBinaryData();
      } else if (cube_input instanceof Buffer) { // cube_input instanceof Buffer
        binaryCube = cube_input;
        cube = new this.cubeClass(binaryCube, family);
      } else {  // should never be even possible to happen, and yet, there was this one time when it did
        // @ts-ignore If we end up here, we're well outside any kind of sanity TypeScript can possibly be expected to understand.
        throw new TypeError("CubeStore: invalid type supplied to addCube: " + cube_input.constructor.name);
      }
      const cubeInfo: CubeInfo = await cube.getCubeInfo();

      if (this.enableCubeRetentionPolicy) { // cube valid for current epoch?
        let res: boolean = shouldRetainCube(
          cubeInfo.keyString, cubeInfo.date,
          cubeInfo.challengeLevel, getCurrentEpoch());
        if (!res) {
          logger.error(`CubeStore: Cube is not valid for current epoch, discarding.`);
          return undefined;
        }
      }

      // Sometimes we get the same cube twice (e.g. due to network latency).
      // In that case, do nothing -- no need to invalidate the hash or to
      // emit an event.
      if (this.hasCube(cubeInfo.key) && cubeInfo.cubeType == CubeType.FROZEN) {
        logger.warn('CubeStorage: duplicate - frozen cube already exists');
        return cube;
      }
      if (cube.getDifficulty() < this.required_difficulty) {
        throw new InsufficientDifficulty("CubeStore: Cube does not meet difficulty requirements");
      }
      // If this is a MUC, check if we already have a MUC with this key.
      // Replace it with the incoming MUC if it's newer than the one we have.
      if (cubeInfo.cubeType == CubeType.MUC) {
        if (this.hasCube(cubeInfo.key)) {
          const storedCube: CubeInfo = this.getCubeInfo(cubeInfo.key);
          const winningCube: CubeMeta = cubeContest(storedCube, cubeInfo);
          if (winningCube === storedCube) {
            logger.info('CubeStorage: Keeping stored MUC over incoming MUC');
            return storedCube.getCube();  // TODO: it's completely unnecessary to instantiate the potentially dormant Cube here -- maybe change the addCube() signature once again and not return a Cube object after all?
          } else {
            logger.info('CubeStorage: Replacing stored MUC with incoming MUC');
          }
        }
      }

      // Store the cube to RAM -- TODO: does not scale, obviously
      this.storage.set(cubeInfo.keyString, cubeInfo);
      // save cube to disk (if available and enabled)
      if (this.persistence) {
        this.persistence.storeRawCube(cubeInfo.keyString, cubeInfo.binaryCube);
      }
      // add cube to the Tree of Wisdom if enabled
      if (this.treeOfWisdom) {
        let hash: Buffer = await cube.getHash();
        // Truncate hash to 20 bytes, the reasoning is:
        // Our hashes are hardened with a strong hashcash, making attacks much harder.
        // Attacking this (birthday paradox) has a complexity of 2^80, which is not feasible.
        hash = hash.subarray(0, 20);
        this.treeOfWisdom.set(cubeInfo.key.toString('hex'), hash);
      }

      // inform our application(s) about the new cube
      try {
        // logger.trace(`CubeStore: Added cube ${cubeInfo.keystring}, emitting cubeAdded`)
        this.emit('cubeAdded', cubeInfo);
      } catch(error) {
        logger.error("CubeStore: While adding Cube " + cubeInfo.keyString + "a cubeAdded subscriber experienced an error: " + error.message);
      }

      // All done finally, just return the cube in case anyone cares.
      return cube;
    } catch (e) {
      if (e instanceof VerityError) {
        logger.error('CubeStore: Error adding cube:' + e.message);
      } else {
        throw e;
      }
      return undefined;
    }
  }

  hasCube(key: CubeKey | string): boolean {
    if (key instanceof Buffer) key = key.toString('hex');
    return this.storage.has(key);
  }

  getNumberOfStoredCubes(): number {
    return this.storage.size;
  }

  getCubeInfo(key: CubeKey | string): CubeInfo {
    if (key instanceof Buffer) key = key.toString('hex');
    return this.storage.get(key);
  }
  getCubeRaw(key: CubeKey | string): Buffer | undefined {
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.binaryCube;
    else return undefined;
  }
  /**
   * Get a Cube from storage. If the cube is currently dormant, it will
   * automatically get reinstantiated for you.
   * @param key Pass the key of the cube you want in either binary or string form
   * @param parsers If the requested Cube is domant it will need to be
   *        re-parsed. The CubeInfo is supposed to know which parser to use,
   *        but you can override it here if you want.
   */
  getCube(
      key: CubeKey | string,
      family: CubeFamilyDefinition = undefined,  // undefined = will use CubeInfo's default
    ): Cube | undefined {
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.getCube(family);
    else return undefined;
  }

  /**
   * Converts all cube keys to actual CubeKeys (i.e. binary buffers).
   * If you're fine with strings, just call this.storage.keys instead, much cheaper.
   */
  getAllKeys(): Set<CubeKey> {
    const ret: Set<CubeKey> = new Set();
    for (const [key, cubeInfo] of this.storage) {
      ret.add(cubeInfo.key);
    }
    return ret;
  }

  getAllKeystrings(): IterableIterator<string> {
    return this.storage.keys();
  }

  // TODO: we can probably get rid of this method now
  getAllCubeMeta(): Set<CubeMeta> {
    const ret: Set<CubeMeta> = new Set();
    for (const [key, cubeInfo] of this.storage) {
      ret.add(cubeInfo);
    }
    return ret;
  }

  getAllCubeInfo(): IterableIterator<CubeInfo> {
    return this.storage.values();
  }

  // This gets called once a persistence object is ready.
  // We will then proceed to store all of our cubes into it,
  // and load all cubes from it.
  private async syncPersistentStorage() {
    if (!this.persistence) return;
    for (const rawcube of await this.persistence.requestRawCubes()) {
      await this.addCube(Buffer.from(rawcube));
    }
    this.persistence.storeCubes(this.storage);
  }

  pruneCubes(): void {
    if (!this.enableCubeRetentionPolicy) return;  // feature disabled?
    const currentEpoch = getCurrentEpoch();
    const cubeKeys = Array.from(this.storage.keys());
    let index = 0;

    // pruning will be performed in batches to prevent main thread lags --
    // prepare batch function
    const checkAndPruneCubes = async () => {
      const batchSize = 50;
      for (let i = 0; i < batchSize && index < cubeKeys.length; i++, index++) {
        const key = cubeKeys[index];
        const cubeInfo = this.storage.get(key);
        if (!cubeInfo) continue;

        if (!shouldRetainCube(cubeInfo.keyString, cubeInfo.date, cubeInfo.challengeLevel, currentEpoch)) {
          this.storage.delete(key);
          if (this.persistence) {
            await this.persistence.deleteRawCube(key);
          }
          logger.info(`Pruned cube with key: ${key}`);
        }
      }

      if (index < cubeKeys.length) {
        setTimeout(checkAndPruneCubes, 0);
      } else {
        logger.info(`Completed pruning process.`);
      }
    };

    checkAndPruneCubes();  // start pruning
  }
}
