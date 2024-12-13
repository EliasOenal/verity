// LevelBackend.ts
import { EventEmitter } from 'events';
import { Settings, VerityError } from "../settings";

import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { KeyIteratorOptions, Level, ValueIteratorOptions } from 'level';
import { ClassicLevel } from 'classic-level';
import { MemoryLevel } from 'memory-level';
import { AbstractLevel } from 'abstract-level';
import { CubeIteratorOptions } from './cubeStore';
import { keyVariants } from './cubeUtil';
import { err } from 'cmd-ts/dist/cjs/Result';

// maybe TODO: If we find random data in the database that doesn't parse as a cube, should we delete it?
// ... now that we generalized this Class, any deleting of unparseable Cubes
//     would have to be done in the CubeStore

// Enums for the databases
export enum Sublevels{
  BASE_DB = 0,
  CUBES = 1,
  INDEX_TIME = 2,
  INDEX_DIFF = 3,
}

export interface LevelBackendOptions {
  dbName: string;
  dbVersion: number;
  inMemoryLevelDB: boolean;
}

export class LevelBackend {
  readonly ready: Promise<void>;
  private db: any; // Level or MemoryLevel
  private dbCubes: any;
  private dbNotifyIndexTime: any;
  private dbNotifyIndexDiff: any;

  constructor(readonly options: LevelBackendOptions) {
    let dbOptions: any = undefined;
    if (options.inMemoryLevelDB == true) {
      dbOptions = {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
      };
      this.db = new MemoryLevel<Buffer, Buffer>(dbOptions);
      logger.trace("LevelBackend: Using in-memory LevelDB, data will not be persisted");
    } else {
      // Set database name, add .db file extension for non-browser environments
      if (!isBrowser && !isWebWorker) this.options.dbName += ".db";
      dbOptions = {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
        version: this.options.dbVersion,
        compression: false, // Cubes are assumed high entropy
        cacheSize: 128 * 1024 * 1024, // 128MB LRU cache
        writeBufferSize: 16 * 1024 * 1024, // 16MB write buffer
        blockRestartInterval: 16, // This compresses keys with common prefixes
        maxFileSize: 16 * 1024 * 1024, // 16MB so the amount of files doesn't get out of hand
        maxOpenFiles: 5000, // This should take us to 80GB of data, we should benchmark it at that point
      };
      // open the database
      this.db = new Level<Buffer, Buffer>(this.options.dbName, dbOptions);
      logger.trace("LevelBackend: Using persistent LevelDB, data will be persisted");
    }
    this.dbCubes = this.db.sublevel('cubes', dbOptions);
    this.dbNotifyIndexTime = this.db.sublevel('nIdxTim', dbOptions);
    this.dbNotifyIndexDiff = this.db.sublevel('nIdxDif', dbOptions);

    // Open the main database and all sublevels
    this.ready = new Promise<void>((resolve, reject) => {
      this.db.open()
        .then(() => Promise.all([
          this.dbCubes.open(),
          this.dbNotifyIndexDiff.open(),
          this.dbNotifyIndexTime.open()
        ]))
        .then(() => {
          logger.trace("LevelBackend: DB and sublevels opened successfully");
          resolve();
        })
        .catch((error) => {
          logger.error("LevelBackend: Could not open DB or sublevels: " + error);
          reject(error);
        });
    });
  }

  // Resolve enum to sublevel instance
  private subDB(sublevel: Sublevels): any {
    let subDB: any = undefined;
    switch(sublevel) {
      case Sublevels.BASE_DB:
        subDB = this.db;
        break;
      case Sublevels.CUBES:
        subDB = this.dbCubes;
        break;
      case Sublevels.INDEX_TIME:
        subDB = this.dbNotifyIndexTime;
        break;
      case Sublevels.INDEX_DIFF:
        subDB = this.dbNotifyIndexDiff;
        break;
      default:
        throw new levelBackendError("Invalid sublevel");
    }
    if (subDB.status !== 'open') {
      // logger.error(new Error().stack);
      logger.error("LevelBackend: Attempt to use a closed DB: " + sublevel);
      throw new levelBackendError("DB is not open");
    }
    return subDB;
  }

  /**
   * memory-level does not copy the Buffer, so we need to do it here.
   * Explicitly copy the Buffer to a new Buffer to prevent accidental mutation.
   */
  private ifMemoryLevelCopyBuffer(buffer: Buffer): Buffer {
    if(this.db instanceof MemoryLevel) {
      return Buffer.from(buffer);
    }
    return buffer; // classic-level does not need to copy
  }

