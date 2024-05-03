/** !!! This module may only be used after awaiting sodium.ready !!! */
import { IdentityPersistence } from './identityPersistence';
import { AvatarScheme, Avatar, DEFAULT_AVATARSCHEME } from './avatar';

import { unixtime } from '../../core/helpers';
import { Cube } from '../../core/cube/cube';
import { logger } from '../../core/logger';

import { cciField, cciFieldType } from '../cube/cciField';
import { cciFieldParsers, cciFields, cciMucFieldDefinition } from '../cube/cciFields';
import { cciRelationship, cciRelationshipType } from '../cube/cciRelationship';
import { cciCube, cciFamily } from '../cube/cciCube';
import { ensureCci } from '../cube/cciCubeUtil';

import { Settings, VerityError } from '../../core/settings';
import { CubeFamilyDefinition, FieldParserTable } from '../../core/cube/cubeFields';
import { CubeStore } from '../../core/cube/cubeStore';
import { CubeInfo } from '../../core/cube/cubeInfo';
import { CubeError, CubeKey, CubeType, FieldError } from '../../core/cube/cubeDefinitions';
import { NetConstants } from '../../core/networking/networkDefinitions';

import { ZwConfig } from '../../app/zw/zwConfig';  // TODO remove dependency from CCI to app

import { Buffer } from 'buffer';
import sodium, { KeyPair } from 'libsodium-wrappers-sumo'

const IDMUC_CONTEXT_STRING = "CCI Identity";
const IDMUC_MASTERINDEX = 0;

export interface IdentityOptions {
  persistence?: IdentityPersistence,
  minMucRebuildDelay?: number,
  requiredDifficulty?: number,
  family?: CubeFamilyDefinition,

  /**
   * Adjust how much CPU power it will take to restore an Identity from
   * username/password. You should never change this except for tests as any
   * change will invalidate all existing passwords.
   **/
  argonCpuHardness?: number,

  /**
   * Adjust how much RAM it will take to restore an Identity from
   * username/password. You should never change this except for tests as any
   * change will invalidate all existing passwords.
   **/
  argonMemoryHardness?: number,

  idmucContextString?: string,
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
  static async Load(
      cubeStore: CubeStore,
      username: string,
      password: string,
      options?: IdentityOptions,
  ): Promise<Identity | undefined> {
    const masterKey: Buffer = Identity.DeriveMasterKey(username, password,
      options?.argonCpuHardness, options?.argonMemoryHardness);
    const keyPair: KeyPair = Identity.DeriveKeypair(masterKey, options);
    const idMuc: cciCube = ensureCci(await cubeStore.getCube(
      Buffer.from(keyPair.publicKey)));
    if (idMuc === undefined) return undefined;
    const identity: Identity = await Identity.Construct(cubeStore, idMuc, options);
    identity.supplySecrets(masterKey, Buffer.from(keyPair.privateKey));
    return identity;
  }

  /** Creates a new Identity for a given username and password combination. */
  static Create(
    cubeStore: CubeStore,
    username: string,
    password: string,
    options?: IdentityOptions,
  ): Promise<Identity> {
    const masterKey: Buffer = Identity.DeriveMasterKey(
      username, password,
      options?.argonCpuHardness, options?.argonMemoryHardness);
    return Identity.Construct(cubeStore, masterKey, options);
  }

  /** Convenient await-able wrapper around the constructor  */
  static Construct(
    cubeStore: CubeStore,
    mucOrMasterkey: cciCube | Buffer,
    options?: IdentityOptions,
  ): Promise<Identity> {
    const id = new Identity(cubeStore, mucOrMasterkey, options);
    return id.ready;
  }

  static DeriveKeypair(masterKey: Buffer, options?: IdentityOptions): KeyPair {
    const contextString: string = options?.idmucContextString ?? IDMUC_CONTEXT_STRING;
    const derivedSeed = sodium.crypto_kdf_derive_from_key(
      sodium.crypto_sign_SEEDBYTES, IDMUC_MASTERINDEX, contextString,
      masterKey, "uint8array");
    const keyPair: KeyPair = sodium.crypto_sign_seed_keypair(
      derivedSeed, "uint8array");
    return keyPair;
  }

  static DeriveMasterKey(
      username: string,
      password: string,
      argonCpuHardness = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      argonMemoryHardness = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  ): Buffer {
    return Buffer.from(sodium.crypto_pwhash(
      sodium.crypto_sign_SEEDBYTES,
      password,
      sodium.crypto_hash(username, "uint8array").subarray(0, sodium.crypto_pwhash_SALTBYTES),
      argonCpuHardness,
      argonMemoryHardness,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
      "uint8array"));
  }

