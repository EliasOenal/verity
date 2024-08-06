// cubeStore.ts
import { ApiMisuseError, Settings, VerityError } from "../settings";
import { Cube, coreCubeFamily } from "./cube";
import { CubeInfo, CubeMeta } from "./cubeInfo";
import { CubePersistence, CubePersistenceOptions } from "./cubePersistence";
import { CubeType, CubeKey, InsufficientDifficulty } from "./cube.definitions";
import { CubeFamilyDefinition } from "./cubeFields";
import {
  cubeContest,
  shouldRetainCube,
  getCurrentEpoch,
  keyVariants,
} from "./cubeUtil";
import { TreeOfWisdom } from "../tow";
import { logger } from "../logger";

import { EventEmitter } from "events";
import { WeakValueMap } from "weakref";
import { Buffer } from "buffer";

// TODO: we need to be able to pin certain cubes
// to prevent them from being pruned. This may be used to preserve cubes
// authored by our local user, for example. Indeed, the social media
// application's Identity implementation relies on having our own posts preserved.

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
   * @default Settings.CUBE_PERSISTANCE
   **/
  enableCubePersistence?: EnableCubePersitence;

  /**
   * This option is only relevant if enableCubePersistence is set to PRIMARY.
   * If true, the CubeStore will keep a negative cache of keys that have been
   * checked and found to not exist in the database.
   * @default true
   */
  negativeCache?: boolean;

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

export interface CubeRetrievalInterface {
  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo>;
  getCube(key: CubeKey | string, family?: CubeFamilyDefinition): Promise<Cube>;
}

export class CubeStore extends EventEmitter implements CubeRetrievalInterface {
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
    if (this.persistence) {
      const keys = await this.persistence.getSucceedingKeys(
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
    } else {
      // If no persistence, use in-memory storage
      const cubeInfos: CubeMeta[] = [];
      let foundStart = false;
      for (const [key, cubeInfo] of this.storage) {
        if (foundStart) {
          cubeInfos.push(cubeInfo);
          if (cubeInfos.length === count) {
            break;
          }
        } else if (key === startKey.toString("hex")) {
          foundStart = true;
        }
      }
      // If we haven't collected enough keys, wrap around to the beginning
      if (cubeInfos.length < count) {
        for (const [, cubeInfo] of this.storage) {
          cubeInfos.push(cubeInfo);
          if (cubeInfos.length === count) {
            break;
          }
        }
      }
      return cubeInfos;
    }
  }
  readyPromise: Promise<any>;

  readonly inMemory: boolean;

  /**
   * If this CubeStore is configured to keep Cubes in RAM, this will be where
   * we store them.
   */
  private storage: Map<string, CubeInfo> | WeakValueMap<string, CubeInfo> =
    undefined;

  /** Refers to the persistant cube storage database, if available and enabled */
  private persistence: CubePersistence = undefined;
  /** The Tree of Wisdom maps cube keys to their hashes. */
  private treeOfWisdom: TreeOfWisdom = undefined;

