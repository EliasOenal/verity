// cubeStore.ts
import { Settings, VerityError } from '../settings';
import { Cube } from './cube';
import { CubeInfo, CubeMeta } from './cubeInfo'
import { CubePersistence } from "./cubePersistence";
import { CubeType, CubeKey, InsufficientDifficulty } from './cubeDefinitions';
import { UNIX_MS_PER_EPOCH, cubeContest, shouldRetainCube, getCurrentEpoch } from './cubeUtil';
import { TreeOfWisdom } from '../tow';
import { logger } from '../logger';
import { cubeLifetime } from './cubeUtil';

import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

// Note: Once we implement pruning, we need to be able to pin certain cubes
// to prevent them from being pruned. This may be used to preserve cubes
// authored by our local user, for example. Indeed, the social media
// application's Identity implementation relies on having our own posts preserved.

export interface CubeStoreOptions {
  enableCubePersistance?: boolean,
  requiredDifficulty?: number,
}

export class CubeStore extends EventEmitter {
  readyPromise: Promise<any>;

  private storage: Map<string, CubeInfo> = new Map();

  // Refers to the persistant cube storage database, if available and enabled
  private persistence: CubePersistence = undefined;
  // The Tree of Wisdom maps cube keys to their hashes.
  private treeOfWisdom: TreeOfWisdom = undefined;

  public readonly required_difficulty;

  constructor(options: CubeStoreOptions) {
    super();
    this.required_difficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS * 10);  // one for each peer and a few for ourselves
    this.storage = new Map();
    this.treeOfWisdom = new TreeOfWisdom();

    this.readyPromise = new Promise(resolve => this.once('ready', () => {
      resolve(undefined);
    }));

    const enablePersistence = options?.enableCubePersistance ?? true;
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
  async addCube(cube_input: Buffer): Promise<Cube>;
  async addCube(cube_input: Cube): Promise<Cube>;
  async addCube(cube_input: Cube | Buffer): Promise<Cube> {
    try {
      // Cube objects are ephemeral as storing binary data is more efficient.
      // Create cube object if we don't have one yet.
      let binaryCube: Buffer;
      let cube: Cube;
      if (cube_input instanceof Cube) {
        cube = cube_input;
        binaryCube = await cube_input.getBinaryData();
      }
      else if (cube_input instanceof Buffer) { // cube_input instanceof Buffer
        binaryCube = cube_input;
        cube = new Cube(binaryCube);
      } else {  // should never be even possible to happen, and yet, there was this one time when it did
        // @ts-ignore If we end up here, we're well outside any kind of sanity TypeScript can possibly be expected to understand.
        throw new TypeError("CubeStore: invalid type supplied to addCube: " + cube_input.constructor.name);
      }

      const cubeInfo: CubeInfo = await cube.getCubeInfo();

      // Check if cube is valid for current epoch
      let res: boolean = shouldRetainCube(cubeInfo.keystring, cubeInfo.date, cubeInfo.challengeLevel, getCurrentEpoch());
      if (!res) {
        logger.error(`CubeStore: Cube is not valid for current epoch, discarding.`);
        return undefined;
      }

      // Sometimes we get the same cube twice (e.g. due to network latency).
      // In that case, do nothing -- no need to invalidate the hash or to
      // emit an event.
      if (this.hasCube(cubeInfo.key) && cubeInfo.cubeType == CubeType.BASIC) {
        logger.warn('CubeStorage: duplicate - basic cube already exists');
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
            return storedCube.getCube();
          } else {
            logger.info('CubeStorage: Replacing stored MUC with incoming MUC');
          }
        }
      }

      // Store the cube
      this.storage.set(cubeInfo.key.toString('hex'), cubeInfo);
      // save cube to disk (if available and enabled)
      if (this.persistence) {
        this.persistence.storeRawCube(cubeInfo.key.toString('hex'), cubeInfo.binaryCube);
      }
      // add cube to the Tree of Wisdom if enabled
      if (Settings.TREE_OF_WISDOM) {
        let hash: Buffer = await cube.getHash();
        // Truncate hash to 20 bytes, the reasoning is:
        // Our hashes are hardened with a strong hashcash, making attacks much harder.
        // Attacking this (birthday paradox) has a complexity of 2^80, which is not feasible.
        hash = hash.subarray(0, 20);
        this.treeOfWisdom.set(cubeInfo.key.toString('hex'), hash);
      }

      // inform our application(s) about the new cube
      try {
        // logger.trace(`CubeStore: Added cube ${cubeInfo.key.toString('hex')}, emitting cubeAdded`)
        this.emit('cubeAdded', cubeInfo);
      } catch(error) {
        logger.error("CubeStore: While adding Cube " + cubeInfo.key.toString('hex') + "a cubeAdded subscriber experienced an error: " + error.message);
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
  getCube(key: CubeKey | string): Cube | undefined {
    const cubeInfo: CubeInfo = this.getCubeInfo(key);
    if (cubeInfo) return cubeInfo.getCube();
    else return undefined;
  }

  /**
   * Converts all cube keys to actual CubeKeys (i.e. binary buffers).
   * If you're fine with strings, just call this.storage.keys instead, much cheaper.
   */
  getAllStoredCubeKeys(): Set<CubeKey> {
    const ret: Set<CubeKey> = new Set();
    for (const [key, cubeInfo] of this.storage) {
      ret.add(cubeInfo.key);
    }
    return ret;
  }

  // TODO: we can probably get rid of this method now
  getAllStoredCubeMeta(): Set<CubeMeta> {
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
    const currentEpoch = getCurrentEpoch();
    const cubeKeys = Array.from(this.storage.keys());
    let index = 0;

    const checkAndPruneCubes = async () => {
      const batchSize = 50;
      for (let i = 0; i < batchSize && index < cubeKeys.length; i++, index++) {
        const key = cubeKeys[index];
        const cubeInfo = this.storage.get(key);
        if (!cubeInfo) continue;

        if (!shouldRetainCube(cubeInfo.keystring, cubeInfo.date, cubeInfo.challengeLevel, currentEpoch)) {
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

    checkAndPruneCubes();
  }
}
