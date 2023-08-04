import { Cube } from './cube.js';
import { logger } from './logger.js';
import { EventEmitter } from 'events';


export class CubeStore extends EventEmitter {
  storage: Map<string, Buffer>;
  allHashes: Buffer[] | undefined;

  constructor() {
    super();
    // Maps can't work with Buffers as keys, they would match references,
    // not values. So we store the hashes as hex strings.
    // Maybe we should use a different data structure for this.
    this.storage = new Map();
    this.allHashes = undefined;
  }

  async addCube(cube: Buffer): Promise<Buffer | undefined>;
  async addCube(cube: Cube): Promise<Buffer | undefined>;
  async addCube(cube: Cube | Buffer): Promise<Buffer | undefined> {
      try {
        if (cube instanceof Buffer)
          cube = new Cube(cube);
        const hash: Buffer = await cube.getHash();
        // Sometimes we get the same cube twice (e.g. due to network latency)
        // No need to invalidate the hash or to emit an event
        if (this.storage.has(hash.toString('hex'))) {
          logger.error('CubeStorage: duplicate - cube already exists');
          return hash;
        }
        this.storage.set(hash.toString('hex'), cube.getBinaryData());
        this.allHashes = undefined;
        this.emit('hashAdded', hash);
        return hash;
      } catch (e) {
        if (e instanceof Error) {
          logger.error('Error adding cube:' + e.message);
        } else {
          logger.error('Error adding cube:' + e);
        }
        return undefined;
      }
  }

  getCube(hash: Buffer): Cube | undefined {
    const cube = this.storage.get(hash.toString('hex'));

    if (cube) {
      return new Cube(cube);
    }

    return undefined;
  }

  hasCube(hash: Buffer): boolean {
    return this.storage.has(hash.toString('hex'));
  }

  getCubeRaw(hash: Buffer): Buffer | undefined {
    return this.storage.get(hash.toString('hex'));
  }

  getAllHashes(): Buffer[] {
    if (this.allHashes) {
      return this.allHashes;
    }
    this.allHashes = Array.from(this.storage.keys()).map(hash => Buffer.from(hash, 'hex'));
    return this.allHashes;
  }

}
