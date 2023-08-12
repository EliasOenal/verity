import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Cube, CubeInfo } from './cube';
import { logger } from './logger';
import { EventEmitter } from 'events';
import { VerityError } from "./config";
import { Buffer } from 'buffer';
import { Level, ValueIteratorOptions } from 'level';
import { AbstractValueIterator } from "abstract-level";
import { CubeDataset } from "./cubeStore";

const CUBEDB_VERSION = 3;

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
      logger.error("cubePersistence: Could not open indexedDB: " + error);
    });
  }

  storeRawCubes(data: Map<string, CubeDataset>) {
    if (this.db.status != 'open') return;
    for (const [key, dataset] of data) {
      this.storeRawCube(key, dataset.cubeInfo.cubeData)
    }
  }

  storeCubeInfos(data: Map<string, CubeInfo>) {
    if (this.db.status != 'open') return;
    for (const [key, rawcube] of data) {
      this.storeRawCube(key, rawcube.cubeData)
    }
  }
  storeRawCube(key: string, rawcube: Buffer): Promise<void> {
    // TODO: This is an asynchroneous storage operation, because just about
    // every damn thing in this language is asynchroneous.
    // Handle the result event some time, maybe... or don't, whatever.
    if (this.db.status != 'open') return;
    logger.trace("cubePersistent: Storing cube " + key);
    return this.db.put(key, rawcube);
  }

  // Creates an asynchroneous request for all raw cubes.
  requestRawCubes(options = {}): Promise<Array<Buffer>> {
    if (this.db.status != 'open') return;
    return this.db.values(options).all();
  }
}

// Exception classes
class PersistenceError extends VerityError { }