/** !!! This module may only be used after awaiting sodium.ready !!! */

import { unixtime } from '../core/helpers';
import { Cube } from '../core/cube/cube';
import { logger } from '../core/logger';

import { Level } from 'level';
import { cciField, cciFieldParsers, cciFieldType, cciFields, cciMucFieldDefinition, cciRelationship, cciRelationshipType } from './cciFields';
import { CubeError, CubeKey, CubeType, FieldError } from '../core/cube/cubeDefinitions';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from 'browser-or-node';
import { Buffer } from 'buffer';
import { CubeStore } from '../core/cube/cubeStore';
import { ApiMisuseError, Settings, VerityError } from '../core/settings';
import { ZwConfig } from '../app/zwConfig';
import { CubeInfo } from '../core/cube/cubeInfo';

import { NetConstants } from '../core/networking/networkDefinitions';

import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { cciCube } from './cciCube';
import { FieldParserTable } from '../core/cube/cubeFields';

const IDENTITYDB_VERSION = 1;
const IDMUC_CONTEXT_STRING = "CCI Identity";
const IDMUC_MASTERINDEX = 0;

export interface IdentityOptions {
  persistance?: IdentityPersistance,
  minMucRebuildDelay?: number,
  requiredDifficulty?: number,
  parsers?: FieldParserTable,
}

// TODO: Split out the MUC management code.
// Much of it (like writing multi-cube long indexes of cube keys) are not even
// Identity specific and should be exposed as common CCI building blocks.

/**
 * !!! May only be used after awaiting sodium.ready !!!
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
 *   - RELATES_TO/USER_PROFILEPIC (only once): (TODO rework)
 *       Links to the first cube of a continuation chain containing
 *       this user's profile picture in JPEG format. Maximum size of three
 *       cubes, i.e. just below 3kB.
 *   - RELATES_TO/MYPOST: Links to a post made by this user.
 *       (These posts itself will contain more RELATES_TO/MYPOST fields, building
 *       a kind of linked list of a user's posts.)
 *   - RELATES_TO/SUBSCRIPTION_RECOMMENDATION: Links to another user's MUC which
 *       this user recommends.
 *       (A "recommendation" is a publically visible subscription.)
 *       This is used to build a multi-level web-of-trust. Users can (and are
 *       expected to) only view posts made by their subscribed creators, their
 *       recommended creators, and potentially beyond depending on user settings.
 *       This is to mitigate spam which will be unavoidable due to the
 *       uncensorable nature of Verity.
 *       It also segments our users into distinct filter bubbles which has
 *       proven to be one of the most successful features of all social media :)
 *   - RELATES_TO/SUBSCRIPTION_RECOMMENDATION_INDEX: I kinda sorta lied to you.
 *       We usually don't actually put SUBSCRIPTION_RECOMMENDATIONs directly
 *       into the master Identity MUC. We could, but we won't.
 *       Even for moderately active users they wouldn't fit.
 *       Instead, we create an "extension MUC", which is just another MUC
 *       derived from our key, put the SUBSCRIPTION_RECOMMENDATIONs into the
 *       extension MUC and link the extension MUC here.
 *       Makes much more sense, doesn't it?
 * We don't require fields to be in any particular order above the core lib
 * requirements.
 *
 * TODO: Specify maximums to make sure all of that nicely fits into a single MUC.
 */
export class Identity {
  /** Tries to load an existing Identity from CubeStore */
  // TODO: Once we have a cube exchange scheduler, schedule the purported
  // Identity MUC for retrieval if we don't have it (this will be necessary for
  // light nodes)
  static Load(
      cubeStore: CubeStore,
      username: string,
      password: string,
      options?: IdentityOptions,
  ): Identity | undefined {
    const keyPair: KeyPair =
      Identity.DeriveKeypair(Identity.DeriveMasterKey(username, password));
    const idMuc: cciCube = cubeStore.getCube(
      Buffer.from(keyPair.publicKey), cciFieldParsers, cciCube) as cciCube;
    if (idMuc === undefined) return undefined;
    else return new Identity(cubeStore, idMuc, options);
  }

  /** Creates a new Identity for a given username and password combination. */
  static Create(
    cubeStore: CubeStore,
    username: string,
    password: string,
    options?: IdentityOptions,
  ): Identity {
    const masterKey: Uint8Array = Identity.DeriveMasterKey(username, password);
    return new Identity(cubeStore, masterKey, options);
  }

