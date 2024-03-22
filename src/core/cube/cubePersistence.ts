// cubePersistence.ts
import { CubeInfo } from './cubeInfo';
import { EventEmitter } from 'events';
import { VerityError } from "../settings";

import { logger } from '../logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Buffer } from 'buffer';
import { Level } from 'level';

const CUBEDB_VERSION = 3;
// TODO: If we find random data in the database that doesn't parse as a cube, we should delete it.

// Will emit a ready event once available
export class CubePersistence extends EventEmitter {
  private db: Level<string, Buffer>

  constructor() {
    super();
    let dbname: string;
    if (isBrowser || isWebWorker) dbname = "cubes";
    else dbname = "./cubes.db";
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
      this.storeRawCube(key, cubeInfo.binaryCube)
    }
  }

  storeRawCube(key: string, rawcube: Buffer): Promise<void> {
    // TODO: This is an asynchronous storage operation, because just about
    // every damn thing in this language is asynchronous.
    // Handle the result event some time, maybe... or don't, whatever.
    if (this.db.status != 'open') return;
    // logger.trace("cubePersistent: Storing cube " + key);
    return this.db.put(key, rawcube);
  }

  // Creates an asynchronous request for all raw cubes.
  requestRawCubes(options = {}): Promise<Array<Buffer>> {
    if (this.db.status != 'open') return;
    return this.db.values(options).all();
  }

/**
   * Deletes a cube from persistent storage based on its key.
   * @param {string} key The key of the cube to be deleted.
   * @returns {Promise<void>} A promise that resolves when the cube is deleted, or rejects with an error.
   */
  async deleteRawCube(key: string): Promise<void> {
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
}

// Exception classes
class PersistenceError extends VerityError { name = "PersistenceError" }