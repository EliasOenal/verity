import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from 'browser-or-node';
import { CubeKey } from '../model/cube';
import { logger } from '../model/logger';

import { Level } from 'level';
import sodium, { KeyPair } from 'libsodium-wrappers'

const IDENTITYDB_VERSION = 1;


/**
 * @classdesc An identity describes who a user is.
 * We could also just call this "user" or "profile" maybe.
 * An identity is defined by its key pair, and an identity's key (pair) is
 * the only part that's immutable.
 * You should probably never instantiate Identity directly, instead always call
 * Identity.retrieve() instead.
 * Constructing a new identity creates a new cryptographic key pair.
*/
export class Identity {
  private _name: string = undefined;
  private _keys: KeyPair = undefined;

  /// @member Points to first cube in the profile picture continuation chain
  private _profilepic: CubeKey = undefined;

  /// @member The key of the cube containing our private key encrypted with our password
  private _keyBackupCube: CubeKey = undefined;

  persistance: IdentityPersistance = undefined;

  /**
   * @member Get this Identity's key, which equals it's MUC's cube key,
   * which is it's cryptographic public key.
  */
  get key(): CubeKey { return Buffer.from(this.keys.publicKey); }

  get name() { return this._name; }
  set name(val: string) {
    this._name = val;
    if (this.persistance) this.persistance.store(this);
  }

  get keys() { return this._keys; }
  // there is no setter for keys:
  // setting new keys is equivalent with creating a new identity

  get profilepic() { return this._profilepic; }
  set profilepic(val: Buffer) {
    this._profilepic = val;
    if (this.persistance) this.persistance.store(this);
  }
  get keyBackupCube() { return this._keyBackupCube; }
  set keyBackupCube(val: CubeKey) {
    this._keyBackupCube = val;
    if (this.persistance) this.persistance.store(this);
  }


  /// @static This gets you an identity!
  ///         It either retrieves all Identity objects stored in persistant storage,
  ///         or creates a new one if there is none.
  static async retrieve(dbname: string = "identity"): Promise<Identity> {
    const persistance: IdentityPersistance = await IdentityPersistance.create(dbname);
    const ids: Array<Identity> = await persistance.retrieve();
    let id: Identity = undefined;
    if (ids && ids.length) {
      id = ids[0];
    }
    else {
      id = new Identity(persistance);
    }
    return id;
  }

  constructor(persistance: IdentityPersistance = undefined) {
    this.persistance = persistance;
    this._keys = sodium.crypto_sign_keypair();
  }

  /** @method Serialize, used before storing object in persistant storage */
  toJSON() {
    return Object.assign({}, this, {
      name: this.name,
      keytype: this.keys.keyType,
      publickey: Buffer.from(this.keys.publicKey),  // Buffer has its own toJSON
      privatekey: Buffer.from(this.keys.privateKey),
      profilepic: this.profilepic,
      keybackupblock: this.keyBackupCube,
    });
  }

  /** @static Deserialize, used after retrieving from persistant storage */
  static fromJSON(json, persistance: IdentityPersistance = undefined): Identity {
    const obj = Object.create(Identity.prototype);
    return Object.assign(obj, {
        _name: json.name,
        _keys: {
          keyType: json.keytype,
          publicKey: Buffer.from(json.publickey),  // Buffer extends UInt8Array
          privateKey: Buffer.from(json.privatekey),
        },
        _profilepic: json.profilepic,
        _keybackupblock: json.keybackupblock,
        persistance: persistance,
    });
  }
}




/**
 * @classdesc
 * Helper class.
 * IdentityPersistance objects represent a database connection used for
 * storing and retrieving identities.
 * You will not need to deal with this class, Identity will do that for you :)
*/
export class IdentityPersistance {
  private dbname: string;
  private db: Level<string, string>;  // key => JSON-serialized Identity object

  /// @static Use this static method to create IdentityPersistance objects
  /// rather than constructing them yourself.
  /// It's a convenient workaround to abstract from the hazzle that database
  /// operations are async but constructor's aren't allowed to be.
  /// I don't like Javascript.
  static async create(dbname: string = "identity"): Promise<IdentityPersistance> {
    const obj = new IdentityPersistance(dbname);
    await obj.open()
    return obj;
  }

  constructor(dbname: string = "identity") {
    if (isBrowser || isWebWorker) this.dbname = dbname;
    else this.dbname = "./" + dbname + ".db";
    this.db = new Level<string, string>(
      this.dbname,
      {
        valueEncoding: 'json',
        version: IDENTITYDB_VERSION
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

  store(id: Identity): Promise<void> {
    if (this.db.status != 'open') {
      logger.error("IdentityPersistance: Could not store identity, DB not open");
      return undefined;
    }
    return this.db.put(
      id.key.toString('hex'),
      JSON.stringify(id)
    );
  }

  async retrieve(): Promise<Array<Identity>> {
    // if (this.db.status != 'open') {
    //   logger.error("IdentityPersistance: Could not retrieve identity, DB not open");
    //   return undefined;
    // }
    const identities: Array<Identity> = [];
    for await (const json of this.db.values() ) {
      let id: Identity;
      try {
        id = Identity.fromJSON(JSON.parse(json));
        id.persistance = this;
        identities.push(id);
        } catch (error) {
          throw error;
          logger.error("IdentityPersistance: Could not parse an identity from DB");
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
    for await (const key of this.db.keys() ) {
      this.db.del(key);
    }
  }

  /** Closes the DB, which invalidates the object. Should only really be used by unit tests. */
  async close() {
    await this.db.close();
  }
}
