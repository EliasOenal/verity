// cubeStore.ts
import { ApiMisuseError, Settings, VerityError } from '../settings';
import { Cube, coreCubeFamily } from './cube';
import { CubeInfo, CubeMeta } from './cubeInfo'
import { CubePersistence, CubePersistenceOptions } from "./cubePersistence";
import { CubeType, CubeKey, InsufficientDifficulty } from './cubeDefinitions';
import { CubeFamilyDefinition } from './cubeFamily';
import { cubeContest, shouldRetainCube, getCurrentEpoch, keyVariants } from './cubeUtil';
import { TreeOfWisdom } from '../tow';
import { logger } from '../logger';

import { EventEmitter } from 'events';
import { WeakValueMap } from 'weakref'
import { Buffer } from 'buffer';

// TODO: we need to be able to pin certain cubes
// to prevent them from being pruned. This may be used to preserve cubes
// authored by our local user, for example. Indeed, the social media
// application's Identity implementation relies on having our own posts preserved.

// TODO: In persistence primary mode, cache (WeakRef) retrieved Cubes

export enum EnableCubePersitence {
  /** Keep all Cubes in RAM, do not use persistent storage */
  OFF = 0,

  /** Keep all Cubes in RAM, sync them to persistent storage */
  BACKUP = 1,

  /** Save and serve Cubes directly to and from persistent storage */
  PRIMARY = 2,
}

export interface CubeStoreOptions {
  /**
   * Save cubes to local storage.
   * Default: Settings.CUBE_PERSISTANCE
   **/
  enableCubePersistence?: EnableCubePersitence,

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

  readonly inMemory: boolean;

  /**
   * If this CubeStore is configured to keep Cubes in RAM, this will be where
   * we store them.
   */
  private storage: Map<string, CubeInfo> | WeakValueMap<string, CubeInfo> = undefined;

  /** Refers to the persistant cube storage database, if available and enabled */
  private persistence: CubePersistence = undefined;
  /** The Tree of Wisdom maps cube keys to their hashes. */
  private treeOfWisdom: TreeOfWisdom = undefined;

  readonly enableCubeRetentionPolicy: boolean;

  readonly family: CubeFamilyDefinition;
  readonly required_difficulty: number;

  constructor(options: CubeStoreOptions & CubePersistenceOptions) {
    super();
    this.required_difficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
    this.family = options?.family ?? coreCubeFamily;
    this.enableCubeRetentionPolicy = options?.enableCubeRetentionPolicy ?? Settings.CUBE_RETENTION_POLICY;

    if (options?.enableTreeOfWisdom ?? Settings.TREE_OF_WISDOM) {
      this.treeOfWisdom = new TreeOfWisdom();
    }

    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS * 10);  // one for each peer and a few for ourselves
    this.readyPromise = new Promise(resolve => this.once('ready', () => {
      resolve(undefined);
    }));

