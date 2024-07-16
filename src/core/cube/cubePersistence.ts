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

  async getCube(key: string): Promise<Buffer> {
    try {
      const ret = await this.db.get(key);
      logger.trace(`CubePersistence.getCube() fetched binary Cube ${key}`);
      return ret;
    } catch (error) {
      logger.trace(`CubePersistance.getCube(): Cannot find Cube ${key}, error status ${error.status} ${error.code}, ${error.message}`);
      return undefined;
    }
  }

  async *getAllKeys(options = {}): AsyncGenerator<string> {
    if (this.db.status != 'open') return undefined;
    const allKeys = this.db.keys(options);
    let key: string;
    while (key = await allKeys.next()) yield key;
  }

  // Creates an asynchronous request for all raw cubes.
  // TODO: return an iterable instead
  async *getAllCubes(options = {}): AsyncGenerator<Buffer> {
    if (this.db.status != 'open') return [];
    const allCubes = this.db.values(options);
    let binaryCube: Buffer;
    while (binaryCube = await allCubes.next()) yield binaryCube;
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

  async shutdown(): Promise<void> {
    await this.db.close();
  }
}

// Exception classes
class PersistenceError extends VerityError { name = "PersistenceError" }
