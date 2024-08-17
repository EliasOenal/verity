// LevelPersistence.ts
import { EventEmitter } from 'events';
import { Settings, VerityError } from "../settings";

import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { KeyIteratorOptions, Level, ValueIteratorOptions } from 'level';
import * as ClassicLevel from 'classic-level'
import { CubeIteratorOptions } from './cubeStore';
import { keyVariants } from './cubeUtil';

// maybe TODO: If we find random data in the database that doesn't parse as a cube, should we delete it?
// ... now that we generalized this Class, any deleting of unparseable Cubes
//     would have to be done in the CubeStore

export interface LevelPersistenceOptions {
  dbName: string;
  dbVersion: number;
}

export class LevelPersistence {
  readonly ready: Promise<void>;
  private db: Level<Buffer, Buffer>

  constructor(readonly options: LevelPersistenceOptions) {
    // Set database name, add .db file extension for non-browser environments
    if (!isBrowser && !isWebWorker) this.options.dbName += ".db";
    // open the database
    this.db = new Level<Buffer, Buffer>(
      this.options.dbName,
      {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
        version: options.dbVersion,
        compression: false, // Cubes are assumed high entropy
        cacheSize: 128 * 1024 * 1024, // 128MB LRU cache
        writeBufferSize: 16 * 1024 * 1024, // 16MB write buffer
        blockRestartInterval: 32, // This compresses keys with common prefixes
        maxFileSize: 16 * 1024 * 1024, // 16MB so the amount of files doesn't get out of hand
        maxOpenFiles: 5000, // This should take us to 80GB of data, we should benchmark it at that point
      });
    this.ready = new Promise<void>((resolve, reject) => {
      this.db.open().then(() => {
        resolve();
      }).catch((error) => {
        logger.error("LevelPersistence: Could not open DB: " + error);
        reject(error);
      });
    });
  }

  store(key: Buffer, value: Buffer): Promise<void> {
    if (this.db.status !== 'open') {
      logger.warn("LevelPersistence: Attempt to store in a closed DB");
      return Promise.resolve();
    }

    return this.db.put(key, value)
      .then(() => {
        logger.trace(`LevelPersistence: Successfully stored ${keyVariants(key).keyString}`);
      })
      .catch((error) => {
        logger.error(`LevelPersistence: Failed to store ${keyVariants(key).keyString}: ${error}`);
        throw new PersistenceError(`Failed to store ${keyVariants(key).keyString}: ${error}`);
      });
  }

  get(key: Buffer): Promise<Buffer> {
    return this.db.get(key)
      .then(ret => {
        //logger.trace(`LevelPersistence.get() fetched ${keyVariants(key).keyString}`);
        return ret;
      })
      .catch(error => {
        logger.debug(`LevelPersistance.get(): Cannot find ${keyVariants(key).keyString}, error status ${error.status} ${error.code}, ${error.message}`);
        return undefined;
      });
  }