  /// @static Retrieves all Identity objects stored in persistant storage.
  static async retrieve(cubeStore: CubeStore, options?: IdentityOptions): Promise<Identity[]> {
    const persistance: IdentityPersistence = await IdentityPersistence.Create(options);
    const ids: Array<Identity> = await persistance.retrieve(cubeStore);
    return ids;
  }

  static validateMuc(mucInfo: CubeInfo): boolean {
    // is this even a MUC?
    if (mucInfo.cubeType != CubeType.MUC) return false;

    // Check if this is an Identity MUC by trying to create an Identity object
    // for it.
    // I'm not sure if that's efficient.
    // Disabled for now as it's not really important and forces us to make
    // MUC learning asynchroneous, which sometimes causes us to learn a MUC
    // too late.
    // let id: Identity;
    // try {
    //   const muc = ensureCci(mucInfo.getCube());
    //   if (muc === undefined) return false;
    //   id = await Identity.Construct(this.cubeStore, muc);
    // } catch (error) { return false; }
    return true;  // all checks passed
  }

  /** @member This Identity's display name */
  name: string = undefined;

  /**
   * This Identity's auto-generated, guaranteed safe-to-show avatar picture.
   * Avatars are an alternative to actual, fully-custom profile pictures
   * which are always available and always guaranteed safe-to-show.
   * Usage note: Calling this.avatar.render() yields a valid image which
   * can directly be used as an img's src.
   */
  private _avatar: Avatar = undefined;
  get avatar(): Avatar { return this._avatar ?? this.defaultAvatar() }
  set avatar(obj: Avatar) { this._avatar = obj }

  /**
   * If this Identity object knows an IdentityPersistant object
   * it can be stored in a local database. If it doesn't... then it can't.
   */
  persistance: IdentityPersistence;

  /**
   * Identity requires CubeStore for loading and parsing Identity extension
   * Cubes as well as storing locally owned Identities.
   **/
  private cubeStore: CubeStore;

  private minMucRebuildDelay: number;
  private requiredDifficulty: number;

  // TODO: actually use this attribute, i.e. when determining which kinds of
  // Cubes to sculpt
  readonly family: CubeFamilyDefinition;

  private _masterKey: Buffer = undefined;
  get masterKey(): Buffer {
    return this._masterKey;  // TODO change this as discussed below
  }
  readonly idmucContextString: string;

  /**
   * Subscription recommendations are publically visible subscriptions of other
   * authors. They are also currently the only available type of subscriptions.
   * TODO: Implement private/"secret" subscriptions, too
   */
  private _subscriptionRecommendations: Array<CubeKey> = [];
  get subscriptionRecommendations(): Array<CubeKey> {
    return this._subscriptionRecommendations
  };
  get subscriptionRecommendationStrings(): Array<string> {
    return this.subscriptionRecommendations.map(key => key.toString('hex'));
  }

  private _subscriptionRecommendationIndices: Array<cciCube> = [];
  get subscriptionRecommendationIndices(): Array<cciCube> {
    return this._subscriptionRecommendationIndices;
  }

  /** @member The MUC in which this Identity information is stored and published */
  private _muc: cciCube = undefined;

  /** @member Points to first cube in the profile picture continuation chain */
  profilepic: CubeKey = undefined;

  /**
   * @member The key of the cube containing our private key encrypted with our password.
   * Not actually implemented yet.
   **/
  keyBackupCube: CubeKey = undefined;

  /** List of own posts, sorted by date descending */
  posts: Array<string> = [];  // using strings as binary Cube keys (Buffers) don't compare well with standard methods

  /** When the user tries to rebuild their Identity MUC too often, we'll
   * remember their request in this promise. Any subsequent Identity changes
   * will then be handles in a single rebuild.
   */
  private makeMucPromise: Promise<cciCube> = undefined;

