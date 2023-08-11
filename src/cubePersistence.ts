import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import { Cube } from './cube';
import { logger } from './logger';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { VerityError } from "./config";

// This is a pure indexedDB-based implementation is kinda sorta temporary.
// IndexedDB is browser-specific and we use some strange lib to emulate it on
// NodeJS.
// Let's see how that works.
//
// In any case, as persistence is a big deal and will have very different
// characteristics for full nodes vs light nodes (obviously) as well as between
// browser nodes and nodeJS nodes (as nodeJS nodes will be more likely to be
// long-running, 'server'-like instances) it will probably at some point make
// sense to implement different solutions.
//
// Most probably, we will want to use plain SQLite for NodeJS.
//
// We will probably also want to support different persistence APIs for
// browser-based nodes.
// For example, indexedDB is best but usually requires user consent.
// We will probably want to use a more limited browser persistence API first
// (e.g. local storage, max 10 MB) to provide a seemless out-of-the-box
// experience and ask to user for permission to upgrade to indexedDB later.

// On NodeJS, import a library for indexedDB. On the browser we're good.
let indexedDB: IDBFactory = undefined;
if (isBrowser || isWebWorker) {
  if (window.indexedDB) indexedDB = window.indexedDB;
  else {
    logger.error("cubePersistence: native indexedDB is not available");
  }
}
if (isNode) {
  try {
      indexedDB = require('indexeddb');
      logger.trace("required indexeddb: " + indexedDB);
  } catch(err) {
    logger.error("cubePersistence: indexedDB lib is not available");
  }
}

const CUBEDB_VERSION = 1;

// Will emit a ready event once available
export class CubePersistence extends EventEmitter {
  private db: IDBDatabase = undefined;

  constructor() {
    super();
    if (!indexedDB) {
      logger.trace("cubePersistence: no indexedDB available :(");
      return;
    }
    logger.trace("cubePersistence: constructing...");
    const request = indexedDB.open("Cubes", CUBEDB_VERSION);

    request.onsuccess = (event) => {
      this.db = (event.target as IDBRequest).result;
      this.emit('ready');
    }

    request.onupgradeneeded = (event) => {
      this.db = (event.target as IDBRequest).result;
      this.db.createObjectStore("cubes");
      (event.target as IDBRequest).transaction.oncomplete = (event) => {
        this.emit('ready');
      }
    }

    request.onerror = (event) => {
      logger.error("cubePersistence: Could not open indexedDB: " + event);
    }
  }

  storeRawCubes(data: Map<string, Buffer>) {
    if (!this.db) return;
    const transaction = this.db.transaction(["cubes"], "readwrite");
    const store = transaction.objectStore("cubes");
    for (const [key, rawcube] of data) {
      // TODO: This is an asynchroneous storage operation, because just about
      // every damn thing in this language is asynchroneous.
      // Handle the result event some time, maybe... or don't, whatever.
      store.add(rawcube, key);
      logger.trace("cubePersistent: Storing cube " + key);
    }
  }

  // Creates an asynchroneous request for all raw cubes.
  requestRawCubes() {
    if (!this.db) return;
    const transaction = this.db.transaction(["cubes"]);
    const store = transaction.objectStore("cubes");
    return store.getAll();
  }
}

// Exception classes
class PersistenceError extends VerityError {}