  /**
   * Asynchroneously retrieve multiple keys from the database.
   * Note that you always need to provide a meaningful option object, as otherwise
   * you will just get the first 1000 keys from the database.
   * @param options see getValueRange()
   */
  async *getKeyRange(
      options: CubeIteratorOptions = {},
  ): AsyncGenerator<Buffer> {
      // normalize input: keys are binary in LevelDB
      // Note! Unused options must be unset, not set to undefined.
      // Level just breaks when you set a limit of undefined and returns nothing.
      const optionsNormalised: KeyIteratorOptions<Buffer> = {};
      if (options.gt) optionsNormalised.gt = keyVariants(options.gt).binaryKey;
      if (options.gte) optionsNormalised.gte = keyVariants(options.gte).binaryKey;
      if (options.lt) optionsNormalised.lt = keyVariants(options.lt).binaryKey;
      if (options.lte) optionsNormalised.lte = keyVariants(options.lte).binaryKey;
      optionsNormalised.limit = options.limit ?? 1000;
      optionsNormalised.reverse = false;
    if (options.limit > 1000) logger.warn("LevelPersistence:getKeys() requesting over 1000 Keys is deprecated. Please fix your application and set a reasonable limit.");

    // return nothing if the DB is not open... not that we have any choice then
    if (this.db.status != 'open') return undefined;  // "Generator has completed"

    // finally, delegate everything this method actually does directly to LevelDB
    yield* this.db.keys(optionsNormalised);
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
  async *getValueRange(
      options: ValueIteratorOptions<Buffer, Buffer> = {},
  ): AsyncGenerator<Buffer> {
    options.limit ??= 1000;
    if (options.limit > 1000) logger.warn("LevelPersistence:getValueRange() requesting over 1000 values is deprecated. Please fix your application and set a reasonable limit.");
    if (this.db.status != 'open') return undefined;  // "Generator has completed"
    const valGen = this.db.values(options);
    let val: Buffer;
    while (val = await valGen.next()) yield val;
  }

  /**
   * Deletes an entry from persistent storage based on its key.
   * @param {string} key The key of the entry to be deleted.
   * @returns {Promise<void>} A promise that resolves when the entry is deleted, or rejects with an error.
   */
  async delete(key: Buffer): Promise<void> {
    if (this.db.status !== 'open') {
      logger.error("LevelPersistence: Attempt to delete in a closed DB");
      throw new PersistenceError("DB is not open");
    }

    try {
      await this.db.del(key);
      logger.info(`LevelPersistence: Successfully deleted entry with key ${keyVariants(key).keyString}`);
    } catch (error) {
      logger.error(`LevelPersistence: Failed to delete entry with key ${keyVariants(key).keyString}: ${error}`);
    }
  }

   /**
   * Get the key at the specified position in the database.
   * @param position The position of the key to retrieve.
   * @returns A promise that resolves with the key at the specified position.
   */
   async getKeyAtPosition(position: number): Promise<Buffer> {
    if (this.db.status !== 'open') {
      throw new PersistenceError("DB is not open");
    }

    let count = 0;
    const iterator = this.db.iterator({
      keys: true,
      values: false
    });

    try {
      for await (const [key] of iterator) {
        if (count === position) {
          return key;
        }
        count++;
      }
      throw new PersistenceError(`Position ${position} is out of bounds`);
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
   */
  // TODO: Given that keys are stored sorted in LevelDB, we should be able
  // to get rid of this method and use getKeyRange instead
  // (which should be O(log n) instead of O(n)).
  async getSucceedingKeys(startKey: string, count: number): Promise<string[]> {
    if (this.db.status !== 'open') {
      throw new PersistenceError("DB is not open");
    }

    const keys: string[] = [];
    let iterator = this.db.iterator({
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
      throw new PersistenceError(`Failed to retrieve succeeding keys: ${error}`);
    }

    // If we haven't collected enough keys, wrap around to the beginning
    if (keys.length < count) {
      iterator = this.db.iterator({
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
        throw new PersistenceError(`Failed to retrieve wrapped-around keys: ${error}`);
      }
    }

    return keys;
  }

  /**
   * Get the approximate size of the database.
   * @returns A promise that resolves with the approximate size of the database.
   */
  async approximateSize(): Promise<number> {
    if (this.db.status !== "open") {
      throw new PersistenceError("DB is not open");
    }

    if(isNode) {
      // Cast the db object to ClassicLevel
      const classicDb = this.db as ClassicLevel.ClassicLevel<Buffer,Buffer>;

      try {
        // Use a range that encompasses all possible keys
        const size = await classicDb.approximateSize(Buffer.from([0x00]), Buffer.alloc(64, 0xff));
        return size;
      } catch (error) {
        throw new PersistenceError(`Failed to get key count: ${error}`);
      }
    }
    else
    {
      // Not implemented
      return -1;
    }
  }

  async shutdown(): Promise<void> {
    await this.db.close();
  }
}

// Exception classes
class PersistenceError extends VerityError { name = "PersistenceError" }
