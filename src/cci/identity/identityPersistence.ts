import { Identity, IdentityOptions } from './identity';

import { CubeKey } from '../../core/cube/cube.definitions';
import { CubeRetrievalInterface, CubeStore } from '../../core/cube/cubeStore';
import { ensureCci } from '../cube/cciCubeUtil';
import { cciFamily } from '../cube/cciCube';

import { logger } from '../../core/logger';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from 'browser-or-node';
import { Level } from 'level';
import { Buffer } from 'buffer';
import { CubeRetriever } from '../../core/networking/cubeRetrieval/cubeRetriever';

const DEFAULT_DB_NAME = "identity";
const DEFAULT_DB_VERSION = 1;

export interface IdentityPersistenceOptions {
  dbName?: string,
  dbVersion?: number,
}

/**
 * This class is designed to be used in conjunction with Identity and represents
 * it's local persistance layer. To use persistant Identities, pre-construct an
 * IdentityPersistance object and feed it to your Identity objects on
 * construction.
 * An IdentityPersistance object encapsulates a database connection used for
 * storing and retrieving identities.
 */
export class IdentityPersistence {
  private dbName: string;
  private db: Level<string, string>;  // key => JSON-serialized Identity object

  /// @static Use this static method to create IdentityPersistance objects
  /// rather than constructing them yourself.
  /// It's a convenient workaround to abstract from the hazzle that database
  /// operations are async but constructor's aren't allowed to be.
  /// I don't like Javascript.
  static async Construct(
      options?: IdentityOptions | IdentityPersistenceOptions
  ): Promise<IdentityPersistence> {
    const obj = new IdentityPersistence(options);
    await obj.open()
    return obj;
  }

  constructor(readonly options: IdentityOptions & IdentityPersistenceOptions = {}) {
    this.options.dbName = this.options.dbName ?? DEFAULT_DB_NAME;
    this.options.dbVersion = this.options.dbVersion ?? DEFAULT_DB_VERSION;
    this.options.identityPersistence = this;
    if (isBrowser || isWebWorker) this.dbName = options.dbName;
    else this.dbName = "./" + options.dbName + ".db";
    this.db = new Level<string, string>(
      this.dbName,
      {
        keyEncoding: 'utf8',
        valueEncoding: 'utf8',
        version: DEFAULT_DB_VERSION
      });
  }

  /** @method Pseudo-private helper method only used right after construction. */
  async open(): Promise<void> {
    try {
      await this.db.open();
      logger.trace("IdentityPersistance: Opened DB, status now " + this.db.status);
    } catch (error) {
      logger.error("IdentityPersistance: Could not open DB: " + error);
    }
  }

  // TODO: Ensure this does not get called more than once a second, otherwise
  // the updated cube will lose the CubeContest and not actually be stored
  store(id: Identity): Promise<void> {
    if (this.db.status != 'open') {
      logger.error("IdentityPersistance: Could not store identity, DB not open");
      return undefined;
    }
    return this.db.put(
      id.key.toString('hex'),
      id.masterKey.toString('hex')
    );
  }

  /**
   * @returns A list of all locally stored Identites. Note that for this two
   * work, two conditions must be satisfied: The Identities's keys must be
   * present in the local Identity DB and the corresponding Identity MUCs must
   * be present in the local Cube store.
   * This method will *not* retrieve missing MUCs from the network.
   */
  async retrieve(cubeStore: CubeRetrievalInterface<any>): Promise<Identity[]> {
    if (this.db.status != 'open') {
      logger.error("IdentityPersistance: Could not retrieve identity, DB not open");
      return undefined;
    }
    const identities: Array<Identity> = [];
    for await (const [pubkeyString, masterkeyString] of this.db.iterator()) {
      try {
        const masterKey = Buffer.from(masterkeyString, 'hex');
        const muc = ensureCci(
          await cubeStore.getCube(Buffer.from(pubkeyString, 'hex')));
        if (muc === undefined) {
          logger.error("IdentityPersistance: Could not parse and Identity from DB as MUC " + pubkeyString + " is not present");
          continue;
        }
        const id: Identity = await Identity.Construct(
          cubeStore, muc, this.options);
        id.supplyMasterKey(masterKey);
        identities.push(id);
      } catch (error) {
        logger.error("IdentityPersistance: Could not parse an identity from DB: " + error);
      }
    }
    return identities;
  }

  /** Deletes an Identity. Only used for unit testing by now. */
  delete(idkey: CubeKey) {
    this.db.del(idkey.toString('hex'));
  }

  /** Should only really be used by unit tests */
  async deleteAll() {
    for await (const key of this.db.keys()) {
      this.db.del(key);
    }
  }

  /** Closes the DB, which invalidates the object. Should only really be used by unit tests. */
  async close() {
    await this.db.close();
  }
}
