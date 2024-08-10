// cubePersistence.ts
import { CubeInfo } from './cubeInfo';
import { EventEmitter } from 'events';
import { Settings, VerityError } from "../settings";

import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { KeyIteratorOptions, Level, ValueIteratorOptions } from 'level';
import { CubeKey } from './cube.definitions';
import { CubeIteratorOptions } from './cubeStore';
import { keyVariants } from './cubeUtil';

const CUBEDB_VERSION = 3;
// maybe TODO: If we find random data in the database that doesn't parse as a cube, should we delete it?

export interface CubePersistenceOptions {
  dbName?: string;
}

// Will emit a ready event once available
export class CubePersistence extends EventEmitter {
  private db: Level<CubeKey, Buffer>

  constructor(options?: CubePersistenceOptions) {
    super();
    // Set database name, add .db file extension for non-browser environments
    let dbname: string = options?.dbName ?? Settings.CUBE_PERSISTENCE_DB_NAME;
    if (!isBrowser && !isWebWorker) dbname += ".db";
    // open the database
    this.db = new Level<CubeKey, Buffer>(
      dbname,
      {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
        version: CUBEDB_VERSION
      });
    this.db.open().then(() => {
      this.emit('ready');
    }).catch((error) => {
      logger.error("cubePersistence: Could not open DB: " + error);
    });
  }

  storeCube(key: CubeKey, cube: Buffer): Promise<void> {
    if (this.db.status !== 'open') {
      logger.warn("cubePersistence: Attempt to store cube in a closed DB");
      return Promise.resolve();
    }

    return this.db.put(key, cube)
      .then(() => {
        logger.trace(`cubePersistence: Successfully stored cube ${keyVariants(key).keyString}`);
      })
      .catch((error) => {
        logger.error(`cubePersistence: Failed to store cube ${keyVariants(key).keyString}: ${error}`);
        throw new PersistenceError(`Failed to store cube ${keyVariants(key).keyString}: ${error}`);
      });
  }

  getCube(key: CubeKey): Promise<Buffer> {
    return this.db.get(key)
      .then(ret => {
        //logger.trace(`CubePersistence.getCube() fetched binary Cube ${keyVariants(key).keyString}`);
        return ret;
      })
      .catch(error => {
        logger.debug(`CubePersistance.getCube(): Cannot find Cube ${keyVariants(key).keyString}, error status ${error.status} ${error.code}, ${error.message}`);
        return undefined;
      });
  }

  /**
   * Asynchroneously retrieve multiple Cube keys from the database.
   * Note that you always need to provide a meaningful option object, as otherwise
   * you will just get the first 1000 Cubes from the database.
   * @param options see getCubeRange()
   */
  async *getKeyRange(
      options: CubeIteratorOptions = {},
  ): AsyncGenerator<CubeKey> {
      // normalize input: keys are binary in LevelDB
      // Note! Unused options must be unset, not set to undefined.
      // Level just breaks when you set a limit of undefined and returns nothing.
      const optionsNormalised: KeyIteratorOptions<CubeKey> = {};
      if (options.gt) optionsNormalised.gt = keyVariants(options.gt).binaryKey;
      if (options.gte) optionsNormalised.gte = keyVariants(options.gte).binaryKey;
      if (options.lt) optionsNormalised.lt = keyVariants(options.lt).binaryKey;
      if (options.lte) optionsNormalised.lte = keyVariants(options.lte).binaryKey;
      optionsNormalised.limit = options.limit ?? 1000;
      optionsNormalised.reverse = false;
    if (options.limit > 1000) logger.warn("CubePersistence:getKeys() requesting over 1000 Keys is deprecated. Please fix your application and set a reasonable limit.");

    // return nothing if the DB is not open... not that we have any choice then
    if (this.db.status != 'open') return undefined;  // "Generator has completed"

    // finally, delegate everything this method actually does directly to LevelDB
    yield* this.db.keys(optionsNormalised);
  }

  /**
   * Asynchroneously retrieve multiple binary Cubes from the database.
   * Note that you always need to provide a meaningful option object, as otherwise
   * you will just get the first 1000 Cubes from the database.
   * @param options An object containing filtering and limiting options.
   *   This follows level's iterator options, see their docs for details. In short:
   *   - gt (greater than) or gte (greater than or equal):
   *     Defines at which key to start retrieving.
   *   - lt (less than) or lte (less than or equal):
   *     Defines at which key to stop retrieving.
   *   - reverse (boolean, default: false): Defines the order in which the entries are yielded
   *   - limit (number, default: 1000): Limits the number of Cubes retrieved.
   *     Note that in contrast to level's interface we impose a default limit
   *     of 1000 to prevent accidental CubeStore walks, which can be very slow,
   *     completely impractical and block an application for basically forever.
   */
  async *getCubeRange(
      options: ValueIteratorOptions<CubeKey, Buffer> = {},
  ): AsyncGenerator<Buffer> {
    options.limit ??= 1000;
    if (options.limit > 1000) logger.warn("CubePersistence:getCubes() requesting over 1000 Cubes is deprecated. Please fix your application and set a reasonable limit.");
    if (this.db.status != 'open') return undefined;  // "Generator has completed"
    const allCubes = this.db.values(options);
    let binaryCube: Buffer;
    while (binaryCube = await allCubes.next()) yield binaryCube;
  }

  /**
   * Deletes a cube from persistent storage based on its key.
   * @param {string} key The key of the cube to be deleted.
   * @returns {Promise<void>} A promise that resolves when the cube is deleted, or rejects with an error.
   */
  async deleteCube(key: CubeKey): Promise<void> {
    if (this.db.status !== 'open') {
      logger.error("cubePersistence: Attempt to delete cube in a closed DB");
      throw new PersistenceError("DB is not open");
    }

    try {
      await this.db.del(key);
      logger.info(`cubePersistence: Successfully deleted cube with key ${keyVariants(key).keyString}`);
    } catch (error) {
      logger.error(`cubePersistence: Failed to delete cube with key ${keyVariants(key).keyString}: ${error}`);
    }
  }

   /**
   * Get the key at the specified position in the database.
   * @param position The position of the key to retrieve.
   * @returns A promise that resolves with the key at the specified position.
   */
   async getKeyAtPosition(position: number): Promise<CubeKey> {
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


  async shutdown(): Promise<void> {
    await this.db.close();
  }
}

// Exception classes
class PersistenceError extends VerityError { name = "PersistenceError" }
