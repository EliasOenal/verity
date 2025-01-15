// cubeStore.ts
import { ApiMisuseError, Settings } from "../settings";
import { Cube, coreCubeFamily } from "./cube";
import { CubeInfo } from "./cubeInfo";
import { LevelBackend, LevelBackendOptions, Sublevels } from "./levelBackend";
import { CubeType, CubeKey, CubeFieldType } from "./cube.definitions";
import { CubeFamilyDefinition } from "./cubeFields";
import { cubeContest, shouldRetainCube, getCurrentEpoch, keyVariants, activateCube } from "./cubeUtil";
import { TreeOfWisdom } from "../tow";
import { logger } from "../logger";

import { EventEmitter } from "events";
import { WeakValueMap } from "weakref";
import { Buffer } from "buffer";
import { NetConstants } from "../networking/networkDefinitions";

// TODO: we need to be able to pin certain cubes
// to prevent them from being pruned. This may be used to preserve cubes
// authored by our local user, for example. Indeed, the social media
// application's Identity implementation relies on having our own posts preserved.

export interface CubeStoreOptions {
  /**
   * Set a custom name for the Cube LevelDB database.
   * On standalone persistant nodes this is the database file name.
   **/
  dbName?: string,

  /**
   * Set a custom database scheme version number for the LevelDB database.
   * This is usually not required, only use if you know what you're doing.
   */
  dbVersion?: number,

  /**
   * If enabled, Cubes will only be kept in memory and will be lost when
   * the node shuts down.
   */
  inMemory?: boolean,

  /**
   * If enabled, CubeStore will keep a WeakRef cache of all CubeInfos it
   * encounters until the garbage collector come to collect them.
   * This saves unnecessary re-instantiation of Cube objects.
   */
  enableCubeCache?: boolean,

  /**
   * If enabled, do not accept or keep old cubes past their scheduled
   * recycling date. (Pruning not fully implemented yet.)
   * @default Settings.CUBE_RETENTION_POLICY
   */
  enableCubeRetentionPolicy?: boolean;

  /**
   * When enabled, uses a Merckle-Patricia-Trie for efficient full node
   * synchronisation. Do not enable for light nodes.
   * @default Settings.TREE_OF_WISDOM
   */
  enableTreeOfWisdom?: boolean;

  /**
   * Minimum hash cash level required to accept a Cube. Used for spam prevention.
   * Set to 0 to disable entirely (not recommended for prod use).
   * @default Settings.REQUIRED_DIFFICULTY
   */
  requiredDifficulty?: number;

  /**
   * This CubeStore's default CubeFamily, defining how Cubes are parsed.
   * @default coreCubeFamily
   *   Defaults to coreCubeFamily, which only parses the core fields and
   *   ignores any payload. You will obviously want to change this for your
   *   application and set it to either cciCubeFamily or your own custom
   *   CubeFamily definition.
   */
  family?: CubeFamilyDefinition|CubeFamilyDefinition[];
}

export type CubeIteratorOptions = {
  gt?: CubeKey | string,
  gte?: CubeKey | string,
  lt?: CubeKey | string,
  lte?: CubeKey | string,
  limit?: number,
  asString?: boolean,
  wraparound?: boolean,
  reverse?: boolean,
};

/**
 * A generalised interface for objects that can retrieve Cubes.
 * Examples within the core library include CubeStore and CubeRetriever.
 */
export interface CubeRetrievalInterface {
  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo>;
  getCube<cubeClass extends Cube>(key: CubeKey | string, family?: CubeFamilyDefinition): Promise<cubeClass>;
  expectCube(keyInput: CubeKey|string): Promise<CubeInfo>;  // maybe TODO: add timeout?
}

/**
 * CubeEmitter is a generelised interface for objects that can emit CubeInfos.
 * They will also keep track of all emitted Cubes.
 * CubeStore is obviously an example of a CubeEmitter, emitting a CubeInfo
 * whenever a Cube is added to or updated in store.
 */
