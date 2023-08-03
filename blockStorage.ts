import { Block } from './block';
import { logger } from './logger';
import { EventEmitter } from 'events';


export class BlockStorage extends EventEmitter {
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

  async addBlock(block: Buffer): Promise<Buffer | undefined>;
  async addBlock(block: Block): Promise<Buffer | undefined>;
  async addBlock(block: Block | Buffer): Promise<Buffer | undefined> {
      try {
        if (block instanceof Buffer)
          block = new Block(block);
        const hash: Buffer = await block.getHash();
        // Sometimes we get the same block twice (e.g. due to network latency)
        // No need to invalidate the hash or to emit an event
        if (this.storage.has(hash.toString('hex'))) {
          logger.error('BlockStorage: duplicate - block already exists');
          return hash;
        }
        this.storage.set(hash.toString('hex'), block.getBinaryData());
        this.allHashes = undefined;
        this.emit('hashAdded', hash);
        return hash;
      } catch (e) {
        if (e instanceof Error) {
          logger.error('Error adding block:' + e.message);
        } else {
          logger.error('Error adding block:' + e);
        }
        return undefined;
      }
  }

  getBlock(hash: Buffer): Block | undefined {
    const block = this.storage.get(hash.toString('hex'));

    if (block) {
      return new Block(block);
    }

    return undefined;
  }

  hasBlock(hash: Buffer): boolean {
    return this.storage.has(hash.toString('hex'));
  }

  getBlockRaw(hash: Buffer): Buffer | undefined {
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
