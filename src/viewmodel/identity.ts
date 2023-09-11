import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from 'browser-or-node';
import { Cube, CubeKey } from '../model/cube';
import { logger } from '../model/logger';

import { Level } from 'level';
import sodium, { KeyPair } from 'libsodium-wrappers'
import { BaseField, BaseRelationship } from '../model/baseFields';
import { ZwField, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType, zwFieldDefinition } from './zwFields';
import { CubeError } from '../model/cubeDefinitions';

import { Buffer } from 'buffer';
import { CubeField, CubeFieldType } from '../model/cubeFields';
import { CubeStore } from '../model/cubeStore';
import { FieldParser } from '../model/fieldParser';
import { Settings } from '../model/config';
import { ZwConfig } from './zwConfig';

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
  static async retrieve(cubeStore: CubeStore, dbname: string = "identity"): Promise<Identity> {
    const persistance: IdentityPersistance = await IdentityPersistance.create(dbname);
    const ids: Array<Identity> = await persistance.retrieve(cubeStore);
    let id: Identity = undefined;
    if (ids && ids.length) {
      id = ids[0];
    }
    else {
      id = new Identity(cubeStore, undefined, persistance);
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

  private cubeStore;

  /** @member The MUC in which this Identity information is stored and published */
  private _muc: Cube = undefined;

  /** @member Points to first cube in the profile picture continuation chain */
  profilepic: CubeKey = undefined;

  /** @member The key of the cube containing our private key encrypted with our password */
  keyBackupCube: CubeKey = undefined;

  /** List of own posts, sorted by date descending */
  posts: Array<string> = [];  // binary Cube keys (Buffers) don't compare well with standard methods
  // TODO add subscription_recommendations

  /** When the user tries to rebuild their Identity MUC too often, we'll
   * remember their request in this promise. Any subsequent Identity changes
   * will then be handles in a single rebuild.
   */
  private makeMucPromise: Promise<Cube> = undefined;

  constructor(
      cubeStore: CubeStore,
      muc: Cube = undefined,
      persistance: IdentityPersistance = undefined,
      createByDefault = true,
      private minMucRebuildDelay = ZwConfig.MIN_MUC_REBUILD_DELAY) {
    this.cubeStore = cubeStore;
    this.persistance = persistance;
    if (muc) this.parseMuc(muc);
    else if (createByDefault) {  // create new Identity
      let keys: KeyPair = sodium.crypto_sign_keypair();
      muc = Cube.MUC(Buffer.from(keys.publicKey), Buffer.from(keys.privateKey));
      this._muc = muc;
    }
    else {
      throw new CubeError("Identity: Cannot restore Identity without valid MUC.")
    }
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

  get muc(): Cube { return this._muc; }

  /**
   * Save this Identity locally by storing it in the local database
   * and publish it by inserting it into the CubeStore.
   * (You could also provide a private cubeStore instead, but why should you?)
   */
  async store(required_difficulty = Settings.REQUIRED_DIFFICULTY): Promise<Cube> {
    logger.trace("Identity: Storing identity " + this.name);
    const muc = await this.makeMUC(required_difficulty);
    await this.cubeStore.addCube(muc);
    if (this.persistance) {
      await this.persistance.store(this);
    }
    return muc;
  }

  /**
  * Compiles this Identity into a MUC for publishing.
  * Make sure to call this after changes have been performed so they
  * will be visible to other users, and make sure to only call it once *all*
  * changes have been performed to avoid spamming multiple MUC versions
  * (and having to compute hashcash for all of them).
  */
  async makeMUC(required_difficulty = Settings.REQUIRED_DIFFICULTY): Promise<Cube> {
    // Make sure we don't rebuild our MUC too often. This is to limit spam,
    // reduce local hash cash load and to prevent rapid subsequent changes to
    // be lost due to our one second minimum time resolution.
    let makeMucPromiseResolve: Function;
    if (this.makeMucPromise) {
      // MUC rebuild already scheduled, just return it:
      return this.makeMucPromise;
    }
    else {
      // Register our run so there will be no other concurrent attempts
      this.makeMucPromise = new Promise(function(resolve){
        makeMucPromiseResolve = resolve;
      });
    }

    // If the last MUC rebuild was too short a while ago, wait a little.
    const earliestAllowed: number = this.muc.getDate() + this.minMucRebuildDelay;
    if (Math.floor(Date.now() / 1000) < earliestAllowed) {
      const waitFor = earliestAllowed - (Math.floor(Date.now() / 1000));
      await new Promise(resolve => setTimeout(resolve, waitFor*1000));
    }

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
      new ZwRelationship(ZwRelationshipType.PROFILEPIC, this.profilepic)
    ));

    // Write key backup cube reference (not actually implemented yet)
    if (this.keyBackupCube) zwFields.data.push(ZwField.RelatesTo(
      new ZwRelationship(ZwRelationshipType.KEY_BACKUP_CUBE, this.keyBackupCube)
    ));
    // Write my post references
    // TODO: use fibonacci spacing for post references instead of linear,
    // but only if there are actually enough posts to justify it
    for (let i = 0; i < this.posts.length && i < 22; i++) {
      zwFields.data.push(ZwField.RelatesTo(
        new ZwRelationship(ZwRelationshipType.MYPOST, Buffer.from(this.posts[i], 'hex'))
      ));
    }
    // TODO add subscription recommendations

    const zwData: Buffer = new FieldParser(zwFieldDefinition).compileFields(zwFields);
    const newMuc: Cube = Cube.MUC(this._muc.publicKey, this._muc.privateKey,
      CubeField.Payload(zwData), required_difficulty);
    await newMuc.getBinaryData();  // compile MUC
    this._muc = newMuc;

    makeMucPromiseResolve(newMuc);
    this.makeMucPromise = undefined;  // all done, no more open promises!
    return newMuc;
  }

  /**
   * Sets this Identity based on a MUC; should only be used on construction.
   */
  private parseMuc(muc: Cube): void {
    // TODO: is this even a valid MUC?
    // Is this MUC valid for this application?
    const zwFields: ZwFields = ZwFields.get(muc);
    if (!zwFields) {
      throw new CubeError("Identity: Supplied MUC is not an Identity MUC, lacks ZW fields");
    }
    const appField: BaseField = zwFields.getFirstField(ZwFieldType.APPLICATION);
    if (!appField || appField.value.toString('utf-8') != "ZW") {
      throw new CubeError("Identity: Supplied MUC is not an Identity MUC, lacks ZW application field");
    }

    // read name (mandatory)
    const nameField: BaseField = zwFields.getFirstField(ZwFieldType.USERNAME);
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

      // - recursively fetch my-post references
      this.recursiveParsePostReferences(muc, []);
    }
    // last but not least: store this MUC as our MUC
    this._muc = muc;
  }

  /**
   * Extension of and only to be called by parseMuc().
   * Parsing a MUC involves retrieving all own-post references from the MUC
   * as well as indirect my-post references contained down the line in other
   * posts (can't fit them all in the MUC, cube space is fixed, remember?).
   * This is the recursive part of that.
   */
  private recursiveParsePostReferences(mucOrMucExtension: Cube, alreadyTraversedCubes: string[]) {
    // have we been here before? avoid endless recursion
    const thisCubesKeyString = (mucOrMucExtension.getKeyIfAvailable()).toString('hex');
    if (thisCubesKeyString === undefined || alreadyTraversedCubes.includes(thisCubesKeyString)) return;
    else alreadyTraversedCubes.push(thisCubesKeyString);

    const zwFields: ZwFields = ZwFields.get(mucOrMucExtension);
    if (!zwFields) return;

    const myPostRels: ZwRelationship[] = zwFields.getRelationships(
      ZwRelationshipType.MYPOST);
    for (const postrel of myPostRels) {
      if (!(this.posts.includes(postrel.remoteKey.toString('hex')))) {
        // Insert sorted by date. This is not efficient but I think it doesn't matter.
        let inserted: boolean = false;
        for (let i = 0; i < this.posts.length; i++) {
          // if the post to insert is newer than the post we're currently looking at,
          // insert before
          const postrelDate = this.cubeStore.getCubeInfo(postrel.remoteKey).date;
          const compareToDate = this.cubeStore.getCubeInfo(this.posts[i]).date;
          if (postrelDate >= compareToDate) {
              this.posts.splice(i, 0, postrel.remoteKey.toString('hex'));  // inserts at position i
              inserted = true;
              break;
            }
        }
        if (!inserted) this.posts.push(postrel.remoteKey.toString('hex'));
      }
      this.recursiveParsePostReferences(this.cubeStore.getCube(postrel.remoteKey), alreadyTraversedCubes);
    }
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
        keyEncoding: 'utf8',
        valueEncoding: 'utf8',
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

  // TODO: Ensure this does not get called more than once a second, otherwise
  // the updated cube will lose the CubeContest and not actually be stored
  store(id: Identity): Promise<void> {
    if (this.db.status != 'open') {
      logger.error("IdentityPersistance: Could not store identity, DB not open");
      return undefined;
    }
    return this.db.put(
      id.key.toString('hex'),
      id.privateKey.toString('hex')
    );
  }

  async retrieve(cubeStore: CubeStore): Promise<Array<Identity>> {
    if (this.db.status != 'open') {
      logger.error("IdentityPersistance: Could not retrieve identity, DB not open");
      return undefined;
    }
    const identities: Array<Identity> = [];
    for await (const [pubkey, privkey] of this.db.iterator() ) {
      try {
        const muc = cubeStore.getCube(Buffer.from(pubkey, 'hex'));
        if (muc === undefined) {
          logger.error("IdentityPersistance: Could not parse and Identity from DB as MUC " + pubkey + " is not present");
          continue;
        }
        const id = new Identity(cubeStore, muc, this);
        muc.setCryptoKeys(Buffer.from(pubkey, 'hex'), Buffer.from(privkey, 'hex'), true);
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
    for await (const key of this.db.keys() ) {
      this.db.del(key);
    }
  }

  /** Closes the DB, which invalidates the object. Should only really be used by unit tests. */
  async close() {
    await this.db.close();
  }
}