export interface CubeEmitter extends EventEmitter {
  on(event: 'cubeAdded', listener: (cubeInfo: CubeInfo) => void): this;
  emit(event: 'cubeAdded', cubeInfo: CubeInfo): boolean;

  /**
   * A Generator producing all CubeInfos that have been emitted by this emitter;
   * or would have been emitted if the emitter existed at the appropriate time.
   */
  getAllCubeInfos(): AsyncGenerator<CubeInfo>;
}

export class CubeStore extends EventEmitter implements CubeRetrievalInterface, CubeEmitter {

  readyPromise: Promise<undefined>;

  /**
   * cubesWeakRefCache keeps track of the Cubes that have not been garbage collected yet.
   * This improves performance as we don't have to re-parse Cubes that are still in memory.
   */
  private cubesWeakRefCache: WeakValueMap<string, CubeInfo> | undefined = undefined;

  /** Refers to the persistant cube storage database, if available and enabled */
  private leveldb: LevelBackend = undefined;
  /** The Tree of Wisdom maps cube keys to their hashes. */
  private treeOfWisdom: TreeOfWisdom = undefined;

  // Cache statistics
  private cacheStatistics: {
    hits: number,
    misses: number,
  } = {
    hits: 0,
    misses: 0,
  };

  private shutdownPromiseResolve: () => void;
  shutdownPromise: Promise<void> =
      new Promise(resolve => this.shutdownPromiseResolve = resolve);

  constructor(readonly options: CubeStoreOptions) {
    super();
    // set default options if none specified
    this.options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;
    this.options.family ??= coreCubeFamily;
    this.options.enableCubeRetentionPolicy ??= Settings.CUBE_RETENTION_POLICY;
    this.options.inMemory ??= Settings.CUBESTORE_IN_MEMORY;
    this.options.enableCubeCache ??= Settings.CUBE_CACHE;

    // normalise options
    if (!Array.isArray(this.options.family)) this.options.family = [this.options.family];

    // Configure this CubeStore according to the options specified:
    // Do we want to use a Merckle-Patricia-Trie for efficient full node sync?
    if (this.options.enableTreeOfWisdom ?? Settings.TREE_OF_WISDOM) {
      this.treeOfWisdom = new TreeOfWisdom();
    }
    // Increase maximum listeners: one for each peer and a few for ourselves
    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS * 5);
    // provide a nice await-able promise for when this CubeStore is ready
    this.readyPromise = new Promise((resolve) =>
      this.once("ready", () => {
        resolve(undefined);
      })
    );

    // Keep weak references of all Cubes for caching
    if (this.options.enableCubeCache) {
      this.cubesWeakRefCache = new WeakValueMap(); // in-memory cache
    }

