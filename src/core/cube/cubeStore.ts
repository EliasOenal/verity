import { Settings, VerityError } from '../settings';
import { Cube } from './cube';
import { CubeInfo, CubeMeta } from './cubeInfo'
import { CubePersistence } from "./cubePersistence";
import { CubeType, CubeKey, InsufficientDifficulty } from './cubeDefinitions';
import { cubeContest } from './cubeUtil';
import { logger } from '../logger';

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

  public readonly required_difficulty;

  constructor(options: CubeStoreOptions) {
    super();
    this.required_difficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY;
    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS * 10);  // one for each peer and a few for ourselves
    this.storage = new Map();

    this.readyPromise = new Promise(resolve => this.once('ready', () => {
      resolve(undefined);
    }));

    const enablePersistence = options?.enableCubePersistance ?? true;
    if (enablePersistence) {
      this.persistence = new CubePersistence();

      this.persistence.on('ready', async () => {
        logger.trace("cubeStore: received ready event from cubePersistence");
        await this.syncPersistentStorage();
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

      // Sometimes we get the same cube twice (e.g. due to network latency).
      // In that case, do nothing -- no need to invalidate the hash or to
      // emit an event.
      if (this.hasCube(cubeInfo.key) && cubeInfo.cubeType == CubeType.BASIC) {
        logger.warn('CubeStorage: duplicate - cube already exists');
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

}
