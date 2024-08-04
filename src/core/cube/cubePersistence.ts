// cubePersistence.ts
import { CubeInfo } from './cubeInfo';
import { EventEmitter } from 'events';
import { Settings, VerityError } from "../settings";

import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { Level } from 'level';

const CUBEDB_VERSION = 3;
// maybe TODO: If we find random data in the database that doesn't parse as a cube, should we delete it?

export interface CubePersistenceOptions {
  dbName?: string;
}

// Will emit a ready event once available
export class CubePersistence extends EventEmitter {
  private db: Level<string, Buffer>

  constructor(options?: CubePersistenceOptions) {
    super();
    // Set database name, add .db file extension for non-browser environments
    let dbname: string = options?.dbName ?? Settings.CUBE_PERSISTENCE_DB_NAME;
    if (!isBrowser && !isWebWorker) dbname += ".db";
    // open the database
    this.db = new Level<string, Buffer>(
      dbname,
      {
        valueEncoding: 'buffer',
        version: CUBEDB_VERSION
      });
    this.db.open().then(() => {
      this.emit('ready');
    }).catch((error) => {
      logger.error("cubePersistence: Could not open DB: " + error);
    });
  }

  storeCubes(data: Map<string, CubeInfo>) {
    if (this.db.status != 'open') return;
    for (const [key, cubeInfo] of data) {
      this.storeCube(key, cubeInfo.binaryCube)
    }
  }

  storeCube(key: string, cube: Buffer): Promise<void> {
    if (this.db.status !== 'open') {
      logger.warn("cubePersistence: Attempt to store cube in a closed DB");
      return Promise.resolve();
    }
    
    return this.db.put(key, cube)
      .then(() => {
        logger.trace(`cubePersistence: Successfully stored cube ${key}`);
      })
      .catch((error) => {
        logger.error(`cubePersistence: Failed to store cube ${key}: ${error}`);
        throw new PersistenceError(`Failed to store cube ${key}: ${error}`);
      });
  }

  getCube(key: string): Promise<Buffer> {
    return this.db.get(key)
      .then(ret => {
        //logger.trace(`CubePersistence.getCube() fetched binary Cube ${key}`);
        return ret;
      })
      .catch(error => {
        logger.debug(`CubePersistance.getCube(): Cannot find Cube ${key}, error status ${error.status} ${error.code}, ${error.message}`);
        return undefined;
      });
  }

  async *getAllKeys(options = {}): AsyncGenerator<string> {
    logger.warn("CubePersistence:getAllKeys() is deprecated");
    if (this.db.status != 'open') return undefined;
    const allKeys = this.db.keys(options);
    let key: string;
    while (key = await allKeys.next()) yield key;
  }

  // Creates an asynchronous request for all raw cubes.
  // TODO: return an iterable instead
  async *getAllCubes(options = {}): AsyncGenerator<Buffer> {
    logger.warn("CubePersistence:getAllCubes() is deprecated");
    if (this.db.status != 'open') return [];
    const allCubes = this.db.values(options);
    let binaryCube: Buffer;
    while (binaryCube = await allCubes.next()) yield binaryCube;
  }

  /**
   * Get a specified number of keys succeeding a given input key.
   * @param startKey The key to start from (exclusive).
   * @param count The number of keys to retrieve.
   * @returns An array of keys succeeding the input key.
   */
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
   * Deletes a cube from persistent storage based on its key.
   * @param {string} key The key of the cube to be deleted.
   * @returns {Promise<void>} A promise that resolves when the cube is deleted, or rejects with an error.
   */
  async deleteCube(key: string): Promise<void> {
    if (this.db.status !== 'open') {
      logger.error("cubePersistence: Attempt to delete cube in a closed DB");
      throw new PersistenceError("DB is not open");
    }

    try {
      await this.db.del(key);
      logger.info(`cubePersistence: Successfully deleted cube with key ${key}`);
    } catch (error) {
      logger.error(`cubePersistence: Failed to delete cube with key ${key}: ${error}`);
    }
  }

   /**
   * Get the key at the specified position in the database.
   * @param position The position of the key to retrieve.
   * @returns A promise that resolves with the key at the specified position.
   */
   async getKeyAtPosition(position: number): Promise<string> {
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

  async shutdown(): Promise<void> {
    await this.db.close();
  }
}

// Exception classes
class PersistenceError extends VerityError { name = "PersistenceError" }