    // The CubeStore is ready when levelDB is ready.
    this.leveldb = new LevelBackend({
      dbName: this.options.dbName ?? Settings.CUBEDB_NAME,
      dbVersion: this.options.dbVersion ?? Settings.CUBEDB_VERSION,
      inMemoryLevelDB: this.options.inMemory,
    });
    Promise.all(
      [this.leveldb.ready]
    ).then(async () => {
      this.pruneCubes(); // not await-ing as pruning is non-essential
      this.emit("ready");
    });
  }

  /**
   * Add a binary Cube to storage.
   * @param parsers defines how this binary Cubes should be parsed.
   * Will use this store's default if not specified, which in turn will use the
   * core-only parsers if you didn't specify anything else on construction.
   * @returns the Cube object that was added to storage, or undefined if it
   *   was not added
   */
  async addCube(cube: Buffer, families?: CubeFamilyDefinition[]): Promise<Cube>;
  /**
   * Add a Cube object to storage.
   * (Note you cannot specify a custom family setting in this variant as the
   * Cube has already been parsed.)
   */
  async addCube(cube: Cube): Promise<Cube>;

  // TODO (maybe): implement importing CubeInfo directly
  // TODO (someday): Instead of instantiiating a Cube object, we could optionally
  //  instead implement a limited set of checks directly on binary
  //  to alleviate load, especially on full nodes.
  async addCube(
    cube_input: Cube | Buffer,
    families: CubeFamilyDefinition[] = this.options.family as CubeFamilyDefinition[]
  ): Promise<Cube> {
    try {
      // Cube objects are ephemeral as storing binary data is more efficient.
      // Create cube object if we don't have one yet.
      let binaryCube: Buffer;
      let cube: Cube = undefined;
      if (cube_input instanceof Cube) {
        cube = cube_input;
        binaryCube = await cube_input.getBinaryData();
      } else if (cube_input instanceof Buffer) {
        cube = activateCube(cube_input, families);  // will log info on failure
      } else {
        // should never be even possible to happen, and yet, there was this one time when it did
        throw new ApiMisuseError("CubeStore: invalid type supplied to addCube: " + (cube_input as unknown)?.constructor?.name);
      }
      if (cube === undefined) return undefined;  // cannot add this Cube

      // Now create the CubeInfo, which is a meta-object containing some core
      // information about the Cube so we don't have to re-instantiate it all
      // the time.
      const cubeInfo: CubeInfo = await cube.getCubeInfo();

      // If ephemeral Cubes are enabled, ensure we only store recent Cubes.
      if (this.options.enableCubeRetentionPolicy) {
        // cube valid for current epoch?
        const current: boolean = shouldRetainCube(
          cubeInfo.keyString,
          cubeInfo.date,
          cubeInfo.difficulty,
          getCurrentEpoch()
        );
        if (!current) {
          logger.error(
            `CubeStore: Cube is not valid for current epoch, discarding.`
          );
          return undefined;
        }
      }

      if (cube.getDifficulty() < this.options.requiredDifficulty) {
        logger.debug(
          `CubeStore.addCube(): skipping Cube ${cubeInfo.keyString} due to insufficient difficulty`
        );
        return undefined;
      }

      // If we already have a Cube of this key, only accept the new one if it
      // wins a CubeContest™ against the old one
      const storedCube: CubeInfo = await this.getCubeInfo(cubeInfo.key, true);
      if (storedCube !== undefined) {
        if (cubeContest(storedCube, cubeInfo) === storedCube) {
          logger.trace(`CubeStorage: Keeping stored ${CubeType[storedCube.cubeType]} over incoming one`);
          return storedCube.getCube(); // TODO: it's completely unnecessary to instantiate the potentially dormant Cube here -- maybe change the addCube() signature once again and not return a Cube object after all?
        } else {
          logger.trace("CubeStorage: Replacing stored MUC with incoming MUC");
        }
      }

      // keep Cube cached in memory until the garbage collector comes for it
      this.cubesWeakRefCache?.set(cubeInfo.keyString, cubeInfo);
      // store Cube
      await this.leveldb.store(Sublevels.CUBES, cubeInfo.key, cubeInfo.binaryCube);
      // add cube to the Tree of Wisdom if enabled
      if (this.treeOfWisdom) {
        let hash: Buffer = await cube.getHash();
        // Truncate hash to 20 bytes, the reasoning is:
        // Our hashes are hardened with a strong hashcash, making attacks much harder.
        // Attacking this (birthday paradox) has a complexity of 2^80, which is not feasible.
        hash = hash.subarray(0, 20);
        this.treeOfWisdom.set(cubeInfo.key.toString("hex"), hash);
      }

      // if this Cube has a notification field, index it
      await this.addNotification(cubeInfo);

      // inform our application(s) about the new cube
      try {
        // logger.trace(`CubeStore: Added cube ${cubeInfo.keystring}, emitting cubeAdded`)
        this.emit("cubeAdded", cubeInfo);
      } catch (err) {
        logger.error(
          `CubeStore: While adding Cube ${cubeInfo.keyString
          } a cubeAdded subscriber experienced an error: ${err?.toString() ?? err
          }`
        );
      }

      // All done finally, just return the cube in case anyone cares.
      return cube;
    } catch (err) {
      logger.error(`CubeStore: Error adding cube: ${err?.toString() ?? err}`);
      return undefined;
    }
  }

  /**
   * Whether or not we have a Cube with the given key.
   * NOTE: This method is really just a convenience wrapper around getCubeInfo().
   * Performance-wise, it does not make any difference whether you just check
   * if we have a Cube or if you actually retrieve it:
   * - If we're an in-memory store, we'll just check our Map either way.
   * - If we're a persistent store, we'll have to fetch the Cube from
   *   persistence either way, and as retrieving from disk is the most expensive
   *   part of that we will also want to create a CubeInfo for it and cache it
   *   just in case somebody asks for it again.
   */
  async hasCube(key: CubeKey | string): Promise<boolean> {
    const cubeInfo = await this.getCubeInfo(key, true);
    if (cubeInfo !== undefined) return true;
    else return false;
  }

  /**
   * Get the number of cubes stored in this CubeStore.
   * @deprecated This operation is inefficient -- O(n) -- and should be avoided.
   */
  async getNumberOfStoredCubes(): Promise<number> {
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const key of this.getKeyRange({ limit: Infinity })) count++;
    return count;
  }

  async getCubeInfo(keyInput: CubeKey | string, noLogErr: boolean = false): Promise<CubeInfo> {
    // input normalisation
    const key = keyVariants(keyInput);
    if (key === undefined) return undefined;
    // get from cache if we have it...
    const cached = this.cubesWeakRefCache?.get(key.keyString);
    if (cached?.valid)
    {
      this.cacheStatistics.hits++;
      return cached; // positive cache hit
    }
    else {  // cache miss
      // ...  or fetch from persistence
      this.cacheStatistics.misses++;
      const binaryCube: Buffer = await this.leveldb.get(Sublevels.CUBES, key.binaryKey, noLogErr);
      if (binaryCube !== undefined) {
        try {  // could fail e.g. on invalid binary data
          const cubeInfo = new CubeInfo({
            key: key.binaryKey,
            cube: binaryCube,
            family: this.options.family,
          });
          this.cubesWeakRefCache?.set(key.keyString, cubeInfo); // cache it
          return cubeInfo;
        } catch (err) {
          logger.error(`CubeStore.getCubeInfo(): Could not create CubeInfo for Cube ${key.keyString}: ${err?.toString() ?? err}`);
          return undefined;
        }
      } else {
        return undefined;
      }
    }
  }

  /**
   * Get a Cube from storage. If the cube is currently dormant, it will
   * automatically get reinstantiated for you.
   * @param key Pass the key of the cube you want in either binary or string form
   * @param parsers If the requested Cube is dormant it will need to be
   *        re-parsed. The CubeInfo is supposed to know which parser to use,
   *        but you can override it here if you want.
   */
  async getCube<cubeClass extends Cube>(
    key: CubeKey | string,
    family: CubeFamilyDefinition|CubeFamilyDefinition[] = undefined // undefined = will use CubeInfo's default
  ): Promise<cubeClass> {
    const cubeInfo: CubeInfo = await this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.getCube<cubeClass>(family);
    else return undefined;
  }

  /**
   * Asynchroneously retrieve multiple succeeding Cube keys.
   * Note that you always need to provide a meaningful option object, as otherwise
   * you will just get the first 1000 Cubes from the database.
   * @param options An object containing filtering and limiting options.
   *   - gt (greater than) or gte (greater than or equal):
   *     Defines at which key to start retrieving.
   *   - lt (less than) or lte (less than or equal):
   *     Defines at which key to stop retrieving.
   *   - limit (number, default: 1000): Limits the number of Cubes retrieved.
   *     Note that in contrast to level's interface we impose a default limit
   *     of 1000 to prevent accidental CubeStore walks, which can be very slow,
   *     completely impractical and block an application for basically forever.
   *   - wraparound: If true, will wrap around to the beginning of the key range
   *     if the end is reached and the limit has not been reached yet.
   *     This only makes sense if you have set a lower bound (gt or gte) and
   *     effectively means that you will first receive all keys matching your
   *     filter and then keys not matching your filter. Note that there is
   *     no further guarantee about the order of keys returned.
   * Note that the reverse option is currently unsupported!
   */
  async *getKeyRange(
    options: CubeIteratorOptions = {},
  ): AsyncGenerator<CubeKey | string> {
    let first: string = undefined;
    let count: number = 0;
    const limit = options.limit ?? 1000;

    for await (const key of this.leveldb.getKeyRange(Sublevels.CUBES, options)) {
      if (count >= limit) break;  // respect limit
      // We will keep track of the first key returned, this is only used
      // in case wraparound is true.
      if (first === undefined) first = keyVariants(key).keyString;
      if (options.asString) {
        yield keyVariants(key).keyString;
      }
      else {
        yield keyVariants(key).binaryKey;
      }
      // Keep track of number of keys returned, break once limit reached
      count++;
    }

    if (  // handle wraparound if requested and output limit not reached
      options.wraparound &&
      (!options.limit || count < options.limit) &&
      // wraparound only makes sense if we filtered anything in the first place
      (options.gt || options.gte) &&
      // forward-iterating wraparound make no sense combined with lower bound
      !options.lt && !options.lte
    ) {
      // If we haven't collected enough keys, wrap around to the beginning
      for await (const key of this.getKeyRange({
        lte: options.gt,  // include everything including just what we skipped before
        lt: options.gte,  // include everything up to but excluding what we started with before
        limit: options.limit,
        asString: options.asString,
        wraparound: false
      })) {
        // even on wraparound we don't want to return the same key twice
        // note: this should never happen as the filtering above should
        // already have taken care of this
        if (keyVariants(key).keyString === first) break;
        // yield key and keep count, break once limit reached
        yield key;
        count++;
        if (count >= limit) break;
      }
    }
  }

  /**
   * Asynchroneously retrieve multiple succeeding CubeInfos.
   * Note that you always need to provide a meaningful option object, as otherwise
   * you will just get the first 1000 Cubes from the database.
   * @param options An object containing filtering and limiting options.
   *   See getKeyRange() for options documentation.
   */
  async *getCubeInfoRange(
    options: CubeIteratorOptions = {},
  ): AsyncGenerator<CubeInfo> {
    for await (const key of this.getKeyRange({ ...options, asString: true })) {
      yield await this.getCubeInfo(key);
    }
  }

  async *getCubeInfos(keys: Iterable<CubeKey | string>): AsyncGenerator<CubeInfo> {
    for (const key of keys) yield this.getCubeInfo(key);
  }

  async *getAllCubeInfos(): AsyncGenerator<CubeInfo> {
    for await (const key of this.getKeyRange()) yield this.getCubeInfo(key);
  }

  async getKeyAtPosition(position: number): Promise<CubeKey> {
    const key = await this.leveldb.getKeyAtPosition(Sublevels.CUBES, position)
    if (key)
      return key;
    else
      return undefined;
  }

  /**
   * Get a specified number of CubeInfos succeeding a given input key.
   * @param startKey The key to start from (exclusive).
   * @param count The number of CubeInfos to retrieve.
   * @returns An array of CubeInfos succeeding the input key.
   * @deprecated Given that keys are stored sorted in LevelDB, this method is a duplicate
   *   of getCubeInfoRange() and we should get rid of it. This will also avoid
   *   doing about a thousand array pushes each request which is not efficient.
   */
  async getSucceedingCubeInfos(
    startKey: CubeKey,
    count: number,
    sublevel: Sublevels = Sublevels.CUBES,
  ): Promise<CubeInfo[]> {
    const keys = await this.leveldb.getSucceedingKeys(sublevel, startKey, count);
    const cubeInfos: CubeInfo[] = [];
    for (let key of keys) {
      if (sublevel !== Sublevels.CUBES) {
        // HACKHACK... TODO niceify
        // Only in the CUBES sublevel ("the main DB") is a key actually a Cube key.
        // All others are just indexing concatenations containing the actual
        // Cube key at the very end.
        key = key.subarray(key.length - NetConstants.CUBE_KEY_SIZE);
      }
      const cubeInfo = await this.getCubeInfo(key);
      if (cubeInfo) {
        cubeInfos.push(cubeInfo);
      }
    }
    return cubeInfos;
  }

  /**
   * Get a specified number of CubeInfos preceding a given input key.
   * @param startKey The key to start from (exclusive).
   * @param count The number of CubeInfos to retrieve.
   * @returns An array of CubeInfos preceding the input key.
   */
  async *getNotificationCubesInTimeRange(
    recipient: Buffer,
    timeFrom: number,
    timeTo: number,
    limit: number = 1000,
    reverse: boolean = false
  ): AsyncGenerator<CubeInfo> {
    if (!recipient || recipient.length !== NetConstants.NOTIFY_SIZE) {
      logger.error('CubeStore.getNotificationCubesInTimeRange(): Invalid recipient buffer.');
      return;
    }

    if (timeFrom > timeTo) {
      logger.error('CubeStore.getNotificationCubesInTimeRange(): Invalid time range.');
      return;
    }

    limit = Math.min(limit, 1000); // Ensure limit doesn't exceed 1000

    const fromBuffer = Buffer.alloc(NetConstants.TIMESTAMP_SIZE);
    fromBuffer.writeUIntBE(timeFrom, 0, NetConstants.TIMESTAMP_SIZE);

    const toBuffer = Buffer.alloc(NetConstants.TIMESTAMP_SIZE);
    toBuffer.writeUIntBE(timeTo, 0, NetConstants.TIMESTAMP_SIZE);

    const iteratorOptions: CubeIteratorOptions = {
      gte: Buffer.concat([recipient, fromBuffer]),
      lte: Buffer.concat([recipient, toBuffer, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0xff)]),
      limit: limit,
      reverse: reverse
    };

    let count = 0;
    for await (const key of this.leveldb.getKeyRange(Sublevels.INDEX_TIME, iteratorOptions)) {
      if (count >= limit) break;

      const cubeKey = key.slice(recipient.length + NetConstants.TIMESTAMP_SIZE);
      const cube = await this.getCubeInfo(cubeKey);
      if (cube) {
        yield cube;
        count++;
      }
    }
  }

  async *getNotificationCubeInfos(recipient: Buffer): AsyncGenerator<CubeInfo> {
    if (!recipient || recipient.length !== NetConstants.NOTIFY_SIZE) {
      logger.error('CubeStore.getNotificationCubeInfos(): Invalid recipient buffer.');
      return;
    }

    // We have CubeStore.NOTIFY_INDEX_PREFIX indices, we iterate the date/timestamp index in this method.
    const maxBuffer = Buffer.alloc(NetConstants.TIMESTAMP_SIZE + NetConstants.CUBE_KEY_SIZE, 0xff);
    const iteratorOptions = {
      gte: Buffer.concat([recipient]),
      lte: Buffer.concat([recipient, maxBuffer]),
    };

    const iterator = this.leveldb.getKeyRange(Sublevels.INDEX_TIME, iteratorOptions);
    for await (const key of iterator) {
        const cubeKey = key.slice(recipient.length + NetConstants.TIMESTAMP_SIZE); // Extract the cube key part, skipping recipient and date
        const cubeInfo = await this.getCubeInfo(cubeKey);
        if (cubeInfo) {
          yield cubeInfo;
      }
    }
  }

  async *getNotificationCubes(recipient: Buffer): AsyncGenerator<Cube> {
    for await (const cubeInfo of this.getNotificationCubeInfos(recipient)) {
      yield cubeInfo.getCube();
    }
  }

  /** @deprecated This method is not efficient -- O(n) */
  async getNumberOfNotificationRecipients(): Promise<number> {
    logger.warn('CubeStore.getNumberOfNotificationRecipients(): This method is deprecated and should be avoided.');
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const key of this.leveldb.getKeyRange(Sublevels.INDEX_TIME, { limit: Infinity })) count++;
    return count;
  }

  async deleteCube(keyInput: CubeKey | string | CubeInfo): Promise<void> {
    // TODO: We currently re-activate the Cube just before deletion
    // just to get any potential notifications. This is not very efficient.
    // It'd make much more sense to parse the binary Cube directly.
    // We could either implement this specifically for this case, or defer
    // till we implement an optimised core-only parser for full nodes.
    let cubeInfo: CubeInfo;
    // normalize input
    if (!(keyInput instanceof CubeInfo)) {
      cubeInfo = await this.getCubeInfo(keyInput);
    }
    // Note: Do not abort if cubeInfo is undefined. This could be caused by
    // a corrupt Cube in store which we still want to delete.
    const key = keyVariants(cubeInfo?.key ?? keyInput as CubeKey);

    // if there are any notifications indexed to this Cube, delete them first
    const recipient: Buffer = cubeInfo?.getCube?.()?.getFirstField?.(
      CubeFieldType.NOTIFY)?.value;
    if (recipient) await this.deleteNotification(cubeInfo);

    // delete Cube from all possible kinds of storage
    this.cubesWeakRefCache?.delete(key.keyString);  // in-memory cache
    this.treeOfWisdom?.delete(key.keyString);  // Merkle-Patricia-Trie
    await this.leveldb?.delete(Sublevels.CUBES, key.binaryKey);  // persistent storage
  }

  async pruneCubes(): Promise<void> {
    // TODO determine if this needs additional tests now that we removed in-memory storage
    if (!this.options.enableCubeRetentionPolicy) return; // feature disabled?
    const currentEpoch = getCurrentEpoch();
    const cubeKeys = [];
    for await (const key of this.getKeyRange({ limit: Infinity })) cubeKeys.push(key); // TODO use async Generator directly instead of copying to Array
    let index = 0;

    // pruning will be performed in batches to prevent main thread lags --
    // prepare batch function
    const checkAndPruneCubes = async () => {
      const batchSize = 50;
      for (let i = 0; i < batchSize && index < cubeKeys.length; i++, index++) {
        const key = cubeKeys[index];
        const cubeInfo = await this.getCubeInfo(key);
        if (!cubeInfo) continue;

        if (
          !shouldRetainCube(
            cubeInfo.keyString,
            cubeInfo.date,
            cubeInfo.difficulty,
            currentEpoch
          )
        ) {
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

    await checkAndPruneCubes(); // start pruning
  }

  // maybe TODO: add timeout?
  expectCube(keyInput: CubeKey|string): Promise<CubeInfo> {
    const key: CubeKey = keyVariants(keyInput).binaryKey;
    let resolve: (cubeInfo: CubeInfo) => void;
    const eventHandler = (cubeInfo: CubeInfo) => {
      if (cubeInfo.key.equals(key)) {
        this.removeListener('cubeAdded', eventHandler);
        resolve(cubeInfo);
      }
    };
    return new Promise(actualResolve => {
      resolve = actualResolve;
      this.on('cubeAdded', (cubeInfo: CubeInfo) => eventHandler(cubeInfo));
    });
  }

  activateCube(binaryCube: Buffer): Cube {
    return activateCube(
      binaryCube, this.options.family as Iterable<CubeFamilyDefinition>);
  }

  /**
   * Ever feel crushed by the weight of all those Cubes on your shoulders?
   * Fancy a more quiet life without Cubes? wipeAll() is the answer.
   * Handle with care.
   */
  async wipeAll(): Promise<void> {
    // first, wipe the cache
    this.cubesWeakRefCache?.clear();
    // then wipe the notification index so nobody we won't have callers
    // retrieving notification keys and then don't finding the associated Cubes
    await this.leveldb?.wipeAll(Sublevels.INDEX_DIFF);
    await this.leveldb?.wipeAll(Sublevels.INDEX_TIME);
    // finallly, wipe Cube storage
    await this.leveldb?.wipeAll(Sublevels.CUBES);
  }

  // Concatenate recipient, timestamp and cube key to create index key #1
  // TODO make static or move to CubeUtil
  private async getNotificationDateKey(cube: Cube): Promise<Buffer> {
    const recipient: Buffer = cube.getFirstField(CubeFieldType.NOTIFY)?.value;
    if (!recipient) return undefined;
    let dateBuffer: Buffer = Buffer.alloc(NetConstants.TIMESTAMP_SIZE);
    dateBuffer.writeUIntBE(cube.getDate(), 0, NetConstants.TIMESTAMP_SIZE);
    return Buffer.concat([recipient, dateBuffer, await cube.getKey()]);
  }

  // Concatenate recipient, difficulty and cube key to create index key #2
  // TODO make static or move to CubeUtil
  private async getNotificationDifficultyKey(cube: Cube): Promise<Buffer> {
    const recipient: Buffer = cube.getFirstField(CubeFieldType.NOTIFY)?.value;
    if (!recipient) return undefined;
    let difficultyBuffer: Buffer = Buffer.alloc(1);
    difficultyBuffer.writeUInt8(cube.getDifficulty());
    return Buffer.concat([recipient, difficultyBuffer, await cube.getKey()]);
  }

  private async addNotification(cubeInfo: CubeInfo): Promise<void> {
    const cube: Cube = cubeInfo.getCube();
    // does this Cube even have a notification field?
    const recipient: Buffer = cube.getFirstField(CubeFieldType.NOTIFY)?.value;
    if (!recipient) return;
    if (Settings.RUNTIME_ASSERTIONS &&
      recipient?.length !== NetConstants.NOTIFY_SIZE) {
      logger.error(`CubeStore.addNotification(): Cube ${cubeInfo.keyString} has a notify field of invalid size ${recipient?.length}, should be ${NetConstants.NOTIFY_SIZE}; skipping. This should never happen.`);
      return;
    }

    let dateIndexKey: Buffer = await this.getNotificationDateKey(cube);
    if(await this.leveldb.get(Sublevels.INDEX_TIME, dateIndexKey, true)) return; // already indexed - levelDB is sequentially consistent
    let difficultyIndexKey: Buffer = await this.getNotificationDifficultyKey(cube);
    // There may not be a need to await this.
    await this.leveldb.store(Sublevels.INDEX_TIME, dateIndexKey, Buffer.alloc(0));
    await this.leveldb.store(Sublevels.INDEX_DIFF, difficultyIndexKey, Buffer.alloc(0));
  }

  private async deleteNotification(cubeInfo: CubeInfo): Promise<void> {
    const cube: Cube = cubeInfo.getCube();
    // does this Cube even have a notification field?
    const recipient: Buffer = cube.getFirstField(CubeFieldType.NOTIFY)?.value;
    if (!recipient) return;
    if (Settings.RUNTIME_ASSERTIONS &&
      recipient?.length !== NetConstants.NOTIFY_SIZE) {
      logger.error(`CubeStore.deleteNotification(): Cube ${cubeInfo.keyString} has a notify field of invalid size ${recipient?.length}, should be ${NetConstants.NOTIFY_SIZE}; skipping. This should never happen.`);
      return;
    }

    let dateIndexKey: Buffer = await this.getNotificationDateKey(cube);
    let difficultyIndexKey: Buffer = await this.getNotificationDifficultyKey(cube);

    // We don't await deletion
    this.leveldb.delete(Sublevels.INDEX_TIME, dateIndexKey);
    this.leveldb.delete(Sublevels.INDEX_DIFF, difficultyIndexKey);
  }

  get getCacheStatistics(): { hits: number, misses: number }
  {
    return this.cacheStatistics;
  }

  shutdown(): Promise<void> {
    const done: Promise<void> = Promise.all([
      this.leveldb?.shutdown(Sublevels.CUBES),
      this.leveldb?.shutdown(Sublevels.INDEX_DIFF),
      this.leveldb?.shutdown(Sublevels.INDEX_TIME),
      this.leveldb?.shutdown(Sublevels.BASE_DB),
    ]) as unknown as Promise<void>;
    done.then(() => this.shutdownPromiseResolve());
    return done;
  }
}