    if (options?.enableCubePersistence > EnableCubePersitence.OFF) {
      this.persistence = new CubePersistence(options);
      if (options.enableCubePersistence >= EnableCubePersitence.PRIMARY) {
        this.inMemory = false;
        this.storage = new WeakValueMap();  // in-memory cache
      } else {
        this.inMemory = true;
        this.storage = new Map();
      }

      this.persistence.on('ready', async () => {
        logger.trace("cubeStore: received ready event from cubePersistence");
        if (this.inMemory) await this.syncPersistentStorage();
        this.pruneCubes();  // not await-ing as pruning is non-essential
        this.emit("ready");
      });
    } else {
      this.inMemory = true;
      this.storage = new Map();
      this.emit("ready");
    }
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
        try {
          cube = new family.cubeClass(binaryCube, {family: family});
        } catch(err) {
          logger.info(`CubeStore.addCube: Skipping a dormant (binary) Cube as I could not reactivate it, at least not using this CubeFamily setting: ${err?.toString() ?? err}`);
          return undefined;
        }
      } else {  // should never be even possible to happen, and yet, there was this one time when it did
        // @ts-ignore If we end up here, we're well outside any kind of sanity TypeScript can possibly be expected to understand.
        throw new ApiMisuseError("CubeStore: invalid type supplied to addCube: " + cube_input.constructor.name);
      }
      const cubeInfo: CubeInfo = await cube.getCubeInfo();

      if (this.enableCubeRetentionPolicy) { // cube valid for current epoch?
        let res: boolean = shouldRetainCube(
          cubeInfo.keyString, cubeInfo.date,
          cubeInfo.difficulty, getCurrentEpoch());
        if (!res) {
          logger.error(`CubeStore: Cube is not valid for current epoch, discarding.`);
          return undefined;
        }
      }

      // Sometimes we get the same cube twice (e.g. due to network latency).
      // In that case, do nothing -- no need to invalidate the hash or to
      // emit an event.
      if (await this.hasCube(cubeInfo.key) && cubeInfo.cubeType == CubeType.FROZEN) {
        logger.debug('CubeStorage: duplicate - frozen cube already exists');
        return cube;
      }
      if (cube.getDifficulty() < this.required_difficulty) {
        throw new InsufficientDifficulty("CubeStore: Cube does not meet difficulty requirements");
      }
      // If this is a MUC, check if we already have a MUC with this key.
      // Replace it with the incoming MUC if it's newer than the one we have.
      if (cubeInfo.cubeType == CubeType.MUC) {
        if (await this.hasCube(cubeInfo.key)) {
          const storedCube: CubeInfo = await this.getCubeInfo(cubeInfo.key);
          const winningCube: CubeMeta = cubeContest(storedCube, cubeInfo);
          if (winningCube === storedCube) {
            logger.trace('CubeStorage: Keeping stored MUC over incoming MUC');
            return storedCube.getCube();  // TODO: it's completely unnecessary to instantiate the potentially dormant Cube here -- maybe change the addCube() signature once again and not return a Cube object after all?
          } else {
            logger.trace('CubeStorage: Replacing stored MUC with incoming MUC');
          }
        }
      }

      // Store the cube to RAM (or in-memory cache)
      if (this.storage) this.storage.set(cubeInfo.keyString, cubeInfo);
      // save cube to disk (if available and enabled)
      if (this.persistence) {
        await this.persistence.storeCube(cubeInfo.keyString, cubeInfo.binaryCube);
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
      } catch(err) {
        logger.error(`CubeStore: While adding Cube ${cubeInfo.keyString} a cubeAdded subscriber experienced an error: ${err?.toString() ?? err}`);
      }

      // All done finally, just return the cube in case anyone cares.
      return cube;
    } catch (err) {
      logger.error(`CubeStore: Error adding cube: ${err?.toString() ?? err}`);
      return undefined;
    }
  }

  // TODO get rid of this method
  async hasCube(key: CubeKey | string): Promise<boolean> {
    const cubeInfo = await this.getCubeInfo(key);
    if (cubeInfo !== undefined) return true;
    else return false;
  }

  async getNumberOfStoredCubes(): Promise<number> {
    if (this.inMemory) return (this.storage as Map<string, CubeInfo>).size;
    else {
      return (await this.persistence.getAllCubes()).length;  // TODO: is there a more efficient way to do this?
    }
  }

  async getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo> {
    const key = keyVariants(keyInput);
    if (this.inMemory) return this.storage.get(key.keyString);
    else {  // persistence is primary -- get from cache or fetch from persistence
      const cached = this.storage.get(key.keyString);
      if (cached) return cached;
      else {
        const binaryCube: Buffer = await this.persistence.getCube(key.keyString);
        if (binaryCube !== undefined) {
          const cubeInfo = new CubeInfo({
            key: key.binaryKey,
            cube: binaryCube,
            family: this.family,
          });
          this.storage.set(key.keyString, cubeInfo);
          return cubeInfo;
        } else {
          return undefined;
        }
      }
    }
  }
  async getCubeInfos(keys: Iterable<CubeKey | string>): Promise<CubeInfo[]> {
    const cubeInfos: CubeInfo[] = [];
    for (const key of keys) cubeInfos.push(await this.getCubeInfo(key));
    return cubeInfos;
  }

  /**
   * Get a Cube from storage. If the cube is currently dormant, it will
   * automatically get reinstantiated for you.
   * @param key Pass the key of the cube you want in either binary or string form
   * @param parsers If the requested Cube is domant it will need to be
   *        re-parsed. The CubeInfo is supposed to know which parser to use,
   *        but you can override it here if you want.
   */
  async getCube(
      key: CubeKey | string,
      family: CubeFamilyDefinition = undefined,  // undefined = will use CubeInfo's default
    ): Promise<Cube> {
    const cubeInfo: CubeInfo = await this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.getCube(family);
    else return undefined;
  }

  /**
   * Converts all cube keys to actual CubeKeys (i.e. binary buffers).
   * If you're fine with strings, just call this.storage.keys instead, much cheaper.
   */
  // TODO: when persitence is the primary storage, fetch them in larger batches
  // rather than one by one
  async getAllKeys(): Promise<Set<CubeKey>> {
    const ret: Set<CubeKey> = new Set();
    if (this.inMemory) {
      for (const [key, cubeInfo] of this.storage) {
        ret.add(cubeInfo.key);
      }
    } else {
      for (const key of await this.persistence.getAllKeys()) {
        ret.add(Buffer.from(key, 'hex'));
      }
    }
    return ret;
  }

  async getAllKeystrings(): Promise<IterableIterator<string>> {
    if (this.inMemory) return this.storage.keys();
    else return (await this.persistence.getAllKeys()).values();
  }

  // TODO: when persitence is the primary storage, fetch them in larger batches
  // rather than one by one
  async getAllCubeInfo(
    family: CubeFamilyDefinition = this.family,
  ): Promise<IterableIterator<CubeInfo>> {
    if (this.inMemory) return this.storage.values();
    else {
      // TODO: this is not efficient, just keep it an iterable
      // TODO: even worse, DONT INSTANTIATE THE FRICKIN' CUBE
      const binaryCubes: Buffer[] = await this.persistence.getAllCubes();
      const cubeInfos: CubeInfo[] = [];
      for (const binaryCube of binaryCubes) {
        const cube: Cube = new family.cubeClass(binaryCube);
        cubeInfos.push(await cube.getCubeInfo());
      }
      return cubeInfos.values();
    }
  }

  async deleteCube(keyInput: CubeKey | string) {
    const key = keyVariants(keyInput);
    this.storage?.delete(key.keyString);
    this.treeOfWisdom?.delete(key.keyString);
    await this.persistence?.deleteCube(key.keyString);
  }

  async pruneCubes(): Promise<void> {
    if (!this.inMemory) return;  // TODO BUGBUG: make this work in persitent-only mode
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

        if (!shouldRetainCube(cubeInfo.keyString, cubeInfo.date, cubeInfo.difficulty, currentEpoch)) {
          await this.deleteCube(cubeInfo.keyString);
          logger.trace(`CubeStore.pruneCubes(): Pruned cube ${key}`);
        }
      }

      if (index < cubeKeys.length) {
        setTimeout(checkAndPruneCubes, 0);
      } else {
        logger.info(`Completed pruning process.`);
      }
    };

    await checkAndPruneCubes();  // start pruning
  }

  async shutdown(): Promise<void> {
    await this.persistence?.shutdown();
  }

  // This gets called once a persistence object is ready, if both persitent
  // and in-RAM storage are enabled.
  // We will then proceed to store all of our cubes into it,
  // and load all cubes from it.
  private async syncPersistentStorage() {
    if (!this.persistence || !this.inMemory) return;
    for (const rawcube of await this.persistence.getAllCubes()) {
      await this.addCube(Buffer.from(rawcube));
    }
    this.persistence.storeCubes(this.storage as Map<string, CubeInfo>);
  }
}