  static DeriveKeypair(masterKey: Uint8Array): KeyPair {
    const derivedSeed = sodium.crypto_kdf_derive_from_key(
      sodium.crypto_sign_SEEDBYTES, IDMUC_MASTERINDEX, IDMUC_CONTEXT_STRING,
      masterKey, "uint8array");
    const keyPair: KeyPair = sodium.crypto_sign_seed_keypair(
      derivedSeed, "uint8array");
    return keyPair;
  }

  static DeriveMasterKey(username: string, password: string): Uint8Array {
    return sodium.crypto_pwhash(
      sodium.crypto_sign_SEEDBYTES,
      password,
      sodium.crypto_hash(username, "uint8array").subarray(0, sodium.crypto_pwhash_SALTBYTES),
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
      "uint8array");
  }

  /// @static Retrieves all Identity objects stored in persistant storage.
  static async retrieve(cubeStore: CubeStore, dbname: string = "identity"): Promise<Identity[]> {
    const persistance: IdentityPersistance = await IdentityPersistance.create(dbname);
    const ids: Array<Identity> = await persistance.retrieve(cubeStore);
    return ids;
  }

  /** @member This Identity's display name */
  name: string = undefined;

  /**
   * If this Identity object knows an IdentityPersistant object
   * it can be stored in a local database. If it doesn't... then it can't.
   */
  persistance: IdentityPersistance;

  /**
   * Identity requires CubeStore for loading and parsing Identity extension
   * Cubes as well as storing locally owned Identities.
   **/
  private cubeStore: CubeStore;

  private minMucRebuildDelay: number;
  private requiredDifficulty: number;
  readonly parsers: FieldParserTable;

  private readonly _masterKey = undefined;
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

  private _subscriptionRecommendationIndices: Array<cciCube> = [];
  get subscriptionRecommendationIndices(): Array<cciCube> {
    return this._subscriptionRecommendationIndices;
  }

  /** @member The MUC in which this Identity information is stored and published */
  private _muc: cciCube = undefined;

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
  private makeMucPromise: Promise<cciCube> = undefined;

