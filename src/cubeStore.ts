import { Cube, CubeInfo } from './cube';
import { logger } from './logger';
import { CubePersistence } from "./cubePersistence";
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

export class CubeStore extends EventEmitter {
  storage: Map<string, CubeInfo>;
  private allKeys: Buffer[] | undefined;
  private allCubeInfos: CubeInfo[] | undefined;
  private persistence: CubePersistence = undefined;

  constructor(enable_persistence: boolean = true) {
    super();
    if (enable_persistence) {
      this.persistence = new CubePersistence();

      // this.persistence.on("ready", this.syncPersistentStorage);
      this.persistence.on('ready', () => {
        logger.trace("cubeStore: received ready event from cubePersistence");
        this.syncPersistentStorage();
      });
    }

    // Maps can't work with Buffers as keys, they would match references,
    // not values. So we store the hashes as hex strings.
    // Maybe we should use a different data structure for this.
    this.storage = new Map();
    this.allKeys = undefined;
  }

  // TODO: implement importing CubeInfo directly
  async addCube(cube: Buffer): Promise<Buffer | undefined>;
  async addCube(cube: Cube): Promise<Buffer | undefined>;
  async addCube(cube: Cube | Buffer): Promise<Buffer | undefined> {
    try {
      if (cube instanceof Buffer)
        cube = new Cube(cube);
      const key: Buffer = await cube.getKey();
      // Sometimes we get the same cube twice (e.g. due to network latency)
      // No need to invalidate the hash or to emit an event
      if (this.storage.has(key.toString('hex'))) {
        logger.error('CubeStorage: duplicate - cube already exists');
        return key;
      }
      this.storage.set(key.toString('hex'), cube.getCubeInfo());
      this.allKeys = undefined;
      if (this.persistence) {
        this.persistence.storeRawCubes(
          new Map([[key.toString('hex'), cube.getBinaryData()]]));
      }
      this.emit('cubeAdded', key);
      return key;
    } catch (e) {
      if (e instanceof Error) {
        logger.error('Error adding cube:' + e.message);
      } else {
        logger.error('Error adding cube:' + e);
      }
      return undefined;
    }
  }

  getCube(key: Buffer): Cube | undefined {
    const cube = this.storage.get(key.toString('hex'));

    if (cube) {
      return new Cube(cube.cubeData);
    }

    return undefined;
  }

  hasCube(key: Buffer): boolean {
    return this.storage.has(key.toString('hex'));
  }

  getCubeRaw(key: Buffer): Buffer | undefined {
    return this.storage.get(key.toString('hex')).cubeData;
  }

  getAllHashes(): Buffer[] {
    if (this.allKeys) {
      return this.allKeys;
    }
    this.allKeys = Array.from(this.storage.keys()).map(key => Buffer.from(key, 'hex'));
    return this.allKeys;
  }

  getAllCubeInfos(): CubeInfo[] {
    if (this.allCubeInfos) {
      return this.allCubeInfos;
    }
    this.allCubeInfos = Array.from(this.storage.values());
    return this.allCubeInfos;
  }

  // This gets called once a persistence object is ready.
  // We will then proceed to store all of our cubes into it,
  // and load all cubes from it.
  private async syncPersistentStorage() {
    if (!this.persistence) return;
    for (const rawcube of await this.persistence.requestRawCubes()) {
      this.addCube(Buffer.from(rawcube));
    }
    this.persistence.storeCubeInfos(this.storage);
  }
}
