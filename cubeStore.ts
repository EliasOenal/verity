import { Cube } from './cube';
import { logger } from './logger';
import { EventEmitter } from 'events';


export class CubeStore extends EventEmitter {
  storage: Map<string, Buffer>;
  allKeys: Buffer[] | undefined;

  constructor() {
    super();
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
        this.emit('hashAdded', key);
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

}