  // Provide a ready promise
  private readyPromiseResolve: Function;
  private readyPromiseReject: Function;
  private _ready: Promise<Identity> = new Promise<Identity>(
      (resolve, reject) => {
          this.readyPromiseResolve = resolve;
          this.readyPromiseReject = reject;
      });
  /**
   * Kindly always await ready before using an Identity, or it might not yet
   * be fully initialized.
   **/
  get ready(): Promise<Identity> { return this._ready }

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
   * !!! Identity may only be constructed after awaiting sodium.ready !!!
   **/
  // TODO: Provide option NOT to subscribe to remote MUC changes
  constructor(
      cubeStore: CubeStore,
      mucOrMasterkey: cciCube | Buffer,
      options?: IdentityOptions,
  ){
    this.cubeStore = cubeStore;
    // set options
    this.minMucRebuildDelay = options?.minMucRebuildDelay ?? ZwConfig.MIN_MUC_REBUILD_DELAY;
    this.requiredDifficulty = options?.requiredDifficulty ?? Settings.REQUIRED_DIFFICULTY,
    this.idmucContextString = options?.idmucContextString ?? IDMUC_CONTEXT_STRING;
    this.family = options?.family ?? cciFamily;
    this.persistance = options?.persistence ?? undefined;

    // Subscribe to remote Identity updates (i.e. same user using multiple devices)
    // Note: We're subscribing using once instead of on and renew the subscription
    // manually on each call as this saves us from implementing a destructor-like
    // shutdown procedure.
    this.cubeStore.once("cubeAdded",
      cubeInfo => this.mergeRemoteChanges(cubeInfo));

    // are we loading or creating an Identity?
    if (mucOrMasterkey instanceof Cube) {  // checking for the more generic Cube instead of cciCube as this is the more correct branch compared to handling this as a KeyPair (also Cube subclass handling is not completely clean yet throughout our codebase)
      this.parseMuc(mucOrMasterkey).then(() => {
        this.readyPromiseResolve(this)
    });
    } else {  // create new Identity
      this._masterKey = mucOrMasterkey;
      this._muc = cciCube.ExtensionMuc(
        mucOrMasterkey,
        [],  // TODO: allow to set fields like username directly on construction
        IDMUC_MASTERINDEX, this.idmucContextString,
      );
      this.readyPromiseResolve(this);
    }
  }

  /**
   * Suppose you learn an existing Identity's secrets... somehow...
   * Use this method to supply them then :)
   * No validation will be done whatsoever.
   * (This is used after restoring a locally owned Identity from persistant
   * storage and it's a bit ugly, but it will do for now.)
   */
  // maybe TODO: allow this to be supplied directly on construction
  supplySecrets(masterKey: Buffer, privKey: Buffer) {
    this._masterKey = masterKey;
    this._muc.privateKey = privKey;
  }

  get privateKey(): Buffer { return this._muc.privateKey; }
  get publicKey(): Buffer { return this._muc.publicKey; }
  // Note that there is no setter for keys:
  // Setting new keys is equivalent to creating a new Identity
  // (yes, I know you can reset the keys by going directly to the MUC,
  // just be nice and don't do it)

  /**
   * @member Get this Identity's key, which equals its MUC's cube key,
   * which is its cryptographic public key.
   * (Yes, I know this is functionally identical with publicKey(), but it's
   * about the semantics :-P )
  */
  get key(): CubeKey { return Buffer.from(this._muc.publicKey); }
  get keyString(): string { return this._muc.publicKey.toString('hex') }

  get muc(): cciCube { return this._muc; }