  /**
   * Depending on whether you provide a key pair or an existing Identity MUC,
   * this will either create a brand new Identity or parse an existing one
   * from the supplied MUC.
   * Usage note: Consider using Identity.retrieve() instead which automatically
   * handles loading existing Identities from local storage.
   * @param [mucOrMasterkey] Either a cryptographic key pair to create a new
   *        Identity with or a valid existing Identity MUC.
   *        Exisiting Identities can be loaded this way even if you don't have
   *        the private key; however, they can obviously not be store()d.
   * @param [persistance] If you want to locally store this Identity to disk,
   *        please construct an IdentityPersistance object and supply it here.
   *        Does only make sense for local Identities, i.e. one for which you
   *        have the private key.
   * @param [minMucRebuildDelay] Set this to override the system-defined minimum
   *        time between Identity MUC updates.
   * @param [required_difficulty] Set this to override tbe system-defined
   *        minimum Cube challenge difficulty. For example, you may want to set
   *        this to 0 for testing.
   * @throws FieldError when supplied MUC is unparsable or ApiMisuseError in
   *         in case of conflicting params.
   * !!! Identity may only be constructed after awaiting sodium.ready !!!
   **/
  constructor(
      cubeStore: CubeStore,
      mucOrMasterkey: cciCube | Uint8Array,
      options?: IdentityOptions,
  ){
    this.cubeStore = cubeStore;
    // set options
    this.minMucRebuildDelay = options?.minMucRebuildDelay ?? ZwConfig.MIN_MUC_REBUILD_DELAY;
    this.requiredDifficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY,
    this.parsers = options?.parsers ?? cciFieldParsers;
    this.persistance = options?.persistance ?? undefined;

    // are we loading or creating an Identity?
    if (mucOrMasterkey instanceof Cube) {  // checking for the more generic Cube instead of cciCube as this is the more correct branch compared to handling this as a KeyPair (also Cube subclass handling is not completely clean yet throughout our codebase)
      this.parseMuc(mucOrMasterkey);
    } else {  // create new Identity
      this._muc = cciCube.ExtensionMuc(
        mucOrMasterkey,
        [],  // TODO: allow to set fields like username directly on construction
        IDMUC_MASTERINDEX, IDMUC_CONTEXT_STRING,
      );
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

  get muc(): cciCube { return this._muc; }

  /**
   * Save this Identity locally by storing it in the local database
   * and publish it by inserting it into the CubeStore.
   * (You could also provide a private cubeStore instead, but why should you?)
   */
  async store(
      applicationString: string = undefined,
      required_difficulty = Settings.REQUIRED_DIFFICULTY,
  ):Promise<cciCube>{
    if (!this.privateKey || !this.masterKey) {
      throw new VerityError("Identity: Cannot store an Identity whose private key I don't have");
    }
    logger.trace("Identity: Storing identity " + this.name);
    const muc = await this.makeMUC(applicationString, required_difficulty);
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
        const muc: cciCube = this.cubeStore.getCube(sub, cciFieldParsers, cciCube) as cciCube;  // TODO our CubeInfos should learn which kind of Cube they represent much earlier in the process
        if (!muc) continue;
        let id: Identity;
        try {
          id = new Identity(this.cubeStore, muc);
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
  async makeMUC(
      applicationString: string = undefined,
      required_difficulty = Settings.REQUIRED_DIFFICULTY,
  ): Promise<cciCube> {
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

    const fields: cciField[] = [];
    // Include application header if requested
    if (applicationString) {
      fields.push(cciField.Application(applicationString));
    }

    // Write username
    if (!this.name) throw new CubeError("Identity: Cannot create a MUC for this Identity, name field is mandatory.");
    fields.push(cciField.Username(this.name));

    // Write profile picture reference
    if (this.profilepic) fields.push(cciField.RelatesTo(
      new cciRelationship(cciRelationshipType.PROFILEPIC, this.profilepic)
    ));

    // Write key backup cube reference (not actually implemented yet)
    if (this.keyBackupCube) fields.push(cciField.RelatesTo(
      new cciRelationship(cciRelationshipType.KEY_BACKUP_CUBE, this.keyBackupCube)
    ));
    // Write my post references
    // TODO: use fibonacci spacing for post references instead of linear,
    // but only if there are actually enough posts to justify it
    for (let i = 0; i < this.posts.length && i < 22; i++) {
      fields.push(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MYPOST, Buffer.from(this.posts[i], 'hex'))
      ));
    }
    // write subscription recommendations
    this.writeSubscriptionRecommendations(required_difficulty);
    if (this.subscriptionRecommendationIndices.length) {
      fields.push(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX,
          this.subscriptionRecommendationIndices[0].getKeyIfAvailable())));
          // note: key is always available as this is a MUC
    }

    const newMuc: cciCube = cciCube.MUC(this._muc.publicKey, this._muc.privateKey,
      fields, cciFieldParsers, required_difficulty);
    await newMuc.getBinaryData();  // compile MUC
    this._muc = newMuc;

    makeMucPromiseResolve(newMuc);
    this.makeMucPromise = undefined;  // all done, no more open promises!
    return newMuc;
  }

  private writeSubscriptionRecommendations(
      required_difficulty = Settings.REQUIRED_DIFFICULTY,
      applicationString: string = undefined,
  ): void {
    // TODO: properly calculate available space
    // For now, let's just eyeball it:
    // TODO UPDATE CALCULATION
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
    const fieldSets: cciFields[] = [];
    let fields: cciFields = new cciFields([], cciMucFieldDefinition);
    if (applicationString) {
      fields.appendField(cciField.Application(applicationString));
    }
    for (let i=0; i<this.subscriptionRecommendations.length; i++) {
      // write rel
      fields.appendField(cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        this.subscriptionRecommendations[i]
      )));

