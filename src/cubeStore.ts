import { Cube } from './cube';
import { logger } from './logger';
import { CubePersistence } from "./cubePersistence";
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

export class CubeStore extends EventEmitter {
  storage: Map<string, Buffer>;
  allKeys: Buffer[] | undefined;
  persistence: CubePersistence = undefined;

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
        this.storage.set(key.toString('hex'), cube.getBinaryData());
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
      return new Cube(cube);
    }

    return undefined;
  }

  hasCube(key: Buffer): boolean {
    return this.storage.has(key.toString('hex'));
  }

  getCubeRaw(key: Buffer): Buffer | undefined {
    return this.storage.get(key.toString('hex'));
  }

  getAllHashes(): Buffer[] {
    if (this.allKeys) {
      return this.allKeys;
    }
    this.allKeys = Array.from(this.storage.keys()).map(key => Buffer.from(key, 'hex'));
    return this.allKeys;
  }

  // This gets called once a persistence object is ready.
  // We will then proceed to store all of our cubes into it,
  // and load all cubes from it.
  // TODO: Move indexedDB specific code into cubePersistence or subclass thereof
  private syncPersistentStorage() {
    if (!this.persistence) return;
    this.persistence.requestRawCubes().onsuccess = (event) => {
      const retrieved = (event.target as IDBRequest).result;
      for (const rawcube of retrieved.values()) {
        this.addCube(Buffer.from(rawcube));
      }
    }
    this.persistence.storeRawCubes(this.storage);
  }

}