  store(sublevel: Sublevels, key: Buffer, value: Buffer): Promise<void> {
    let subDB = this.subDB(sublevel);
    value = this.ifMemoryLevelCopyBuffer(value);
    key = this.ifMemoryLevelCopyBuffer(key);
    return subDB.put(key, value)
      .then(() => {
        // logger.trace(`LevelBackend: Successfully stored ${keyVariants(key).keyString} in sublevel ${Sublevels[sublevel] ?? sublevel}`);
      })
      .catch((error) => {
        logger.error(`LevelBackend: Failed to store ${keyVariants(key).keyString} in sublevel ${Sublevels[sublevel] ?? sublevel}: ${error}`);
        throw new levelBackendError(`Failed to store ${keyVariants(key).keyString} in sublevel ${Sublevels[sublevel] ?? sublevel}: ${error}`);
      });
  }

  get(sublevel: Sublevels, key: Buffer, noLogErr: boolean = false): Promise<Buffer> {
    let subDB = this.subDB(sublevel);
    return subDB.get(key)
      .then(ret => {
        //logger.trace(`LevelBackend.get() fetched ${keyVariants(key).keyString}`);
        ret = this.ifMemoryLevelCopyBuffer(ret);
        return ret;
      })
      .catch(error => {
        if (!noLogErr)
        {
          //logger.trace(new Error().stack);
          logger.trace(`LevelBackend.get(): Cannot find ${keyVariants(key).keyString} in sublevel ${Sublevels[sublevel] ?? sublevel}, error status ${error.status} ${error.code}, ${error.message}`);
        }
        return undefined;
      });
  }

  // Helper generator to copy buffers if needed
  private async *copyBuffers(generator: AsyncGenerator<Buffer>) {
      for await (const key of generator) {
          yield this.ifMemoryLevelCopyBuffer(key);
      }
  }

  /**
   * Asynchroneously retrieve multiple keys from the database.
   * Note that you always need to provide a meaningful option object, as otherwise
   * you will just get the first 1000 keys from the database.
   * @param options see getValueRange()
   */
  async *getKeyRange(sublevel: Sublevels,
      options: CubeIteratorOptions = {},
  ): AsyncGenerator<Buffer> {
    // Normalize input: keys are binary in LevelDB
    const optionsNormalised: KeyIteratorOptions<Buffer> = {};
    if (options.gt) optionsNormalised.gt = keyVariants(options.gt).binaryKey;
    if (options.gte) optionsNormalised.gte = keyVariants(options.gte).binaryKey;
    if (options.lt) optionsNormalised.lt = keyVariants(options.lt).binaryKey;
    if (options.lte) optionsNormalised.lte = keyVariants(options.lte).binaryKey;
    optionsNormalised.limit = options.limit ?? 1000;
    optionsNormalised.reverse = false;

    if (options.limit > 1000) {
        logger.warn("LevelBackend:getKeys() requesting over 1000 Keys is deprecated. Please fix your application and set a reasonable limit.");
    }

    let subDB = this.subDB(sublevel);

    // Use yield* to delegate to the copyBuffers generator
    yield* this.copyBuffers(subDB.keys(optionsNormalised));
  }

  /**
   * Asynchroneously retrieve multiple values from the database.
   * Note that you always need to provide a meaningful option object, as otherwise
   * you will just get the first 1000 values from the database.
   * @param options An object containing filtering and limiting options.
   *   This follows level's iterator options, see their docs for details. In short:
   *   - gt (greater than) or gte (greater than or equal):
   *     Defines at which key to start retrieving.
   *   - lt (less than) or lte (less than or equal):
   *     Defines at which key to stop retrieving.
   *   - reverse (boolean, default: false): Defines the order in which the entries are yielded
   *   - limit (number, default: 1000): Limits the number of values retrieved.
   *     Note that in contrast to level's interface we impose a default limit
   *     of 1000 to prevent accidental full walks, which can be very slow,
   *     completely impractical and block an application for basically forever.
   */
  async *getValueRange(sublevel: Sublevels,
    options: ValueIteratorOptions<Buffer, Buffer> = {},
): AsyncGenerator<Buffer> {
    options.limit ??= 1000;
    if (options.limit > 1000) {
        logger.warn("LevelBackend:getValueRange() requesting over 1000 values is deprecated. Please fix your application and set a reasonable limit.");
    }

    let subDB = this.subDB(sublevel);

    // Use yield* to delegate to the copyBuffers generator
    yield* this.copyBuffers(subDB.values(options));
}

