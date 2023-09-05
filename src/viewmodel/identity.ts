// WIP / BROKEN / NOTHING TO SEE HERE / REFACTORING FIRST / MOVE SOMEWHERE ELSE / WILL YOU CLOSE THIS FILE NOW ALREADY?!?!?!?!

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from 'browser-or-node';
import { Cube, CubeKey } from '../model/cube';
import { logger } from '../model/logger';

import { Level } from 'level';
import sodium, { KeyPair } from 'libsodium-wrappers'
import { Field, Relationship, CubeField, CubeFieldType } from '../model/fields';
import { ZwField, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from './zwFields';
import { CubeError } from '../model/cubeDefinitions';

import { Buffer } from 'buffer';
import { VerityUI } from '../webui/VerityUI';

const IDENTITYDB_VERSION = 1;


/**
 * @classdesc An identity describes who a user is.
 * - We could also just call this a "user" or a "profile" maybe.
 * - Identities can be "local" (representing a user of this node) or "remote"
 *   (representing a different user). The only really difference is that we
 *   obviously don't know the private key for remote Identites and therefore
 *   cannot edit them.
 * - An Identity is represented in the core / network as a Mutable User Cube, or MUC.
 *   Therefore, this class is at least partially just an interface to a MUC.
 * - An identity is defined by its key pair, and an identity's key (pair) is
 *   the only part that's immutable.
 * - You should probably never instantiate Identity directly. Instead always call
 *   Identity.retrieve(), which either gets your existing Identity from persistant
 *   storage or creates a new one for you.
 * - Constructing a new identity creates a new cryptographic key pair.
 *
 * To represent a identities for this application, we use MUCs containing these
 * fields.
 *   - core lib field RELATES_TO type OWNS: Links to a post made by this user.
 *       (These posts itself will contain more RELATES_TO/OWNS fields, building
 *       a kind of linked list of a user's posts.)
 *   - USER_NAME (mandatory, only once): Self-explanatory. UTF-8, maximum 60 bytes.
 *       Note this might be less than 60 chars.
 *   - USER_PROFILEPIC (only once): Links to the first cube of a continuation chain containing
 *       this user's profile picture in JPEG format. Maximum size of three
 *       cubes, i.e. just below 3kB.
 *   - SUBSCRIPTION_RECOMMENDATION: Links to another user's MUC which this user
 *       recommends. (A "recommendation" is a publically visible subscription.)
 *       This is used to build a multi-level web-of-trust. Users can (and are
 *       expected to) only view posts made by their subscribed creators, their
 *       recommended creators, and potentially beyond depending on user settings.
 *       This is to mitigate spam which will be unavoidable due to the uncensorable
 *       nature of Verity. It also segments our users in distinct filter bubbles which has
 *       proven to be one of the most successful features of all social media.
 *   - SUBSCRIPTION_RECOMMENDATION_INDEX: I kinda sorta lied to you.
 *       We usually don't actually put SUBSCRIPTION_RECOMMENDATIONs directly
 *       into the MUC. We could, but we won't.
 *       Even for moderately active users they wouldn't fit.
 *       Instead, we create an IPC (or regular cube until IPCs are implemented),
 *       put the SUBSCRIPTION_RECOMMENDATIONs into the IPC and link the IPC here.
 *       Makes much more sense, doesn't it?
 * We don't require fields to be in any specific order above the core lib requirements.
 *
 * TODO: Specify maximums to make sure all of that nicely fits into a single MUC.
 */
export class Identity {
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
      id = new Identity(undefined, persistance);
    }
    return id;
  }

  /** @member This Identity's display name */
  name: string = undefined;

  /**
   * If this Identity object knows an IdentityPersistant object
   * it can be stored in a local database. If it doesn't... then it can't.
   */
  persistance: IdentityPersistance;

  /** @member The MUC in which this Identity information is stored and published */
  private _muc: Cube = undefined;

  /** @member Points to first cube in the profile picture continuation chain */
  profilepic: CubeKey = undefined;

  /** @member The key of the cube containing our private key encrypted with our password */
  keyBackupCube: CubeKey = undefined;

  posts: Array<CubeKey> = [];
  // TODO add subscription_recommendations

  constructor(muc: Cube = undefined, persistance: IdentityPersistance = undefined) {
    this.persistance = persistance;
    if (muc) this.parseMuc(muc);
    else {  // create new Identity
      let keys: KeyPair = sodium.crypto_sign_keypair();
      muc = Cube.MUC(Buffer.from(keys.publicKey), Buffer.from(keys.privateKey));
    }
    this._muc = muc;
  }

  get privateKey(): Buffer { return this._muc.privateKey; }
  get publicKey(): Buffer { return this._muc.publicKey; }
  // there is no setter for keys:
  // setting new keys is equivalent with creating a new identity
  // (yes, you can reset the keys by going directly to the MUC,
  // just be nice and don't)

  /**
   * @member Get this Identity's key, which equals its MUC's cube key,
   * which is its cryptographic public key.
   * (Yes, I know this is functionally identical with publicKey(), but it's
   * about the semantics :-P )
  */
  get key(): CubeKey { return Buffer.from(this._muc.publicKey); }

  /**
   * Save this Identity locally by storing it in the local database.
   */
  store(): Promise<void> {
    if (this.persistance) return this.persistance.store(this);
    else return undefined;
  }

  /**
  * Compiles this Identity into a MUC for publishing.
  * Make sure to call this after changes have been performed so they
  * will be visible to other users, and make sure to only call it once *all*
  * changes have been performed to avoid spamming multiple MUC versions
  * (and having to compute hashcash for all of them).
  */
  makeMUC(): Cube {
    // TODO: calculate lengths dynamically so we can always cram as much useful
    // information into the MUC as possible.
    // For now, let's just eyeball it... :D
    // After mandatory boilerplate, there's 904 bytes left in a MUC.
    // We use up 163 of those for APPLICATION (3), a potentially maximum length
    // USERNAME (62), and the cube references for PROFILEPIC,
    // KEY_BACKUP_CUBE and SUBSCRIPTION_RECOMMENDATION_INDEX (33 each including header).
    // That leaves 740 bytes. With that we can always safely include 21 posts
    // in MYPOST fields (34 bytes each [32 bytes key, 1 byte header,
    // 1 byte rerelation ship type, 740/34 = 21.76).
    // Hope I didn't miss anything or it will throw my mistake in your face :)

    // Write boilerplate "ZW" application header.
    // We still won't tell you what that stands for.
    const zwFields: ZwFields = new ZwFields(ZwField.Application());

    // Write username
    if (!this.name) throw new CubeError("Identity: Cannot create a MUC for this Identity, name field is mandatory.");
    zwFields.data.push(ZwField.Username(this.name));

    // Write profile picture reference
    if (this.profilepic) zwFields.data.push(ZwField.RelatesTo(
      new Relationship(ZwRelationshipType.PROFILEPIC, this.profilepic)
    ));

    // Write key backup cube reference (not actually implemented yet)
    if (this.keyBackupCube) zwFields.data.push(ZwField.RelatesTo(
      new Relationship(ZwRelationshipType.KEY_BACKUP_CUBE, this.keyBackupCube)
    ));
    // Write my post references
    if (this.posts.length) {
      for (let i = this.posts.length-1; i>=0 && i >= this.posts.length - 21; i--) {
        zwFields.data.push(ZwField.RelatesTo(
          new Relationship(ZwRelationshipType.MYPOST, this.posts[i])
        ));
      }
    }
    // TODO add subscription recommendations

    const zwData: Buffer = VerityUI.zwFieldParser.compileFields(zwFields);
    const newMuc: Cube = Cube.MUC(this._muc.publicKey, this._muc.privateKey,
      CubeField.Payload(zwData));
    newMuc.getBinaryData();  // compile MUC
    this._muc = newMuc;
    return newMuc;
  }

  parseMuc(muc: Cube): void {
    // Is this MUC valid for this application?
    const zwData: Field = muc.getFields().getFirstField(CubeFieldType.PAYLOAD);
    if (!zwData) {
      throw new CubeError("Identity: Supplied MUC is not an Identity MUC, lacks top level PAYLOAD field.")
    }
    const zwFields = new ZwFields(VerityUI.zwFieldParser.decompileFields(zwData.value));
    if (!zwFields) {
      throw new CubeError("Identity: Supplied MUC is not an Identity MUC, payload content does not consist of zwFields");
    }
    const appField: Field = zwFields.getFirstField(ZwFieldType.APPLICATION);
    if (!appField || appField.value.toString('utf-8') != "ZW") {
      throw new CubeError("Identity: Supplied MUC is not an Identity MUC, lacks ZW application field");
    }

    // read name (mandatory)
    const nameField: Field = zwFields.getFirstField(ZwFieldType.USERNAME);
    if (nameField) this.name = nameField.value.toString('utf-8');
    if (!this.name) {
      throw new CubeError("Identity: Supplied MUC lacks user name");
    }

    // read cube references, these being:
    const relfields: ZwFields = new ZwFields(
      zwFields.getFieldsByType(ZwFieldType.RELATES_TO));
    if (relfields) {
      // - profile picture reference
      const profilePictureRel: ZwRelationship = relfields.getFirstRelationship(
        ZwRelationshipType.PROFILEPIC);
      if (profilePictureRel) this.profilepic = profilePictureRel.remoteKey;

      // - key backup cube reference
      const keyBackupCubeRel: ZwRelationship = relfields.getFirstRelationship(
        ZwRelationshipType.KEY_BACKUP_CUBE);
      if (keyBackupCubeRel) this.keyBackupCube = keyBackupCubeRel.remoteKey;

      // - my post references
      const myPostRels: ZwRelationship[] = relfields.getRelationships(
        ZwRelationshipType.MYPOST);
      for (const postrel of myPostRels) {
        this.posts.unshift(postrel.remoteKey);  // insert at beginning -- this is not efficient but I think it doesn't matter
      }
    }
  }

  /** @method Serialize, used before storing object in persistant storage */
  toJSON() {
    return Object.assign({}, this, {
      name: this.name,
      publickey: Buffer.from(this._muc.publicKey),  // Buffer has its own toJSON
      privatekey: Buffer.from(this._muc.privateKey),
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