  /**
   * Save this Identity locally by storing it in the local database
   * and publish it by inserting it into the CubeStore.
   * (You could also provide a private cubeStore instead, but why should you?)
   */
  async store(
      applicationString: string = "ID",
      requiredDifficulty = this.requiredDifficulty,
  ):Promise<cciCube>{
    if (!this.privateKey || !this.masterKey) {
      throw new VerityError("Identity: Cannot store an Identity whose private and master key I don't have");
    }
    logger.trace("Identity: Storing identity " + this.name);
    const muc = await this.makeMUC(applicationString, requiredDifficulty);
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
  rememberMyPost(cubeKey: CubeKey | string) {
    if (typeof cubeKey !== 'string') cubeKey = cubeKey.toString('hex');
    this.posts.unshift(cubeKey);
  }

  /** Removes a cube key from my post list */
  forgetMyPost(cubeKey: CubeKey) {
    this.posts = this.posts.filter(p => p !== cubeKey.toString('hex'));
  }

  addSubscriptionRecommendation(remoteIdentity: CubeKey | string) {
    if (typeof remoteIdentity === 'string') remoteIdentity = Buffer.from(remoteIdentity, 'hex');
    if (remoteIdentity instanceof Buffer && remoteIdentity.length == NetConstants.CUBE_KEY_SIZE) {
      this._subscriptionRecommendations.push(remoteIdentity);
    } else {
      logger.warn("Identity: Ignoring subscription request to something that does not at all look like a CubeKey");
    }
  }

  removeSubscriptionRecommendation(remoteIdentity: CubeKey | string) {
    if (typeof remoteIdentity === 'string') remoteIdentity = Buffer.from(remoteIdentity, 'hex');
    this._subscriptionRecommendations = this._subscriptionRecommendations.filter(
      (existing: CubeKey) => !existing.equals(remoteIdentity as Buffer));
  }

  isSubscribed(remoteIdentity: CubeKey) {
    return this.subscriptionRecommendations.some(
      (subscription: CubeKey) => subscription.equals(remoteIdentity));
  }

  // maybe TODO: make this a Generator instead?
  async recursiveWebOfSubscriptions(maxDepth: number = 1, curDepth: number = 0): Promise<CubeKey[]> {
    let recursiveSubs: CubeKey[] = this.subscriptionRecommendations;
    if (curDepth < maxDepth) {
      for (const sub of this._subscriptionRecommendations) {
        const muc: cciCube = ensureCci(await this.cubeStore.getCube(sub));
        if (!muc) continue;
        let id: Identity;
        try {
          id = await Identity.Construct(this.cubeStore, muc);
        } catch(err) { continue; }
        if (!id) continue;
        recursiveSubs = recursiveSubs.concat(
          await id.recursiveWebOfSubscriptions(maxDepth, curDepth+1)
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
      requiredDifficulty = this.requiredDifficulty,
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

    const newMuc: cciCube = cciCube.MUC(
      this._muc.publicKey, this._muc.privateKey, {
        family: cciFamily,
        requiredDifficulty: requiredDifficulty
    });
    // Include application header if requested
    if (applicationString) {
      newMuc.fields.insertFieldBeforeBackPositionals(
        cciField.Application(applicationString));
    }

    // Write username
    if (this.name) {
      newMuc.fields.insertFieldBeforeBackPositionals(cciField.Username(this.name));
    }

    // Write avatar string
    if (this._avatar !== undefined &&
        this.avatar.scheme != AvatarScheme.UNKNOWN &&
        !(this._avatar.equals(this.defaultAvatar()))) {
          newMuc.fields.insertFieldBeforeBackPositionals(this.avatar.toField());
    }

    // Write profile picture reference
    if (this.profilepic) {
      newMuc.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.PROFILEPIC, this.profilepic)
      ));
    }

    // Write key backup cube reference (not actually implemented yet)
    if (this.keyBackupCube) {
      newMuc.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.KEY_BACKUP_CUBE, this.keyBackupCube)
      ));
    }

    // Write subscription recommendations
    // (these will be in there own sub-MUCs and we'll reference the first one
    // of those here)
    this.writeSubscriptionRecommendations(requiredDifficulty);
    if (this.subscriptionRecommendationIndices.length) {  // any subs at all?
      newMuc.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX,
          this.subscriptionRecommendationIndices[0].getKeyIfAvailable())));
          // note: key is always available as this is a MUC
    }

    // Write my post references, as many as will fit into the MUC.
    // Note: We currently just include our newest post here, and then include
    // reference to older posts within our new posts themselves.
    // We might need to change that again as it basically precludes us from ever
    // de-referencing ("deleting") as post.
    newMuc.fields.insertTillFull(cciField.FromRelationships(
      cciRelationship.fromKeys(cciRelationshipType.MYPOST, this.posts)));

    await newMuc.getBinaryData();  // compile MUC
    this._muc = newMuc;

    makeMucPromiseResolve(newMuc);
    this.makeMucPromise = undefined;  // all done, no more open promises!
    return newMuc;
  }

  /**
   * Returns this Identity's default Avatar, i.e. the one used as long as
   * the user didn't choose one. It's based on this Identity's public key.
   */
  defaultAvatar(): Avatar {
    const def = new Avatar(this.publicKey, DEFAULT_AVATARSCHEME);
    return def;
  }

  private writeSubscriptionRecommendations(
      requiredDifficulty = this.requiredDifficulty,
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
          this.masterKey, fields, i, "Subscription recommendation indices",
          false, cciFamily, requiredDifficulty);
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
  private async parseMuc(muc: cciCube): Promise<void> {
    if (Settings.RUNTIME_ASSERTIONS) {
      // disabled for now: Identity doesn't *really* require a cciCube object
      // and our codebase currently does not cleanly distinguish required
      // Cube classes yet
      // if (!(muc instanceof cciCube)) {
      //   this.readyPromiseReject(new CubeError("Identity: Supplied Cube is not as CCI Cube"));
      //   return;
      // }
      if (muc.cubeType != CubeType.MUC) {
        this.readyPromiseReject(new CubeError("Identity: Supplied Cube is not a MUC"));
        return;
      }
    }

    // read name
    const nameField: cciField = muc.fields.getFirst(cciFieldType.USERNAME);
    if (nameField) this.name = nameField.value.toString('utf-8');

    // read cube references, these being:
    // - avatar seed
    const avatarSeedField: cciField = muc.fields.getFirst(cciFieldType.AVATAR);
    if (avatarSeedField) {
      this._avatar = new Avatar(avatarSeedField);
    }

    // - profile picture reference
    const profilePictureRel: cciRelationship = muc.fields.getFirstRelationship(
      cciRelationshipType.PROFILEPIC);
    if (profilePictureRel) this.profilepic = profilePictureRel.remoteKey;

    // - key backup cube reference
    const keyBackupCubeRel: cciRelationship = muc.fields.getFirstRelationship(
      cciRelationshipType.KEY_BACKUP_CUBE);
    if (keyBackupCubeRel) this.keyBackupCube = keyBackupCubeRel.remoteKey;

    // - recursively fetch my-post references
    await this.recursiveParsePostReferences(muc, []);

    // recursively fetch my own SUBSCRIPTION_RECOMMENDATION references
    await this.recursiveParseSubscriptionRecommendations(muc);
    // last but not least: store this MUC as our MUC
    this._muc = muc;
  }

  private mergeRemoteChanges(incoming: CubeInfo): void {
    // renew subscription
    this.cubeStore.once("cubeAdded",
      cubeInfo => this.mergeRemoteChanges(cubeInfo));
    // check if this is even our MUC
    if (!(incoming.key.equals(this.key))) return;
    // check if this is even an update
    if (incoming.getCube().getHashIfAvailable().    // hash always available as
          equals(this.muc.getHashIfAvailable())) {  // CubeStore.addCube() awaits it
      return;
    }
    // check if this MUC is even valid
    if (!Identity.validateMuc(incoming)) return;
    // TODO: This does not actually perform a merge,
    // it just gives precedence to the remote version.
    // TODO: This currently creates a race condition as parseMuc() is async.
    this.parseMuc(incoming.getCube() as cciCube);
  }

  // TODO: check and limit recursion
  private async recursiveParseSubscriptionRecommendations(
      mucOrMucExtension: Cube,
      alreadyTraversedCubes: string[] = []
  ): Promise<void> {
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
      const furtherCube: Cube = await this.cubeStore.getCube(furtherIndex.remoteKey);
      if (furtherCube) {
        await this.recursiveParseSubscriptionRecommendations(furtherCube, alreadyTraversedCubes);
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
  // TODO: check and limit recursion
  private async recursiveParsePostReferences(mucOrMucExtension: Cube, alreadyTraversedCubes: string[]): Promise<void> {
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
      const postInfo: CubeInfo = await this.cubeStore.getCubeInfo(postrel.remoteKey);
      if (!postInfo) {  // skip posts we don't actually have
        // TODO: think about whether this is actually a good idea once we migrate
        // to the RequestScheduler interface instead of just assuming everything
        // is in our local CubeStore.
        logger.trace(`Identity.recursiveParsePostReferences(): While reconstructing the post list of Identity ${this.keyString} I'll skip post ${postrel.remoteKeyString} as I can't find it.`);
        continue;
      }
      if (!(this.posts.includes(postrel.remoteKey.toString('hex')))) {
        // Insert sorted by date. This is not efficient but I think it doesn't matter.
        let inserted: boolean = false;
        for (let i = 0; i < this.posts.length; i++) {
          // if the post to insert is newer than the post we're currently looking at,
          // insert before
          const postrelDate = postInfo.date;
          const compareTo: CubeInfo = await this.cubeStore.getCubeInfo(this.posts[i]);
          if (compareTo === undefined) {
            logger.warn(`Identity.recursiveParsePostReferences(): While reconstructing the post list of Identity ${this.keyString} I could not fetch the CubeInfo of this Identity's post ${this.posts[i]}`);
          }
          if (compareTo !== undefined && postrelDate >= compareTo.date) {
            this.posts.splice(i, 0, postrel.remoteKey.toString('hex'));  // inserts at position i
            inserted = true;
            break;
          }
        }
        if (!inserted) this.posts.push(postrel.remoteKey.toString('hex'));
      }
      await this.recursiveParsePostReferences(
        await this.cubeStore.getCube(postrel.remoteKey), alreadyTraversedCubes);
    }
  }
}