  constructor(readonly options: CubeStoreOptions & CubePersistenceOptions) {
    super();
    // set default options if none specified
    this.options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;
    this.options.family ??= coreCubeFamily;
    this.options.enableCubeRetentionPolicy ??= Settings.CUBE_RETENTION_POLICY;
    this.options.negativeCache ??= true;

    // Configure this CubeStore according to the options specified:
    // Do we want to use a Merckle-Patricia-Trie for efficient full node sync?
    if (options?.enableTreeOfWisdom ?? Settings.TREE_OF_WISDOM) {
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
    // Do we want to keep cubes in RAM, or do we want to use persistent storage?
    if (options?.enableCubePersistence > EnableCubePersitence.OFF) {
      if (options.enableCubePersistence >= EnableCubePersitence.PRIMARY) {
        this.inMemory = false;
        this.storage = new WeakValueMap(); // in-memory cache
      } else {
        this.inMemory = true;
        this.storage = new Map();
      }
      // When using persistent storage, the CubeStore is ready when the
      // persistence layer is ready.
      this.persistence = new CubePersistence(options);
      this.persistence.on("ready", async () => {
        logger.trace(
          "cubeStore: received ready event from cubePersistence, enableCubePersistence is: " +
            options.enableCubePersistence
        );
        if (options.enableCubePersistence === EnableCubePersitence.BACKUP) {
          // For CubeStores configured to keep cubes in RAM but still persist
          // them, we now need to load all Cubes.
          // In all other cases, we do not and should not.
          await this.syncPersistentStorage();
        }
        this.pruneCubes(); // not await-ing as pruning is non-essential
        this.emit("ready");
      });
    } else {
      this.inMemory = true;
      this.storage = new Map();
      // In-memory CubeStores are ready immediately.
      this.emit("ready");
    }
  }

  async getKeyAtPosition(position: number): Promise<CubeKey> {
    if (this.inMemory) {
      let i = 0;
      for (const key of this.storage.keys()) {
        if (i === position) return CubeKey.from(key, "hex");
        i++;
      }
    } else if (this.persistence) {
      let key = await this.persistence.getKeyAtPosition(position)
      if(key)
        return CubeKey.from(key, "hex");
      else
        return undefined;
    }
    return undefined;
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
            `CubeStore.addCube: Skipping a dormant (binary) Cube as I could not reactivate it, at least not using this CubeFamily setting: ${
              err?.toString() ?? err
            }`
          );
          return undefined;
        }
      } else {
        // should never be even possible to happen, and yet, there was this one time when it did
        // @ts-ignore If we end up here, we're well outside any kind of sanity TypeScript can possibly be expected to understand.
        throw new ApiMisuseError("CubeStore: invalid type supplied to addCube: " + cube_input.constructor.name);
      }
      const cubeInfo: CubeInfo = await cube.getCubeInfo();

      if (this.options.enableCubeRetentionPolicy) {
        // cube valid for current epoch?
        let res: boolean = shouldRetainCube(
          cubeInfo.keyString,
          cubeInfo.date,
          cubeInfo.difficulty,
          getCurrentEpoch()
        );
        if (!res) {
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
      if (cubeInfo.cubeType == CubeType.MUC) {
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
      if (this.storage) this.storage.set(cubeInfo.keyString, cubeInfo);
      // save cube to disk (if available and enabled)
      if (this.persistence) {
        await this.persistence.storeCube(
          cubeInfo.keyString,
          cubeInfo.binaryCube
        );
      }
      // add cube to the Tree of Wisdom if enabled
      if (this.treeOfWisdom) {
        let hash: Buffer = await cube.getHash();
        // Truncate hash to 20 bytes, the reasoning is:
        // Our hashes are hardened with a strong hashcash, making attacks much harder.
        // Attacking this (birthday paradox) has a complexity of 2^80, which is not feasible.
        hash = hash.subarray(0, 20);
        this.treeOfWisdom.set(cubeInfo.key.toString("hex"), hash);
      }

      // inform our application(s) about the new cube
      try {
        // logger.trace(`CubeStore: Added cube ${cubeInfo.keystring}, emitting cubeAdded`)
        this.emit("cubeAdded", cubeInfo);
      } catch (err) {
        logger.error(
          `CubeStore: While adding Cube ${
            cubeInfo.keyString
          } a cubeAdded subscriber experienced an error: ${
            err?.toString() ?? err
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
   * Note: For CubeStores working directly with persistent storage, this
   * operation is VERY inefficient and should be avoided.
   */
  async getNumberOfStoredCubes(): Promise<number> {
    if (this.inMemory) return (this.storage as Map<string, CubeInfo>).size;
    else {
      let count = 0;
      for await (const key of this.getAllKeys()) count++;
      return count;
    }
  }

  async getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo> {
    const key = keyVariants(keyInput);
    if (this.inMemory) return this.storage.get(key.keyString);
    else {
      // persistence is primary -- get from cache or fetch from persistence
      const cached = this.storage.get(key.keyString);
      if (cached?.valid) return cached; // positive cache hit
      else if (cached?.valid === false) return undefined; // negative cache hit
      else {
        // cache miss
        const binaryCube: Buffer = await this.persistence.getCube(key.keyString);
        if (binaryCube !== undefined) {
          try {  // could fail e.g. on invalid binary data
            const cubeInfo = new CubeInfo({
              key: key.binaryKey,
              cube: binaryCube,
              family: this.options.family,
            });
            this.storage.set(key.keyString, cubeInfo); // cache it
            return cubeInfo;
          } catch (err) {
            logger.error(`CubeStore.getCubeInfo(): Could not create CubeInfo for Cube ${key.keyString}: ${err?.toString() ?? err}`);
            return undefined;
          }
        } else {
          if (this.options.negativeCache) {  // populate negative cache
            const invalidCubeInfo: CubeInfo = new CubeInfo({ key: key.binaryKey });
            this.storage.set(key.keyString, invalidCubeInfo);
          }
          return undefined;
        }
      }
    }
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
    family: CubeFamilyDefinition = undefined // undefined = will use CubeInfo's default
  ): Promise<Cube> {
    const cubeInfo: CubeInfo = await this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.getCube(family);
    else return undefined;
  }

  /**
   * Converts all cube keys to actual CubeKeys (i.e. binary buffers).
   * If you're fine with strings, just call this.storage.keys instead, much cheaper.
   */
  async *getAllKeys(
    asString: boolean = false
  ): AsyncGenerator<CubeKey | string> {
    if (this.inMemory) {
      for (const [key, cubeInfo] of this.storage) {
        if (asString) yield cubeInfo.keyString;
        else yield cubeInfo.key;
      }
    } else {
      for await (const key of this.persistence.getKeys({ limit: Infinity})) {
        if (asString) yield key;
        else yield keyVariants(key).binaryKey;
      }
    }
  }

  // TODO: when persitence is the primary storage, fetch them in larger batches
  // rather than one by one
  async *getAllCubeInfos(): AsyncGenerator<CubeInfo> {
    if (this.inMemory) {
      for (const cubeInfo of this.storage.values()) yield cubeInfo;
    } else {
      for await (const key of this.getAllKeys(true)) {
        yield await this.getCubeInfo(key);
      }
    }
  }
  // Note: This duplicate getAllCubeInfos(), but AsyncGenerators are still a
  // bit tricky to handle a times. So we're gonna keep this for now.
  async getCubeInfos(keys: Iterable<CubeKey | string>): Promise<CubeInfo[]> {
    const cubeInfos: CubeInfo[] = [];
    for (const key of keys) cubeInfos.push(await this.getCubeInfo(key));
    return cubeInfos;
  }

  async deleteCube(keyInput: CubeKey | string) {
    const key = keyVariants(keyInput);
    this.storage?.delete(key.keyString);
    this.treeOfWisdom?.delete(key.keyString);
    await this.persistence?.deleteCube(key.keyString);
  }

  async pruneCubes(): Promise<void> {
    // TODO test this in persistent-only mode
    if (!this.options.enableCubeRetentionPolicy) return; // feature disabled?
    const currentEpoch = getCurrentEpoch();
    const cubeKeys = [];
    for await (const key of this.getAllKeys()) cubeKeys.push(key); // TODO use async Generator directly instead of copying to Array
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

  async shutdown(): Promise<void> {
    await this.persistence?.shutdown();
  }

  /**
   * Load all persistent cubes into RAM and store all RAM cubes persistently.
   * This is (only) used for CubeStores that are configured to keep cubes in RAM
   * but still persist them; in this case, it will be called upon construction.
   */
  private async syncPersistentStorage() {
    if (!this.persistence || !this.inMemory) return;
    for await (const rawcube of this.persistence.getCubes({ limit: Infinity})) {
      await this.addCube(Buffer.from(rawcube));
    }
    this.persistence.storeCubes(this.storage as Map<string, CubeInfo>);
  }
}