  /**
   * Deletes an entry from persistent storage based on its key.
   * @param {string} key The key of the entry to be deleted.
   * @returns {Promise<void>} A promise that resolves when the entry is deleted, or rejects with an error.
   */
  async delete(sublevel: Sublevels, key: Buffer): Promise<void> {
    let subDB = this.subDB(sublevel);

    try {
      await subDB.del(key);
      logger.info(`LevelBackend: Successfully deleted entry with key ${keyVariants(key).keyString}`);
    } catch (error) {
      logger.error(`LevelBackend: Failed to delete entry with key ${keyVariants(key).keyString}: ${error}`);
    }
  }

   /**
   * Get the key at the specified position in the database.
   * @param position The position of the key to retrieve.
   * @returns A promise that resolves with the key at the specified position.
   */
   async getKeyAtPosition(sublevel: Sublevels, position: number): Promise<Buffer> {
    let subDB = this.subDB(sublevel);

    let count = 0;
    const iterator = subDB.iterator({
      keys: true,
      values: false
    });

    try {
      for await (const [key] of iterator) {
        if (count === position) {
          return this.ifMemoryLevelCopyBuffer(key);
        }
        count++;
      }
      throw new levelBackendError(`Position ${position} is out of bounds`);
    } catch (error) {
      logger.error(`Error retrieving key at position ${position}: ${error}`);
      return undefined;
    }
  }

  /**
   * Get a specified number of keys succeeding a given input key.
   * @param startKey The key to start from (exclusive).
   * @param count The number of keys to retrieve.
   * @returns An array of keys succeeding the input key.
   * @deprecated Given that keys are stored sorted in LevelDB, this method is a duplicate
   *   of getKeyRange() and we should get rid of it. This will also avoid
   *   doing about a thousand array pushes each request which is not efficient.
   */
  async getSucceedingKeys(sublevel: Sublevels, startKey: Buffer, count: number): Promise<Buffer[]> {
    let subDB = this.subDB(sublevel);

    const keys: Buffer[] = [];
    let iterator = subDB.iterator({
      gt: startKey,
      limit: count,
      keys: true,
      values: false
    });

    try {
      for await (const [key] of iterator) {
        keys.push(key);
      }
    } catch (error) {
      logger.error(`Error retrieving succeeding keys: ${error}`);
      throw new levelBackendError(`Failed to retrieve succeeding keys: ${error}`);
    }

    // If we haven't collected enough keys, wrap around to the beginning
    if (keys.length < count) {
      iterator = subDB.iterator({
        limit: count - keys.length,
        keys: true,
        values: false
      });

      try {
        for await (const [key] of iterator) {
          keys.push(key);
          if (keys.length === count) break;
        }
      } catch (error) {
        logger.error(`Error retrieving wrapped-around keys: ${error}`);
        throw new levelBackendError(`Failed to retrieve wrapped-around keys: ${error}`);
      }
    }

    return keys;
  }

  /** Deletes everything. Handle with care. */
  async wipeAll(sublevel: Sublevels): Promise<void> {
    let subDB = this.subDB(sublevel);
    await subDB.clear();
  }

  /**
   * Get the approximate size of the database.
   * @returns A promise that resolves with the approximate size of the database.
   */
  async approximateSize(): Promise<number> {
    if (this.db.status !== "open") {
      throw new levelBackendError("DB is not open");
    }

    if(isNode && this.db instanceof Level) {
      // Cast the db object to ClassicLevel
      const classicDb = this.db as ClassicLevel<Buffer,Buffer>;

      try {
        // Use a range that encompasses all possible keys
        const size = await classicDb.approximateSize(Buffer.from([0x00]), Buffer.alloc(64, 0xff));
        return size;
      } catch (error) {
        throw new levelBackendError(`Failed to get key count: ${error}`);
      }
    }
    else
    {
      // Not implemented
      return -1;
    }
  }

  async shutdown(sublevel: Sublevels): Promise<void> {
    let subDB = this.subDB(sublevel);
    await subDB.close();
  }
}

// Exception classes
class levelBackendError extends VerityError { name = "levelBackendError" }
