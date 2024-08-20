// cubeStore.ts
import { ApiMisuseError, Settings } from "../settings";
import { Cube, coreCubeFamily } from "./cube";
import { CubeInfo, CubeMeta } from "./cubeInfo";
import { LevelBackend, LevelBackendOptions } from "./levelBackend";
import { CubeType, CubeKey, CubeFieldType } from "./cube.definitions";
import { CubeFamilyDefinition } from "./cubeFields";
import { cubeContest, shouldRetainCube, getCurrentEpoch, keyVariants, writePersistentNotificationBlob, parsePersistentNotificationBlob } from "./cubeUtil";
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
   * Save cubes to local storage.
   * @default Settings.CUBE_PERSISTANCE
   **/
  cubeDbName?: string,
  cubeDbVersion?: number,
  notifyDbName?: string,
  notifyDbVersion?: number,
  inMemoryLevelDB?: boolean,

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
  family?: CubeFamilyDefinition;
}

export type CubeIteratorOptions = {
  gt?: CubeKey | string,
  gte?: CubeKey | string,
  lt?: CubeKey | string,
  lte?: CubeKey | string,
  limit?: number,
  asString?: boolean,
  wraparound?: boolean
};

export interface CubeRetrievalInterface {
  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo>;
  getCube(key: CubeKey | string, family?: CubeFamilyDefinition): Promise<Cube>;
}

export class CubeStore extends EventEmitter implements CubeRetrievalInterface {
  readyPromise: Promise<undefined>;
  readonly inMemory: boolean;

  /**
   * If this CubeStore is configured to keep Cubes in RAM, this will be where
   * we store them.
   */
  private cubes: Map<string, CubeInfo> | WeakValueMap<string, CubeInfo>;
  // TODO BUGBUG: I don't think this actually works in case of WeakValueMap
  // because the value is an array that's never referenced anywhere else.
  private notifications: Map<string, CubeInfo[]> | WeakValueMap<string, CubeInfo[]>;

  /** Refers to the persistant cube storage database, if available and enabled */
  private cubePersistence: LevelBackend = undefined;
  private notificationPersistence: LevelBackend = undefined;
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

  constructor(readonly options: CubeStoreOptions) {
    super();
    this.options = options as CubeStoreOptions & LevelBackendOptions;
    // set default options if none specified
    this.options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;
    this.options.family ??= coreCubeFamily;
    this.options.enableCubeRetentionPolicy ??= Settings.CUBE_RETENTION_POLICY;

    // Configure this CubeStore according to the options specified:
    // Do we want to use a Merckle-Patricia-Trie for efficient full node sync?
    if (this.options.enableTreeOfWisdom ?? Settings.TREE_OF_WISDOM) {
      this.treeOfWisdom = new TreeOfWisdom();
    }
    // Increase maximum listeners: one for each peer and a few for ourselves
    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS * 10);
    // provide a nice await-able promise for when this CubeStore is ready
    this.readyPromise = new Promise((resolve) =>
      this.once("ready", () => {
        resolve(undefined);
      })
    );

    // Keep weak references for caching
    this.cubes = new WeakValueMap(); // in-memory cache
    this.notifications = new WeakValueMap(); // in-memory cache

