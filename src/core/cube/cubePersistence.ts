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
    // TODO: This is an asynchronous storage operation, because just about
    // every damn thing in this language is asynchronous.
    // Handle the result event some time, maybe... or don't, whatever.
    if (this.db.status != 'open') return;
    // logger.trace("cubePersistent: Storing cube " + key);
    return this.db.put(key, cube);
  }

  async getCube(key: string): Promise<Buffer> {
    try {
      const ret = await this.db.get(key);
      return ret;
    } catch (error) {
      logger.trace(`CubePersistance.getCube(): Cannot find Cube ${key}, error status ${error.status} ${error.code}, ${error.message}`);
      return undefined;
    }
  }

  getAllKeys(options = {}): Promise<Array<string>> {
    if (this.db.status != 'open') return;
    return this.db.keys(options).all();
  }

  // Creates an asynchronous request for all raw cubes.
  // TODO: return an iterable instead
  getAllCubes(options = {}): Promise<Array<Buffer>> {
    if (this.db.status != 'open') return;
    return this.db.values(options).all();
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