import { unixtime } from '../core/helpers';
import { Cube } from '../core/cube/cube';
import { logger } from '../core/logger';

import { Level } from 'level';
import { BaseField, BaseRelationship } from '../core/cube/baseFields';
import { ZwField, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType, zwFieldDefinition } from './zwFields';
import { CubeError, CubeKey } from '../core/cube/cubeDefinitions';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from 'browser-or-node';
import { Buffer } from 'buffer';
import { CubeField, CubeFieldType } from '../core/cube/cubeFields';
import { CubeStore } from '../core/cube/cubeStore';
import { FieldParser } from '../core/fieldParser';
import { Settings, VerityError } from '../core/settings';
import { ZwConfig } from './zwConfig';
import { CubeInfo } from '../core/cube/cubeInfo';
import { assertZwMuc } from './zwCubes';

import * as CciUtil from '../cci/cciUtil'
import { NetConstants } from '../core/networking/networkDefinitions';

import sodium, { KeyPair } from 'libsodium-wrappers'

const IDENTITYDB_VERSION = 1;

// TODO: Split out the MUC management code.
// Much of it (like writing multi-cube long indexes of cube keys and deriving
// extension MUC keys from a master key) are not even Identity specific and should
// be moved to the CCI layer as common building blocks.

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
 *   - USER_NAME (mandatory, only once): Self-explanatory. UTF-8, maximum 60 bytes.
 *       Note this might be less than 60 chars.
 *   - RELATES_TO/USER_PROFILEPIC (only once): Links to the first cube of a continuation chain containing
 *       this user's profile picture in JPEG format. Maximum size of three
 *       cubes, i.e. just below 3kB.
 *   - RELATES_TO/MYPOST: Links to a post made by this user.
 *       (These posts itself will contain more RELATES_TO/MYPOST fields, building
 *       a kind of linked list of a user's posts.)
 *   - RELATES_TO/SUBSCRIPTION_RECOMMENDATION: Links to another user's MUC which this user
 *       recommends. (A "recommendation" is a publically visible subscription.)
 *       This is used to build a multi-level web-of-trust. Users can (and are
 *       expected to) only view posts made by their subscribed creators, their
 *       recommended creators, and potentially beyond depending on user settings.
 *       This is to mitigate spam which will be unavoidable due to the uncensorable
 *       nature of Verity. It also segments our users in distinct filter bubbles which has
 *       proven to be one of the most successful features of all social media.
 *   - RELATES_TO/SUBSCRIPTION_RECOMMENDATION_INDEX: I kinda sorta lied to you.
 *       We usually don't actually put SUBSCRIPTION_RECOMMENDATIONs directly
 *       into the MUC. We could, but we won't.
 *       Even for moderately active users they wouldn't fit.
 *       Instead, we create a PIC (or regular cube until PICs are implemented),
 *       put the SUBSCRIPTION_RECOMMENDATIONs into the PIC and link the PIC here.
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

  // private readonly masterKey = undefined;
  get masterKey(): Buffer {
    return this.privateKey?.subarray(0, 32);  // TODO change this as discussed below
  }


  /**
   * Subscription recommendations are publically visible subscriptions of other
   * authors. They are also currently the only available type of subscriptions.
   * TODO: Implement private/"secret" subscriptions, too
   */
  private _subscriptionRecommendations: Array<CubeKey> = [];
  get subscriptionRecommendations(): Array<CubeKey> {
    return this._subscriptionRecommendations
  };

  private _subscriptionRecommendationIndices: Array<Cube> = [];
  get subscriptionRecommendationIndices(): Array<Cube> {
    return this._subscriptionRecommendationIndices;
  }

  /** @member The MUC in which this Identity information is stored and published */
  private _muc: Cube = undefined;

  /** @member Points to first cube in the profile picture continuation chain */
  profilepic: CubeKey = undefined;

  /** @member The key of the cube containing our private key encrypted with our password */
  keyBackupCube: CubeKey = undefined;

  /** List of own posts, sorted by date descending */
  posts: Array<string> = [];  // using strings as binary Cube keys (Buffers) don't compare well with standard methods

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
      // TODO BREAKING: Create Identity MUC key pair by deriving our master key.
      // We are currently using the same key as Identity MUC private key and
      // as a base for deriving keys which probably does not follow best practices.
      // Will implement this together with other breaking changes as it breaks all existing MUCs.
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
    if (!this.privateKey || !this.masterKey) {
      throw new VerityError("Identity: Cannot store an Identity whose private key I don't have");
    }
    logger.trace("Identity: Storing identity " + this.name);
    const muc = await this.makeMUC(required_difficulty);
    for (const extensionMuc of this.subscriptionRecommendationIndices) {
      await this.cubeStore.addCube(extensionMuc);
    }
    await this.cubeStore.addCube(muc);
    if (this.persistance) {
      await this.persistance.store(this);
    }
    return muc;
  }

  /** Stores a new cube key a the the beginning of my post list */
  rememberMyPost(cubeKey: CubeKey) {
    this.posts.unshift(cubeKey.toString('hex'));
  }

  /** Removes a cube key from my post list */
  forgetMyPost(cubeKey: CubeKey) {
    this.posts = this.posts.filter(p => p !== cubeKey.toString('hex'));
  }

  addSubscriptionRecommendation(remoteIdentity: CubeKey) {
    if (remoteIdentity instanceof Buffer && remoteIdentity.length == NetConstants.CUBE_KEY_SIZE) {
      this._subscriptionRecommendations.push(remoteIdentity);
    } else {
      logger.error("Identity: Ignoring subscription request to something that does not at all look like a CubeKey");
    }
  }

  removeSubscriptionRecommendation(remoteIdentity: CubeKey) {
    this._subscriptionRecommendations = this._subscriptionRecommendations.filter(
      (existing: CubeKey) => !existing.equals(remoteIdentity));
  }

  isSubscribed(remoteIdentity: CubeKey) {
    return this.subscriptionRecommendations.some(
      (subscription: CubeKey) => subscription.equals(remoteIdentity));
  }

  recursiveWebOfSubscriptions(maxDepth: number = 1, curDepth: number = 0): CubeKey[] {
    let recursiveSubs: CubeKey[] = this.subscriptionRecommendations;
    if (curDepth < maxDepth) {
      for (const sub of this._subscriptionRecommendations) {
        const muc: Cube = this.cubeStore.getCube(sub);
        if (!muc) continue;
        let id: Identity;
        try {
          id = new Identity(this.cubeStore, muc, undefined, false);
        } catch(err) { continue; }
        if (!id) continue;
        recursiveSubs = recursiveSubs.concat(
          id.recursiveWebOfSubscriptions(maxDepth, curDepth+1)
        );
      }
    }
    return recursiveSubs;
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
    if (unixtime() < earliestAllowed) {
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
    zwFields.appendField(ZwField.Username(this.name));

    // Write profile picture reference
    if (this.profilepic) zwFields.appendField(ZwField.RelatesTo(
      new ZwRelationship(ZwRelationshipType.PROFILEPIC, this.profilepic)
    ));

    // Write key backup cube reference (not actually implemented yet)
    if (this.keyBackupCube) zwFields.appendField(ZwField.RelatesTo(
      new ZwRelationship(ZwRelationshipType.KEY_BACKUP_CUBE, this.keyBackupCube)
    ));
    // Write my post references
    // TODO: use fibonacci spacing for post references instead of linear,
    // but only if there are actually enough posts to justify it
    for (let i = 0; i < this.posts.length && i < 22; i++) {
      zwFields.appendField(ZwField.RelatesTo(
        new ZwRelationship(ZwRelationshipType.MYPOST, Buffer.from(this.posts[i], 'hex'))
      ));
    }
    // write subscription recommendations
    this.writeSubscriptionRecommendations(required_difficulty);
    if (this.subscriptionRecommendationIndices.length) {
      zwFields.appendField(ZwField.RelatesTo(
        new ZwRelationship(ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX,
          this.subscriptionRecommendationIndices[0].getKeyIfAvailable())));
          // note: key is always available as this is a MUC
    }

    const zwData: Buffer = new FieldParser(zwFieldDefinition).compileFields(zwFields);
    const newMuc: Cube = Cube.MUC(this._muc.publicKey, this._muc.privateKey,
      CubeField.PayloadField(zwData), undefined, required_difficulty);
    await newMuc.getBinaryData();  // compile MUC
    this._muc = newMuc;

    makeMucPromiseResolve(newMuc);
    this.makeMucPromise = undefined;  // all done, no more open promises!
    return newMuc;
  }

  private writeSubscriptionRecommendations(
      required_difficulty = Settings.REQUIRED_DIFFICULTY): void {
    // TODO: properly calculate available space
    // For now, let's just eyeball it:
    // After mandatory boilerplate, there's 904 bytes left in a MUC.
    // We use up 3 of those for APPLICATION (3), and let's calculate with
    // 12 bytes subkey (10 byte = 80 bits subkey + 2 byte header).
    // Also allow 102 bytes for three more index references.
    // That gives us 787 bytes remaining.
    // Each subscription recommendation is 34 byte long (1 byte RELATES_TO header,
    // 1 byte relationship type, 32 bytes cube key).
    // So we can safely fit 23 subscription recommendations per cube.
    const relsPerCube = 23;

    // Prepare index field sets, one for each index cube.
    // The cubes themselves will be sculpted in the next step.
    const fieldSets: ZwFields[] = [];
    let fields: ZwFields = new ZwFields(ZwField.Application());
    for (let i=0; i<this.subscriptionRecommendations.length; i++) {
      // write rel
      fields.appendField(ZwField.RelatesTo(new ZwRelationship(
        ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        this.subscriptionRecommendations[i]
      )));

      // time to roll over to the field set for the next cube?
      if (i % relsPerCube == relsPerCube - 1 ||
          i == this._subscriptionRecommendations.length - 1) {
        fieldSets.push(fields);
        fields = new ZwFields(ZwField.Application());
      }
    }
    // Now sculpt the index cubes using the field sets generated before,
    // in reverse order so we can link them together
    for (let i=fieldSets.length - 1; i>=0; i--) {
      // chain the index cubes together:
      if (i < fieldSets.length - 1 ) {  // last one has no successor, obviously
        fieldSets[i].appendField(ZwField.RelatesTo(new ZwRelationship(
          ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX,
            this.subscriptionRecommendationIndices[i+1].getKeyIfAvailable())));
      }
      // do we actually need to rewrite this index cube?
      if (!this.subscriptionRecommendationIndices[i] ||
          !fieldSets[i].equals(ZwFields.get(this.subscriptionRecommendationIndices[i]))) {
        // TODO: Further minimize unnecessary extension MUC update.
        // For example, if a user having let's say 10000 subscriptions ever
        // unsubscribes one of the first ones, this would currently lead to a very
        // expensive reinsert of ALL extension MUCs. In this case, it would be much
        // cheaper to just keep an open slot on the first extension MUC.
        const zwData: Buffer = new FieldParser(zwFieldDefinition).compileFields(
          fieldSets[i]);
        const payload = CubeField.PayloadField(zwData);

        const indexCube: Cube = CciUtil.sculptExtensionMuc(
          this.masterKey, payload, i, "Subscription recommendation indices");
        this.subscriptionRecommendationIndices[i] =
          indexCube;  // it's a MUC, the key is always available
      }
      // Note: Once calling store(), we will still try to reinsert non-changed
      // extension MUCs -- CubeStore will however discard them as they're unchanged.
      // TODO: We need to keep in mind that unchanged index cubes
      // must still be updated/reinserted once in a while to prevent them from
      // reaching end of life. We currently ignore that.
    }
  }

  /**
   * Sets this Identity based on a MUC; should only be used on construction.
   */
  private parseMuc(muc: Cube): void {
    const zwFields = assertZwMuc(muc);

    // read name (mandatory)
    const nameField: BaseField = zwFields.getFirst(ZwFieldType.USERNAME);
    if (nameField) this.name = nameField.value.toString('utf-8');
    if (!this.name) {
      throw new CubeError("Identity: Supplied MUC lacks user name");
    }

    // read cube references, these being:
    // - profile picture reference
    const profilePictureRel: ZwRelationship = zwFields.getFirstRelationship(
      ZwRelationshipType.PROFILEPIC);
    if (profilePictureRel) this.profilepic = profilePictureRel.remoteKey;

    // - key backup cube reference
    const keyBackupCubeRel: ZwRelationship = zwFields.getFirstRelationship(
      ZwRelationshipType.KEY_BACKUP_CUBE);
    if (keyBackupCubeRel) this.keyBackupCube = keyBackupCubeRel.remoteKey;

    // - recursively fetch my-post references
    this.recursiveParsePostReferences(muc, []);

    // recursively fetch my own SUBSCRIPTION_RECOMMENDATION references
    this.recursiveParseSubscriptionRecommendations(muc);
    // last but not least: store this MUC as our MUC
    this._muc = muc;
  }

  recursiveParseSubscriptionRecommendations(mucOrMucExtension: Cube, alreadyTraversedCubes: string[] = []) {
    // do we even have this cube?
    if (!mucOrMucExtension) return;
    // have we been here before? avoid endless recursion
    const thisCubesKeyString = (mucOrMucExtension.getKeyIfAvailable()).toString('hex');
    if (thisCubesKeyString === undefined || alreadyTraversedCubes.includes(thisCubesKeyString)) return;
    else alreadyTraversedCubes.push(thisCubesKeyString);

    // parse this index cube
    const zwFields: ZwFields = ZwFields.get(mucOrMucExtension);
    if (!zwFields) return;
    // save the subscriptions recommendations provided:
    const subs = zwFields.getRelationships(
      ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION);
    for (const sub of subs) {
      this.addSubscriptionRecommendation(sub.remoteKey);
    }
    // recurse through further index cubes, if any:
    const furtherIndices = zwFields.getRelationships(
      ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX);
    for (const furtherIndex of furtherIndices) {
      const furtherCube: Cube = this.cubeStore.getCube(furtherIndex.remoteKey);
      if (furtherCube) {
        this.recursiveParseSubscriptionRecommendations(furtherCube, alreadyTraversedCubes);
      }
    }
  }

  /**
   * Extension of and only to be called by parseMuc().
   * Parsing a MUC involves retrieving all own-post references from the MUC
   * as well as indirect my-post references contained down the line in other
   * posts (can't fit them all in the MUC, cube space is fixed, remember?).
   * This is the recursive part of that.
   */
  private recursiveParsePostReferences(mucOrMucExtension: Cube, alreadyTraversedCubes: string[]): void {
    // do we even have this cube?
    if (!mucOrMucExtension) return;
    // have we been here before? avoid endless recursion
    const thisCubesKeyString = (mucOrMucExtension.getKeyIfAvailable()).toString('hex');
    if (thisCubesKeyString === undefined || alreadyTraversedCubes.includes(thisCubesKeyString)) return;
    else alreadyTraversedCubes.push(thisCubesKeyString);

    const zwFields: ZwFields = ZwFields.get(mucOrMucExtension);
    if (!zwFields) return;

    const myPostRels: ZwRelationship[] = zwFields.getRelationships(
      ZwRelationshipType.MYPOST);
    for (const postrel of myPostRels) {
      const postInfo: CubeInfo = this.cubeStore.getCubeInfo(postrel.remoteKey);
      if (!postInfo) continue;  // skip posts we don't actually have
      if (!(this.posts.includes(postrel.remoteKey.toString('hex')))) {
        // Insert sorted by date. This is not efficient but I think it doesn't matter.
        let inserted: boolean = false;
        for (let i = 0; i < this.posts.length; i++) {
          // if the post to insert is newer than the post we're currently looking at,
          // insert before
          const postrelDate = postInfo.date;
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
      // try {
        const muc = cubeStore.getCube(Buffer.from(pubkey, 'hex'));
        if (muc === undefined) {
          logger.error("IdentityPersistance: Could not parse and Identity from DB as MUC " + pubkey + " is not present");
          continue;
        }
        muc.privateKey = Buffer.from(privkey, 'hex');
        const id = new Identity(cubeStore, muc, this);
        identities.push(id);
        // } catch (error) {
        //   logger.error("IdentityPersistance: Could not parse an identity from DB: " + error);
        // }
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