    // When using persistent storage, the CubeStore is ready when the
    // persistence layer is ready.
    this.cubePersistence = new LevelBackend({
      dbName: this.options.cubeDbName ?? Settings.CUBEDB_NAME,
      dbVersion: this.options.cubeDbVersion ?? Settings.CUBEDB_VERSION,
      inMemoryLevelDB: this.options.inMemoryLevelDB ?? true,
    });
    this.notificationPersistence = new LevelBackend({
      dbName: this.options.notifyDbName ?? Settings.NOTIFYDB_NAME,
      dbVersion: this.options.notifyDbVersion ?? Settings.NOTIFYDB_VERSION,
      inMemoryLevelDB: this.options.inMemoryLevelDB ?? true,
    });
    Promise.all(
      [this.cubePersistence.ready, this.notificationPersistence.ready]
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
  async addCube(
    cube_input: Buffer,
    family?: CubeFamilyDefinition
  ): Promise<Cube>;
  /**
   * Add a Cube object to storage.
   * (Note you cannot specify a custom family setting in this variant as the
   * Cube has already been parsed.)
   */
  async addCube(cube_input: Cube): Promise<Cube>;

  // TODO (maybe): implement importing CubeInfo directly
  // TODO (someday): Instead of instantiiating a Cube object, we could optionally
  //  instead implement a limited set of checks directly on binary
  //  to alleviate load, especially on full nodes.
  async addCube(
    cube_input: Cube | Buffer,
    family: CubeFamilyDefinition = this.options.family
  ): Promise<Cube> {
    try {
      // Cube objects are ephemeral as storing binary data is more efficient.
      // Create cube object if we don't have one yet.
      let binaryCube: Buffer;
      let cube: Cube;
      if (cube_input instanceof Cube) {
        cube = cube_input;
        binaryCube = await cube_input.getBinaryData();
      } else if (cube_input instanceof Buffer) {
        // cube_input instanceof Buffer
        binaryCube = cube_input;
        try {
          cube = new family.cubeClass(binaryCube, { family: family });
        } catch (err) {
          logger.info(
            `CubeStore.addCube: Skipping a dormant (binary) Cube as I could not reactivate it, at least not using this CubeFamily setting: ${err?.toString() ?? err
            }`
          );
          return undefined;
        }
      } else {
        // should never be even possible to happen, and yet, there was this one time when it did
        throw new ApiMisuseError("CubeStore: invalid type supplied to addCube: " + (cube_input as unknown)?.constructor?.name);
      }
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

      // Sometimes we get the same cube twice (e.g. due to network latency).
      // In that case, do nothing -- no need to invalidate the hash or to
      // emit an event.
      if (
        (await this.hasCube(cubeInfo.key)) &&
        cubeInfo.cubeType === CubeType.FROZEN
      ) {
        logger.debug(
          `CubeStore.addCube(): skipping frozen Cube ${cubeInfo.keyString} as we already have it.`
        );
        return cube;
      }
      if (cube.getDifficulty() < this.options.requiredDifficulty) {
        logger.debug(
          `CubeStore.addCube(): skipping Cube ${cubeInfo.keyString} due to insufficient difficulty`
        );
        return undefined;
      }
      // If this is a MUC, check if we already have a MUC with this key.
      // Replace it with the incoming MUC if it's newer than the one we have.
      if (cubeInfo.cubeType === CubeType.MUC) {
        if (await this.hasCube(cubeInfo.key)) {
          const storedCube: CubeInfo = await this.getCubeInfo(cubeInfo.key);
          const winningCube: CubeMeta = cubeContest(storedCube, cubeInfo);
          if (winningCube === storedCube) {
            logger.trace("CubeStorage: Keeping stored MUC over incoming MUC");
            return storedCube.getCube(); // TODO: it's completely unnecessary to instantiate the potentially dormant Cube here -- maybe change the addCube() signature once again and not return a Cube object after all?
          } else {
            logger.trace("CubeStorage: Replacing stored MUC with incoming MUC");
          }
        }
      }

      // Store the cube to RAM (or in-memory cache)
      this.cubes.set(cubeInfo.keyString, cubeInfo);
      // save cube to disk (if available and enabled)
      await this.cubePersistence.store(cubeInfo.key, cubeInfo.binaryCube);
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
    const cubeInfo = await this.getCubeInfo(key);
    if (cubeInfo !== undefined) return true;
    else return false;
  }

  /**
   * Get the number of cubes stored in this CubeStore.
   * @deprecated For CubeStores working directly with persistent storage, this
   * operation is very inefficient -- O(n) -- and should be avoided.
   */
  async getNumberOfStoredCubes(): Promise<number> {
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const key of this.getKeyRange({ limit: Infinity })) count++;
    return count;
  }

  async getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo> {
    const key = keyVariants(keyInput);
    // persistence is primary -- get from cache or fetch from persistence
    const cached = this.cubes.get(key.keyString);
    if (cached?.valid)
    {
      this.cacheStatistics.hits++;
      return cached; // positive cache hit
    } 
    else {
      // cache miss
      this.cacheStatistics.misses++;
      const binaryCube: Buffer = await this.cubePersistence.get(key.binaryKey);
      if (binaryCube !== undefined) {
        try {  // could fail e.g. on invalid binary data
          const cubeInfo = new CubeInfo({
            key: key.binaryKey,
            cube: binaryCube,
            family: this.options.family,
          });
          this.cubes.set(key.keyString, cubeInfo); // cache it
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
  async getCube(
    key: CubeKey | string,
    family: CubeFamilyDefinition = undefined // undefined = will use CubeInfo's default
  ): Promise<Cube> {
    const cubeInfo: CubeInfo = await this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.getCube(family);
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

    for await (const key of this.cubePersistence.getKeyRange(options)) {
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
   *   - gt (greater than) or gte (greater than or equal):
   *     Defines at which key to start retrieving.
   *   - lt (less than) or lte (less than or equal):
   *     Defines at which key to stop retrieving.
   *   - limit (number, default: 1000): Limits the number of Cubes retrieved.
   *     Note that in contrast to level's interface we impose a default limit
   *     of 1000 to prevent accidental CubeStore walks, which can be very slow,
   *     completely impractical and block an application for basically forever.
   * Note that the reverse option is currently unsupported!
   */
  async *getCubeInfoRange(
    options: CubeIteratorOptions = {},
  ): AsyncGenerator<CubeInfo> {
    for await (const key of this.getKeyRange({ ...options, asString: true })) {
      yield await this.getCubeInfo(key);
    }
  }

  // TODO: get rid of this method
  // Note: This duplicate getAllCubeInfos(), but AsyncGenerators are still a
  // bit tricky to handle a times.
  /** @deprecated */
  async getCubeInfos(keys: Iterable<CubeKey | string>): Promise<CubeInfo[]> {
    const cubeInfos: CubeInfo[] = [];
    for (const key of keys) cubeInfos.push(await this.getCubeInfo(key));
    return cubeInfos;
  }

  async getKeyAtPosition(position: number): Promise<CubeKey> {
    const key = await this.cubePersistence.getKeyAtPosition(position)
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
   */
  async getSucceedingCubeInfos(
    startKey: CubeKey,
    count: number
  ): Promise<CubeMeta[]> {
    const keys = await this.cubePersistence.getSucceedingKeys(
      startKey.toString("hex"),
      count
    );
    const cubeInfos: CubeMeta[] = [];
    for (const key of keys) {
      const cubeInfo = await this.getCubeInfo(key);
      if (cubeInfo) {
        cubeInfos.push(cubeInfo);
      }
    }
    return cubeInfos;
  }

  async *getNotificationKeys(recipient: Buffer): AsyncGenerator<CubeKey> {
    if (Settings.RUNTIME_ASSERTIONS &&
      recipient?.length !== NetConstants.NOTIFY_SIZE) {
      logger.error(`CubeStore.getNotifications(): Attempt to get notifications for invalid recipient key of size ${recipient?.length}, should be ${NetConstants.NOTIFY_SIZE}; skipping.`);
      return undefined;
    }
    const record: Buffer = await this.notificationPersistence.get(recipient);
    yield *parsePersistentNotificationBlob(record);
  }

  async *getNotificationCubeInfos(recipient: Buffer): AsyncGenerator<CubeInfo> {
    const notificationCubeInfos: CubeInfo[] =
      this.notifications.get(keyVariants(recipient).keyString);
    if (notificationCubeInfos) for (const cubeInfo of notificationCubeInfos) {
      yield cubeInfo;
    }
  }

  async *getNotificationCubes(recipient: Buffer): AsyncGenerator<Cube> {
    for await (const cubeInfo of this.getNotificationCubeInfos(recipient)) {
      yield cubeInfo.getCube();
    }
  }

  /** @deprecated This method is not efficient -- O(n) */
  async getNumberOfNotificationRecipients(): Promise<number> {
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const key of this.notificationPersistence.getKeyRange({ limit: Infinity })) count++;
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
    const recipient: Buffer = cubeInfo?.getCube?.()?.fields?.getFirst?.(
      CubeFieldType.NOTIFY)?.value;
    if (recipient) await this.deleteNotification(recipient, cubeInfo.key);


    // delete Cube from all possible kinds of storage
    this.cubes?.delete(key.keyString);  // in-memory
    this.treeOfWisdom?.delete(key.keyString);  // Merkle-Patricia-Trie
    await this.cubePersistence?.delete(key.binaryKey);  // persistent storage
  }

  async pruneCubes(): Promise<void> {
    // TODO test this in persistent-only mode
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

  /**
   * Ever feel crushed by the weight of all those Cubes on your shoulders?
   * Fancy a more quiet life without Cubes? wipeAll() is the answer.
   * Handle with care.
   */
  async wipeAll(): Promise<void> {
    this.cubes.clear();
    this.notifications.clear();
    await this.cubePersistence?.wipeAll();
    await this.notificationPersistence?.wipeAll();
  }

  private async addNotification(cubeInfo: CubeInfo): Promise<void> {
    const cube: Cube = cubeInfo.getCube();
    // does this Cube even have a notification field?
    const recipient: Buffer = cube.fields.getFirst(CubeFieldType.NOTIFY)?.value;
    if (!recipient) return;
    if (Settings.RUNTIME_ASSERTIONS &&
      recipient?.length !== NetConstants.NOTIFY_SIZE) {
      logger.error(`CubeStore.addNotification(): Cube ${cubeInfo.keyString} has a notify field of invalid size ${recipient?.length}, should be ${NetConstants.NOTIFY_SIZE}; skipping. This should never happen.`);
      return;
    }

    // Always store notifications in memory, as the in-memory store will always be
    // there, either as primary storage or as a cache.
    // There's two possible cases:
    const notificationInfos: CubeInfo[] =
      this.notifications.get(keyVariants(recipient).keyString);
    if (!notificationInfos) {
      // ... this could be the first Cube with this notification key ...
      this.notifications.set(keyVariants(recipient).keyString, [cubeInfo]);
    } else {
      // ... or we already have Cubes with this notification key, in which
      // case we save the new one sorted by key.
      notificationInfos.push(cubeInfo);
      notificationInfos.sort((a, b) => a.key.compare(b.key));
      this.notifications.set(keyVariants(recipient).keyString, notificationInfos);
    }

    // Store the notification to persistent storage if enabled:
    if (this.notificationPersistence) {
      // Fetch existing notification keys for this recipient, if any
      const notificationKeys: CubeKey[] = [];
      for await (const key of this.getNotificationKeys(recipient)) notificationKeys.push(key);
      // add the new notification key to the list
      notificationKeys.push(cubeInfo.key);
      // notifications are sorted by Key
      notificationKeys.sort((a, b) => a.compare(b));
      // craft the persistent notification blob and store it
      const blob: Buffer = writePersistentNotificationBlob(notificationKeys);
      await this.notificationPersistence.store(recipient, blob);
    }
  }

  private async deleteNotification(recipient: Buffer, key: CubeKey): Promise<void> {
    // sanity checks
    if (Settings.RUNTIME_ASSERTIONS &&
      recipient?.length !== NetConstants.NOTIFY_SIZE) {
      logger.error(`CubeStore.deleteNotification(): Attempt to delete notification for invalid recipient key of size ${recipient?.length}, should be ${NetConstants.NOTIFY_SIZE}; skipping.`);
      return;
    }
    // Always delete the notification from memory, as the in-memory store
    // will always be there, either as primary storage or as a cache.
    // First, get the notification list for this recipient
    let inMemoryNotifications: CubeInfo[] =
      this.notifications.get(keyVariants(recipient).keyString);
    if (inMemoryNotifications) {  // only need to do anything if there are notifications
      // Remove the specified notification from the list
      inMemoryNotifications =
        inMemoryNotifications.filter((cubeInfo) => !cubeInfo.key.equals(key));
      // Update the in-memory notification list:
      if (inMemoryNotifications.length === 0) {
        // If there are no more notifications for this recipient, delete the record
        this.notifications.delete(keyVariants(recipient).keyString);
      } else {
        // Otherwise, re-store the updated notification list
        this.notifications.set(keyVariants(recipient).keyString, inMemoryNotifications);
      }
    }

    // Delete the notification from persistent storage, if persistence is enabled
    if (this.notificationPersistence) {
      // Fetch all notifications for this recipient
      let notificationKeys: CubeKey[] = [];
      for await (const key of this.getNotificationKeys(recipient)) notificationKeys.push(key);
      // Remove the specified notification key
      notificationKeys = notificationKeys.filter((cubeKey) => !cubeKey.equals(key));
      if (notificationKeys.length === 0) {
        // if this recipient has no more notifications, delete the record
        this.notificationPersistence.delete(recipient);
      } else {
        // otherwise, re-store the updated notification blob
        const blob: Buffer = writePersistentNotificationBlob(notificationKeys);
        this.notificationPersistence.store(recipient, blob);
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.cubePersistence?.shutdown(),
      this.notificationPersistence?.shutdown(),
    ]);
  }
}