      // time to roll over to the field set for the next cube?
      if (i % relsPerCube == relsPerCube - 1 ||
          i == this._subscriptionRecommendations.length - 1) {
        fieldSets.push(fields);
        fields = new cciFields([], cciMucFieldDefinition);
        if (applicationString) {
          fields.appendField(cciField.Application(applicationString));
        }
      }
    }
    // Now sculpt the index cubes using the field sets generated before,
    // in reverse order so we can link them together
    for (let i=fieldSets.length - 1; i>=0; i--) {
      fields = fieldSets[i];
      // chain the index cubes together:
      if (i < fieldSets.length - 1 ) {  // last one has no successor, obviously
        fields.appendField(cciField.RelatesTo(new cciRelationship(
          cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX,
            this.subscriptionRecommendationIndices[i+1].
              getKeyIfAvailable())));  // it's a MUC, the key is always available
      }
      // do we actually need to rewrite this index cube?
      if (!this.subscriptionRecommendationIndices[i] ||
          !fields.equals(this.subscriptionRecommendationIndices[i].fields)) {
        // TODO: Further minimize unnecessary extension MUC update.
        // For example, if a user having let's say 10000 subscriptions ever
        // unsubscribes one of the first ones, this would currently lead to a very
        // expensive reinsert of ALL extension MUCs. In this case, it would be much
        // cheaper to just keep an open slot on the first extension MUC.
        const indexCube: cciCube = cciCube.ExtensionMuc(
          this.masterKey, fields, i, "Subscription recommendation indices");
        this.subscriptionRecommendationIndices[i] = indexCube;
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
  private parseMuc(muc: cciCube): void {
    if (Settings.RUNTIME_ASSERTIONS) {
      // disabled for now: Identity doesn't *really* require a cciCube object
      // and our codebase currently does not cleanly distinguish required
      // Cube classes yet
      // if (!(muc instanceof cciCube)) {
      //   throw new CubeError("Identity: Supplied Cube is not as CCI Cube");
      // }
      if (muc.cubeType != CubeType.MUC) {
        throw new CubeError("Identity: Supplied Cube is not a MUC");
      }
    }

    // read name (mandatory)
    const nameField: cciField = muc.fields.getFirst(cciFieldType.USERNAME);
    if (nameField) this.name = nameField.value.toString('utf-8');
    if (!this.name) {
      throw new FieldError("Identity: Supplied MUC lacks user name");
    }

    // read cube references, these being:
    // - profile picture reference
    const profilePictureRel: cciRelationship = muc.fields.getFirstRelationship(
      cciRelationshipType.PROFILEPIC);
    if (profilePictureRel) this.profilepic = profilePictureRel.remoteKey;

    // - key backup cube reference
    const keyBackupCubeRel: cciRelationship = muc.fields.getFirstRelationship(
      cciRelationshipType.KEY_BACKUP_CUBE);
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
    if (!(mucOrMucExtension.fields instanceof cciFields)) return;  // no CCI, no rels
    const fields: cciFields = mucOrMucExtension.fields as cciFields;
    if (!fields) return;
    // save the subscriptions recommendations provided:
    const subs = fields.getRelationships(
      cciRelationshipType.SUBSCRIPTION_RECOMMENDATION);
    for (const sub of subs) {
      this.addSubscriptionRecommendation(sub.remoteKey);
    }
    // recurse through further index cubes, if any:
    const furtherIndices = fields.getRelationships(
      cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX);
    for (const furtherIndex of furtherIndices) {
      const furtherCube: Cube = this.cubeStore.getCube(furtherIndex.remoteKey, cciFieldParsers, cciCube);
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

    if (!(mucOrMucExtension.fields instanceof cciFields)) return;  // no CCI, no rels
    const fields: cciFields = mucOrMucExtension.fields as cciFields;
    if (!fields) return;

    const myPostRels: cciRelationship[] = fields.getRelationships(
      cciRelationshipType.MYPOST);
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
      this.recursiveParsePostReferences(this.cubeStore.getCube(postrel.remoteKey, cciFieldParsers, cciCube), alreadyTraversedCubes);
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
  async retrieve(cubeStore: CubeStore): Promise<Identity[]> {
    if (this.db.status != 'open') {
      logger.error("IdentityPersistance: Could not retrieve identity, DB not open");
      return undefined;
    }
    const identities: Array<Identity> = [];
    for await (const [pubkey, masterkey] of this.db.iterator() ) {
      try {
        const privkey: Buffer = Buffer.from(
          Identity.DeriveKeypair(Buffer.from(masterkey, 'hex')).publicKey);
        const muc = cubeStore.getCube(Buffer.from(pubkey, 'hex'), cciFieldParsers, cciCube) as cciCube;  // TODO: either assert cciCube or document why assertion not required
        if (muc === undefined) {
          logger.error("IdentityPersistance: Could not parse and Identity from DB as MUC " + pubkey + " is not present");
          continue;
        }
        muc.privateKey = privkey;
        const id = new Identity(cubeStore, muc, {persistance: this});
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
