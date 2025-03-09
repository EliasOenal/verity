
import type { Shuttable } from '../../core/helpers/coreInterfaces';
import { unixtime } from '../../core/helpers/misc';
import { mergeAsyncGenerators, resolveAndYield } from '../../core/helpers/asyncGenerators';
import { Cube } from '../../core/cube/cube';
import { KeyVariants, keyVariants } from '../../core/cube/cubeUtil';
import { logger } from '../../core/logger';

import { ApiMisuseError, Settings, VerityError } from '../../core/settings';
import { NetConstants } from '../../core/networking/networkDefinitions';
import { CubeEmitter, CubeRetrievalInterface, CubeStore } from '../../core/cube/cubeStore';
import { CubeInfo } from '../../core/cube/cubeInfo';
import { CubeError, CubeKey, CubeType } from '../../core/cube/cube.definitions';
import { CubeRetriever } from '../../core/networking/cubeRetrieval/cubeRetriever';

import { FieldType } from '../cube/cciCube.definitions';
import { KeyMismatchError, KeyPair, deriveEncryptionKeypair, deriveSigningKeypair } from '../helpers/cryptography';
import { VerityField } from '../cube/verityField';
import { VerityFields, cciMucFieldDefinition } from '../cube/verityFields';
import { Relationship, RelationshipType } from '../cube/relationship';
import { cciCube, cciFamily } from '../cube/cciCube';
import { ensureCci } from '../cube/cciCubeUtil';

import { IdentityPersistence } from './identityPersistence';
import { AvatarScheme, Avatar, DEFAULT_AVATARSCHEME } from './avatar';
import { IdentityStore } from './identityStore';

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo'
import EventEmitter from 'events';
import { Veritum } from '../veritum/veritum';
import { VeritumRetrievalInterface, VeritumRetriever } from '../veritum/veritumRetriever';
import { CubeRequestOptions } from '../../core/networking/cubeRetrieval/requestScheduler';

// Identity defaults
const DEFAULT_IDMUC_APPLICATION_STRING = "ID";
const DEFAULT_MIN_MUC_REBUILD_DELAY = 5;  // minimum five seconds between Identity MUC generations unless specified otherwise

// Key derivation defaults
const DEFAULT_IDMUC_CONTEXT_STRING = "CCI Identity";
const IDMUC_MASTERINDEX = 0;
const DEFAULT_IDMUC_ENCRYPTION_CONTEXT_STRING = "CCI Encrpytion";
const DEFAULT_IDMUC_ENCRYPTION_KEY_INDEX = 0;


export interface IdentityOptions {
  /**
   * If you this Identity stored locally on this node, please create an
   * IdentityPersistence object and supply it here.
   * This is only relevant to local Identities, i.e. Identities owned by
   * this node's user.
   */
  identityPersistence?: IdentityPersistence,
  minMucRebuildDelay?: number,
  requiredDifficulty?: number,

  // TODO: Offer a family param governing which kinds of Cubes Identity will sculpt
  // family?: CubeFamilyDefinition,

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

  /**
   * Governs how a local Identity's signing key pair is derived from
   * it's master key. This needs to be changed if an application deliberately
   * wants to use Identities separate from and incompatible with regular CCI
   * Identities, allowing a user to have completely separate CCI Identities
   * and application Identities on the same Verity network using the same
   * username/password combination.
   * Other than that, it is not recommended to change this option.
   */
  idmucContextString?: string,

  idmucEncryptionContextString?: string,

  /**
   * The application value used in this Identity's MUCs. Defaults to "ID".
   * Should only be changed if the goal is to create separate
   * application-specific Identities, in which case idmucContentString
   * should also be changed.
   */
  idmucApplicationString?: string,

  idmucNotificationKey?: CubeKey,

  /**
   * Whether this Identity should listen for remote updates to itself.
   * This is required whenever the same Identity may be actively used (= edited)
   * on different nodes as otherwise changes won't be synced.
   * Default: true
   **/
  subscribeRemoteChanges?: boolean;

  identityStore?: IdentityStore;
}

export enum PostFormat {
  CubeInfo,
  Cube,
  Veritum,
};

export const PostFormatEventMap = {
  [PostFormat.CubeInfo]: 'cubeAdded',  // TODO change, or drop CubeInfo emissions altogether
  [PostFormat.Cube]: 'cubeAdded',
  [PostFormat.Veritum]: 'postAdded',
} as const;

export interface GetPostsOptions {
  format?: PostFormat;

  /**
   * When fetching not just own posts but also posts by subscribed authors,
   * this is the maximum recursion depth, i.e. the maximum level of indirect
   * subscriptions.
   * Set to 0 to only retrieve this Identity's own posts.
   */
  subscriptionRecursionDepth?: number;

  /**
   * A set of Identity key strings to exclude when retrieving not just own posts
   * but also posts by subscribed authors.
   */
  recursionExclude?: Set<string>;

  /**
   * If true, the generator will not exit when all existing data has been yielded.
   * Instead, it will keep running indefinetely, yielding values as new data
   * becomes available.
   * The caller must call return() on the generator to exit it.
   */
  subscribe?: boolean;
}

// TODO: Split out the MUC management code.
// Much of it (like writing multi-cube long indexes of cube keys) are not even
// Identity specific and should be exposed as common CCI building blocks.

// TODO: For both post and subscription/recommendation referenced, introduce a
// parameter governing whether those references should be kept in dedicated,
// separate extension MUCs or whether they should be piggy-backed on top of posts.

// TODO: Once we properly merge conflicting remote changes, deleting stuff
// will be essentially broken. Implement a way to delete stuff without it being
// synced back from another node.
// Maybe a Lamport clock? Did I mention that I like Lamport clocks? :)
// (turns out a simple Lamport clock isn't enough :( )

// TODO add type declarations documenting which Events Identity may emit

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
 *   - USER_NAME (mandatory, only once): Self-explanatory.
 *       UTF-8, maximum 60 bytes by default. Note this might be less than 60 chars.
 *   - RELATES_TO/USER_PROFILEPIC (only once): (TODO rework)
 *       Links to the first cube of a continuation chain containing
 *       this user's profile picture in JPEG format. Maximum size of three
 *       cubes, i.e. just below 3kB.
 *       This is currently UNUSED and NOT IMPLEMENTED.
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
export class Identity extends EventEmitter implements CubeEmitter, Shuttable {

  //###
  // #region Static Construction methods
  //###

  /** @static Tries to load an existing Identity from the network or the CubeStore */
  static async Load(
      cubeStoreOrRetriever: CubeRetrievalInterface<any>,
      username: string,
      password: string,
      options?: IdentityOptions&CubeRequestOptions,
  ): Promise<Identity | undefined> {
    await sodium.ready;
    const masterKey: Buffer = Identity.DeriveMasterKey(username, password,
      options?.argonCpuHardness, options?.argonMemoryHardness);
    const keyPair: KeyPair = Identity.DeriveKeypair(masterKey, options);
    const idMuc: cciCube = ensureCci(await cubeStoreOrRetriever.getCube(
      Buffer.from(keyPair.publicKey), options));
    if (idMuc === undefined) return undefined;
    const identity: Identity =
      await Identity.Construct(cubeStoreOrRetriever, idMuc, options);
    identity.supplyMasterKey(masterKey);
    return identity;
  }

  /** @static Creates a new Identity for a given username and password combination. */
  static async Create(
    cubeStoreOrRetriever: CubeRetrievalInterface<any>,
    username: string,
    password: string,
    options?: IdentityOptions,
  ): Promise<Identity> {
    await sodium.ready;
    const masterKey: Buffer = Identity.DeriveMasterKey(
      username, password,
      options?.argonCpuHardness, options?.argonMemoryHardness);
    return Identity.Construct(cubeStoreOrRetriever, masterKey, options);
  }

  /**
   * @static Convenient await-able wrapper around the constructor.
   * Depending on whether you provide a key pair or an existing Identity MUC,
   * this will either create a brand new Identity or parse an existing one
   * from the supplied MUC.
   * Usage note: Consider using Identity.retrieve() instead which automatically
   * handles loading existing Identities from local storage.
   * @param [cubeStoreOrRetriever] Please provide your node's CubeStore or
   *        CubeRetriever reference here. This param can be explicitly set to
   *        undefined to run an Identity without CubeStore access; this however
   *        severely limits functionality and is really only useful for unit
   *        testing.
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
  static async Construct(
    cubeStoreOrRetriever: CubeRetrievalInterface<any>,
    mucOrMasterkey: cciCube | Buffer,
    options?: IdentityOptions,
  ): Promise<Identity> {
    await sodium.ready;
    const id = new Identity(cubeStoreOrRetriever, mucOrMasterkey, options);
    return id.ready;
  }

  /* @static Retrieves all Identity objects stored in persistant storage. */
  static async Retrieve(
    cubeStoreOrRetriever: CubeRetrievalInterface<any>,
    options?: IdentityOptions
  ): Promise<Identity[]> {
    await sodium.ready;
    const persistance: IdentityPersistence =
      await IdentityPersistence.Construct(options);
    const ids: Array<Identity> = await persistance.retrieve(cubeStoreOrRetriever);
    return ids;
  }

  //###
  // #endregion
  // #region Other static methods
  //###

  /** This method may only be called after awaiting sodium.ready. */
  static DeriveKeypair(masterKey: Buffer, options?: IdentityOptions): KeyPair {
    const contextString: string =
      options?.idmucContextString ?? DEFAULT_IDMUC_CONTEXT_STRING;
    return deriveSigningKeypair(masterKey, IDMUC_MASTERINDEX, contextString);
  }

  /** This method may only be called after awaiting sodium.ready. */
  static DeriveMasterKey(
      username: string,
      password: string,
      argonCpuHardness = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      argonMemoryHardness = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  ): Buffer {
    return Buffer.from(sodium.crypto_pwhash(
      sodium.crypto_sign_SEEDBYTES,
      password,
      sodium.crypto_hash(username, "uint8array").subarray(
        0, sodium.crypto_pwhash_SALTBYTES),
      argonCpuHardness,
      argonMemoryHardness,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
      "uint8array"));
  }

  static ValidateMuc(mucInfo: CubeInfo): boolean {
    // is this even a MUC?
    if (mucInfo.cubeType !== CubeType.MUC &&
        mucInfo.cubeType !== CubeType.MUC_NOTIFY &&
        mucInfo.cubeType !== CubeType.PMUC &&
        mucInfo.cubeType !== CubeType.PMUC_NOTIFY
    ) {
      return false;
    }

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

  /**
   * This is a normalisation method converting various ways an Identity might
   * be represented into a key.
   * @param identity - A string or binary Identity key, or the full Identity
   *   object.
   * @returns - A KeyVariants object containing the key in both its binary
   *   and string representations.
   */
  static KeyVariantsOf(identity: Identity|Buffer|string): KeyVariants {
    const keyInput: Buffer|string = (identity instanceof Identity) ?
      identity.key : identity;
    return keyVariants(keyInput);
  }
  static KeyOf(identity: Identity|Buffer|string): Buffer {
    return Identity.KeyVariantsOf(identity)?.binaryKey;
  }
  static KeyStringOf(identity: Identity|Buffer|string): string {
    return Identity.KeyVariantsOf(identity)?.keyString;
  }

  //###
  // #endregion
  // #region Attribute definitions
  //###

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
  get persistance(): IdentityPersistence { return this.options.identityPersistence }

  /**
   * Identity requires CubeStore for loading and parsing Identity extension
   * Cubes as well as storing locally owned Identities.
   * It can, however, also run in "read-only mode" without a CubeStore reference,
   * which is mainly used for testing.
   **/
  readonly cubeStore: CubeStore;
  /**
   * For light nodes, Identity can additionally use a CubeRetriever to help
   * reconstruct Identity data from the network. If this is not required,
   * it will simply work on the local CubeStore instead.
   */
  readonly cubeRetriever: CubeRetrievalInterface<any> = undefined;
  readonly veritumRetriever: VeritumRetrievalInterface<any> = undefined;
  get retriever(): CubeRetrievalInterface {
    return this.veritumRetriever ?? this.cubeRetriever ?? this.cubeStore;
  }

  private _masterKey: Buffer = undefined;
  get masterKey(): Buffer { return this._masterKey }  // maybe TODO: return copy to improve encapsulation?
  private _encryptionPrivateKey: Buffer;
  private _encryptionPublicKey: Buffer;

  /** @member - The MUC in which this Identity information is stored and published */
  private _muc: cciCube = undefined;

  /** List of own posts, in undefined order */
  private _posts: Set<string> = new Set();

  /**
   * Subscriptions of other identities which are publicly visible to other users.
   * They are also currently the only available type of subscriptions.
   * TODO: Implement private/"secret" subscriptions, too.
   *       Those will need to be stored in a separate, private, encrypted settings MUC.
   */
  private _publicSubscriptions: Set<string> = new Set();

  private _subscriptionRecommendationIndices: Array<cciCube> = [];
  get subscriptionRecommendationIndices(): Array<cciCube> {
    return this._subscriptionRecommendationIndices;
  }

  /** @member - Points to first cube in the profile picture continuation chain */
  profilepic: CubeKey = undefined;

  private _subscriptionRecursionDepth: number = 0;
  get subscriptionRecursionDepth(): number { return this._subscriptionRecursionDepth }

  /** When the user tries to rebuild their Identity MUC too often, we'll
   * remember their request in this promise. Any subsequent Identity changes
   * will then be handles in a single rebuild.
   */
  private makeMucPromise: Promise<cciCube> = undefined;

  // Provide a ready promise
  private readyPromiseResolve: Function;
  private readyPromiseReject: Function;
  private _ready: Promise<Identity> = new Promise<Identity>( (resolve, reject) => {
    this.readyPromiseResolve = resolve; this.readyPromiseReject = reject;
  });
  /**
   * Kindly always await ready before using an Identity, or it might not yet
   * be fully initialized.
   **/
  get ready(): Promise<Identity> { return this._ready }

  get identityStore(): IdentityStore { return this.options.identityStore }

  //###
  // #endregion
  // #region Constructor and post-construction initialization methods
  //###

  /**
   * This constructor may only be called after awaiting sodium.ready.
   * Consider using Identity.Construct() instead of calling the constructor
   * directly which will take care of everything for you.
   * Identity.Construct() has the exact same signature as this constructor;
   * see there for param documentation.
   */
    constructor(
      cubeStoreOrRetriever: CubeRetrievalInterface<any>,
      mucOrMasterkey: cciCube | Buffer,
      readonly options: IdentityOptions = {},
  ){
    super();
    // Remember my Cube retrieval thingie.
    // It could be a CubeStore, a CubeRetriever, a VeritumRetriever, or any
    // custom class implementing the appropriate interface.
    if (typeof cubeStoreOrRetriever?.['getVeritum'] === 'function') {
      // we have a VeritumRetriever!
      this.veritumRetriever = cubeStoreOrRetriever as VeritumRetrievalInterface<any>;
      this.cubeRetriever = cubeStoreOrRetriever;
      this.cubeStore = cubeStoreOrRetriever.cubeStore;
    } else {
      this.veritumRetriever = undefined;
      this.cubeRetriever = cubeStoreOrRetriever;
      this.cubeStore = cubeStoreOrRetriever?.cubeStore;
    }
    // set options
    options.minMucRebuildDelay ??= DEFAULT_MIN_MUC_REBUILD_DELAY;
    options.requiredDifficulty ??= Settings.REQUIRED_DIFFICULTY;
    options.idmucContextString ??= DEFAULT_IDMUC_CONTEXT_STRING;
    options.idmucApplicationString ??= DEFAULT_IDMUC_APPLICATION_STRING;
    options.idmucEncryptionContextString ??= DEFAULT_IDMUC_ENCRYPTION_CONTEXT_STRING;
    // adopt or initialise Identity store
    if (options.identityStore === undefined) {
      options.identityStore = new IdentityStore(this.cubeRetriever);
    }

    // Subscribe to remote Identity updates (i.e. same user using multiple devices)
    if (!(options?.subscribeRemoteChanges === false)) {  // unless explicitly opted out
      this.cubeStore?.on("cubeAdded", this.mergeRemoteChanges);
    }

    // are we loading or creating an Identity?
    if (mucOrMasterkey instanceof Cube) {  // checking for the more generic Cube instead of cciCube as this is the more correct branch compared to handling this as a KeyPair (also Cube subclass handling is not completely clean yet throughout our codebase)
      this.parseMuc(mucOrMasterkey).then(() => {
        // TODO: this makes little sense outside of synthetic tests, see discussion in parseMuc() jsdoc
        this.readyPromiseResolve(this)
    });
    } else {  // create new Identity
      if (Settings.RUNTIME_ASSERTIONS && !(Buffer.isBuffer(mucOrMasterkey))) {
        throw new ApiMisuseError("Identity constructor: Master key must be a Buffer");
      }
      this._masterKey = mucOrMasterkey;
      this._muc = cciCube.ExtensionMuc(
        this._masterKey,
        [],  // TODO: allow to set fields like username directly on construction
        IDMUC_MASTERINDEX, this.options.idmucContextString,
      );
      this.deriveEncryptionKeys();  // must be called after MUC creation as it sets a MUC field
      this.readyPromiseResolve(this);
    }

    // ensure we are present in the IdentityStore
    const added: boolean = options.identityStore.addIdentity(this);
    if (!added) {
      logger.error(`Identity constructor ${this.keyString}: Conflicting Identity of same key already present in IdentityStore. This is most likely a bug in application code; please check your Identity management.`);
    }
  }

  /**
   * Suppose you learn an existing Identity's master key... somehow...
   * Use this method to supply them it :)
   * @throws KeyMismatchError - If supplied master key does not match this Identity's key
   *   (which is supposed to have been derived from the master key).
   */
  supplyMasterKey(masterKey: Buffer) {
    this._masterKey = masterKey;
    this.deriveEncryptionKeys(true);  // will throw on key mismatch
    this.deriveSigningKeys(true);  // will throw on key mismatch
  }

  //###
  // #endregion
  // #region Key-related getters
  //###

  get privateKey(): Buffer { return this._muc?.privateKey; }
  get publicKey(): Buffer { return this._muc?.publicKey; }
  // Note that there are no public setters for keys:
  // Setting new keys is equivalent to creating a new Identity
  // (yes, I know you can reset the keys by going directly to the MUC,
  // just be nice and don't do it)
  private set privateKey(val: Buffer) { this._muc.privateKey = val }
  private set publicKey(val: Buffer) { this._muc.publicKey = val }

  get encryptionPrivateKey(): Buffer { return this._encryptionPrivateKey }
  get encryptionPublicKey(): Buffer { return this._encryptionPublicKey }

  /**
   * @member Get this Identity's key, which equals its MUC's cube key,
   * which is its cryptographic public key.
   * (Yes, I know this is functionally identical with publicKey(), but it's
   * about the semantics :-P )
  */
  get key(): CubeKey { return this._muc?.publicKey; }
  get keyString(): string { return this._muc?.publicKey?.toString('hex') }

  get muc(): cciCube { return this._muc; }

  //###
  // #endregion
  // #region Post and subscription managment
  //###

  /** Stores a new cube key a the the beginning of my post list */
  addPost(keyInput: CubeKey | string): boolean {
    const key = keyVariants(keyInput);  // normalise input
    // maybe TODO optimise: remove unnecessary conversion to binary in case
    //   of string input
    // sanity check
    if (key?.binaryKey?.length != NetConstants.CUBE_KEY_SIZE) return false;

    // everything looks good, let's remember this post
    this._posts.add(key.keyString);

    // emit events
    this.emitCubeAdded(key.binaryKey);
    this.emitPostAdded(key.binaryKey);
    return true;
  }

  /** Removes a cube key from my post list */
  removePost(keyInput: CubeKey | string) {
    const key = keyVariants(keyInput);
    this._posts.delete(key.keyString);
  }

  addPublicSubscription(remoteIdentity: CubeKey | string | Identity): Promise<void> {
    const key: string = Identity.KeyStringOf(remoteIdentity);
    if (key) {
      this._publicSubscriptions.add(key);
      // emit event
      this.emitCubeAdded(key);
      // set event recursion depth
      if (this._subscriptionRecursionDepth > 0) {
        const subPromise: Promise<Identity> = this.identityStore.retrieveIdentity(key);
        return subPromise.then((sub: Identity) => {
          return this.setSubscriptionRecursionDepthPerSub(sub);
        })
      } else return Promise.resolve();
    } else {
      logger.warn("Identity: Ignoring subscription request to something that does not at all look like a CubeKey");
      return Promise.resolve();
    }
  }

  removePublicSubscription(remoteIdentity: CubeKey | string | Identity) {
    const key: string = Identity.KeyStringOf(remoteIdentity);
    if (key) {
      this._publicSubscriptions.delete(key);
    } else {
      logger.warn("Identity: Ignoring unsubscription request to something that does not at all look like a CubeKey");
    }
  }



  //###
  // #endregion
  // #region Post/Subscription/Cube getters, Generators and Emission
  //###

  /**
   * @yields The keys of all of this user's posts as binary keys.
   * Note that this is a synchroneous method and there is no recursion option.
   */
  *getPostKeys(): Iterable<CubeKey> {
    for (const key of this._posts) yield keyVariants(key).binaryKey;
  }

  /**
   * @returns The keys of all of this user's posts as hex strings.
   * Note that this is a synchroneous method and there is no recursion option.
   */
  getPostKeyStrings(): Iterable<string> { return this._posts.values() }

  /** @returns The number of this user's posts */
  getPostCount(): number { return this._posts.size }

  /** @returns Whether or not this user has a post by this key */
  hasPost(keyInput: CubeKey | string): boolean {
    return this._posts.has(keyVariants(keyInput).keyString);
  }

  /** @deprecated */
  async *getPostCubeInfos(): AsyncGenerator<CubeInfo, void, undefined> {
    const promises: Promise<CubeInfo>[] = [];
    for (const post of this.getPostKeyStrings()) {
      promises.push(this.cubeRetriever.getCubeInfo(post));
    }
    yield *resolveAndYield(promises);
  }


  getPosts(options?: GetPostsOptions): AsyncGenerator<Veritum>;
  getPosts(options: { format: PostFormat.Veritum} ): AsyncGenerator<Veritum>;
  getPosts(options: { format: PostFormat.Cube} ): AsyncGenerator<Cube>;
  getPosts(options: { format: PostFormat.CubeInfo} ): AsyncGenerator<CubeInfo>;
  getPosts(options: GetPostsOptions): AsyncGenerator<CubeInfo|Cube|Veritum>;
  async *getPosts(
    options: GetPostsOptions = {},
  ): AsyncGenerator<CubeInfo|Cube|Veritum> {
    // set default options
    options.format ??= this.veritumRetriever? PostFormat.Veritum: PostFormat.Cube;
    options.subscriptionRecursionDepth ??= this.subscriptionRecursionDepth;
    // note: recursionExclude set created below to avoid unnecessary constructions

    // check if we even have the means to fulfil this request
    if (this.cubeStore === undefined) {
      logger.error(`Identity ${this.keyString} getPosts(): This Identity was created without CubeStore or CubeRetriever access, cannot fulfil request.`);
      return;
    }
    if (options.format === PostFormat.Veritum && this.veritumRetriever === undefined) {
      logger.error(`Identity ${this.keyString} getPosts(): Requested posts as Verity but this Identity was created without a VeritumRetriever reference, cannot fulfil request.`);
      return;
    }

    // have we reached maximum recursion depth?
    if (options.subscriptionRecursionDepth < 0) {
      logger.trace(`Identity.getPosts(): Recursion depth exceeded for Identity ${this.keyString}; aborting.`);
      return;
    }

    // Avoid ping-ponging recursion by keeping track of already visited IDs
    options.recursionExclude ??= new Set();
    if (options.recursionExclude.has(this.keyString)) return;
    else options.recursionExclude.add(this.keyString);

    // Get all my posts (as retrieval promises)
    const minePromises: Promise<CubeInfo|Cube|Veritum>[] = [];
    for (const post of this.getPostKeyStrings()) {
      let promise: Promise<CubeInfo|Cube|Veritum>;
      switch(options.format) {
        case PostFormat.CubeInfo:
          promise = this.cubeRetriever.getCubeInfo(post);
        case PostFormat.Cube:
          promise = this.cubeRetriever.getCube(post);
          break;
        case PostFormat.Veritum:
          promise = this.veritumRetriever.getVeritum(post, {
            recipient: this,
          });
          break;
      }
      if (promise !== undefined) minePromises.push(promise);
    }

    // Prepare Generator for my posts
    const mine: AsyncGenerator<CubeInfo|Cube|Veritum> = resolveAndYield(minePromises);

    // Prepare Generators for my subscription's posts
    const rGens: AsyncGenerator<CubeInfo|Cube|Veritum>[] = [];
    if (options.subscriptionRecursionDepth > 0) {
      for (const subKey of this.getPublicSubscriptionStrings()) {
        rGens.push(this.getPublicSubscriptionPosts(subKey, {
          ...options,
          subscriptionRecursionDepth: options.subscriptionRecursionDepth - 1,
        }));
      }
    }

    // Merge all those generators
    const ret: AsyncGenerator<CubeInfo|Cube|Veritum> = mergeAsyncGenerators(
      mine, ...rGens);

    // Yield all the (existing) posts that we've just prepared
    yield* ret;

    // TODO: In subscription mode, keep going and yield new data as it arrives
  }

  /**
   * @yields The keys of all other Identities this user has publically
   * subscribed, as binary keys.
   * Note that this is a synchroneous method and there is no recursion option.
   **/
  *getPublicSubscriptionKeys(): Iterable<CubeKey> {
    for (const key of this._publicSubscriptions) yield keyVariants(key).binaryKey;
  }

  /**
   * @returns The keys of all other Identities this user has publically
   * subscribed, as hex strings.
   * Note that this is a synchroneous method and there is no recursion option.
   **/
  getPublicSubscriptionStrings(): Iterable<string> {
    return this._publicSubscriptions.values()
  }

  /** @returns The amount of other Identities this user has publically subscribed. */
  getPublicSubscriptionCount(): number { return this._publicSubscriptions.size }

  /** @returns Whether or not this user has publically subscribed that other Identity */
  hasPublicSubscription(other: CubeKey | string | Identity): boolean {
    return this._publicSubscriptions.has(Identity.KeyStringOf(other));
  }

  /** @yields CubeInfo objects for all of this user's public subscriptions. */
  async *getPublicSubscriptionCubeInfos(): AsyncGenerator<CubeInfo, void, undefined> {
    const promises: Promise<CubeInfo>[] = [];
    for (const sub of this.getPublicSubscriptionStrings()) {
      promises.push(this.cubeRetriever.getCubeInfo(sub));
    }
    yield *resolveAndYield(promises);
  }

  /** @yields Identity objects for all of this user's public subscriptions */
  async *getPublicSubscriptionIdentities(): AsyncGenerator<Identity> {
    for (const sub of this.getPublicSubscriptionStrings()) {
      const retrieved: Identity = await this.identityStore.retrieveIdentity(sub);
      if (retrieved !== undefined) yield retrieved;
    }
  }

  /**
   * @returns An Identity object for the specified subscribed user
   * Note that this actually also works for non-subscribed users;
   * Note that the returned Identity is no necessarily fully ready yet;
   * caller should await the returned Identity's ready promise if required.
   **/
  getPublicSubscriptionIdentity(keyInput: CubeKey|string): Promise<Identity> {
    return this.identityStore.retrieveIdentity(keyInput);
  }

  /**
   * Retrieves the posts by a specific subscribed Identity.
   * Note that this actually also works for non-subscribed users.
   */
  async *getPublicSubscriptionPosts(keyInput: CubeKey|string, options?: GetPostsOptions): AsyncGenerator<Veritum> {
    const identity: Identity = await this.getPublicSubscriptionIdentity(keyInput);
    if (identity !== undefined) {
      yield* identity.getPosts(options);
    }
  }


  /**
   * Persuant to the CubeEmitter interface, this Generator yields CubeInfos
   * for all events that we either have or would have emitted "cubeAdded" for.
   * Those include:
   *  - this Identity's MUC
   *  - all of this Identity's posts
   *  - all of this Identity's subscriptions
   *  - once setSubscriptionRecursion() has been called:
   *    - all of our subscribed Identity's posts
   *    - all of our subscribed Identity's subscriptions
   *    - and if setSubscriptionRecursion() was called with a depth > 1, the
   *      same for all of our indirect subscriptions up to the specified depth
   */
  async *getAllCubeInfos(
    subscriptionRecursionDepth: number = this._subscriptionRecursionDepth,
    exclude: Set<string> = new Set(),
  ): AsyncGenerator<CubeInfo> {
    // Avoid ping-ponging recursion by keeping track of already visited IDs
    if (exclude.has(this.keyString)) return;
    else exclude.add(this.keyString);

    // yield myself
    yield this.muc.getCubeInfo();

    // will also yield:
    // - my posts
    const posts: AsyncGenerator<CubeInfo> = this.getPostCubeInfos();
    // - my subscriptions
    // maybe TODO avoid double fetch (CubeInfos here, Identites below)?
    const subs: AsyncGenerator<CubeInfo> = this.getPublicSubscriptionCubeInfos();
    // - recurse through my subscriptions
    const rGens: AsyncGenerator<CubeInfo>[] = [];
    if (subscriptionRecursionDepth > 0) {
      for await (const sub of this.getPublicSubscriptionIdentities()) {
        rGens.push(sub.getAllCubeInfos(subscriptionRecursionDepth - 1, exclude));
      }
    }
    const ret: AsyncGenerator<CubeInfo> = mergeAsyncGenerators(posts, subs, ...rGens);
    yield* ret;
  }

  async setSubscriptionRecursionDepth(
      depth: number = this._subscriptionRecursionDepth,
      except: Set<string> = new Set(),
  ): Promise<void> {
    //  - TODO: Make subscription depth dynamic:
    //    We'll need a global maximum of in-memory Identites
    //    at some point. Reduce WOT depth automatically once it is reached.

    // prevent infinite recursion
    if (except.has(this.keyString)) return Promise.resolve();
    else except.add(this.keyString);

    this._subscriptionRecursionDepth = depth;
    const donePromises: Promise<void>[] = [];
    for await (const sub of this.getPublicSubscriptionIdentities()) {
      donePromises.push(this.setSubscriptionRecursionDepthPerSub(sub, depth, except));
    }
    return Promise.all(donePromises).then(() => undefined);
  }

  //###
  // #endregion
  // #region Marshalling and Demarshalling (public)
  //###

  /**
   * Save this Identity locally by storing it in the local database
   * and publish it by inserting it into the CubeStore.
   * (You could also provide a private cubeStore instead, but why should you?)
   */
  async store():Promise<cciCube>{
    // sanity checks
    if (this.cubeStore === undefined) {
      throw new VerityError("Identity.store(): This Identity is running in read-only mode (i.e. does not have a CubeStore reference), thus store() is not possible.");
    }
    if (!this.privateKey || !this.masterKey) {
      throw new VerityError("Identity.store(): Cannot store an Identity whose private and master key I don't have");
    }
    logger.trace("Identity: Storing identity " + this.name);
    const muc = await this.makeMUC();
    for (const extensionMuc of this.subscriptionRecommendationIndices) {
      await this.cubeStore.addCube(extensionMuc);
    }
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
  async makeMUC(): Promise<cciCube> {
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
    const earliestAllowed: number = this.muc.getDate() + this.options.minMucRebuildDelay;
    if (unixtime() < earliestAllowed) {
      const waitFor = earliestAllowed - (Math.floor(Date.now() / 1000));
      await new Promise(resolve => setTimeout(resolve, waitFor*1000));
    }

    const initialFields: VerityField[] = [];
    // Write notification key if requested
    if (this.options.idmucNotificationKey?.length === NetConstants.CUBE_KEY_SIZE) {
      initialFields.push(VerityField.Notify(this.options.idmucNotificationKey));
    }

    const newMuc: cciCube = cciCube.MUC(
      this._muc.publicKey, this._muc.privateKey, {
        fields: initialFields,
        requiredDifficulty: this.options.requiredDifficulty
    });
    // Include application header if requested
    if (this.options.idmucApplicationString) {
      newMuc.insertFieldBeforeBackPositionals(
        VerityField.Application(this.options.idmucApplicationString));
    }

    // Write username
    if (this.name) {
      newMuc.insertFieldBeforeBackPositionals(VerityField.Username(this.name));
    }

    // Write encryption public key
    if (this.encryptionPublicKey) {
      newMuc.insertFieldBeforeBackPositionals(VerityField.CryptoPubkey(this.encryptionPublicKey));
    }

    // Write avatar string
    if (this._avatar !== undefined &&
        this.avatar.scheme != AvatarScheme.UNKNOWN &&
        !(this._avatar.equals(this.defaultAvatar()))) {
          newMuc.insertFieldBeforeBackPositionals(this.avatar.toField());
    }

    // Write profile picture reference
    if (this.profilepic) {
      newMuc.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
        new Relationship(RelationshipType.ILLUSTRATION, this.profilepic)
      ));
    }

    // Write subscription recommendations
    // (these will be in their own sub-MUCs and we'll reference the first one
    // of those here)
    this.writeSubscriptionRecommendations();
    if (this.subscriptionRecommendationIndices.length) {  // any subs at all?
      newMuc.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
        new Relationship(RelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX,
          this.subscriptionRecommendationIndices[0].getKeyIfAvailable())));
          // note: key is always available as this is a MUC
    }

    // Write my post references, as many as will fit into the MUC.
    // Note: We currently just include our newest post here, and then include
    // reference to older posts within our new posts themselves.
    // We might need to change that again as it basically precludes us from ever
    // de-referencing ("deleting") as post.
    // TODO BUGBUG: This assumes that posts themselves take care of inserting
    //   older post references, which no CCI layer primitive currently provides;
    //   only the ZW app layer makePost() does this!
    // TODO: get rid of intermediate Array
    // TODO: find a smarter way to determine reference order than local insertion
    //   order, as local insertion order is not guaranteed to be stable when it
    //   has itself been restored from a MUC.
    const newestPostsFirst: string[] = Array.from(this.getPostKeyStrings()).reverse();
    newMuc.fields.insertTillFull(VerityField.FromRelationships(
      Relationship.fromKeys(RelationshipType.MYPOST, newestPostsFirst)));

    await newMuc.getBinaryData();  // compile MUC
    this.emitCubeAdded(newMuc);
    this._muc = newMuc;

    makeMucPromiseResolve(newMuc);
    this.makeMucPromise = undefined;  // all done, no more open promises!
    return newMuc;
  }

  //###
  // #endregion
  // #region Misc public methods
  //###

  /**
   * Returns this Identity's default Avatar, i.e. the one used as long as
   * the user didn't choose one. It's based on this Identity's public key.
   */
  defaultAvatar(): Avatar {
    const def = new Avatar(this.publicKey, DEFAULT_AVATARSCHEME);
    return def;
  }

  // implement Shuttable
  private _shutdown: boolean = false;
  get shuttingDown(): boolean { return this._shutdown }
  private shutdownPromiseResolve: () => void;
  shutdownPromise: Promise<void> =
    new Promise(resolve => this.shutdownPromiseResolve = resolve);

  shutdown(): Promise<void> {
    // mark myself as shutting down
    this._shutdown = true;
    // cancel event subscriptions
    this.cubeStore?.removeListener("cubeAdded", this.mergeRemoteChanges);
    // TODO cancel subscriptions with my subscribed Identites
    // remove myself from my IdentityStore
    this.identityStore?.deleteIdentity(this);
    // resolve shutdown promise
    this.shutdownPromiseResolve();
    return this.shutdownPromise;
  }

  /** @deprecated Currently unused */
  async recursiveWebOfSubscriptions(maxDepth: number = 1, curDepth: number = 0): Promise<Set<string>> {
    // sanity checks
    if (this.cubeRetriever === undefined) {
      throw new VerityError("Identity.recursiveWebOfSubscriptions(): This Identity is running in read-only mode (i.e. does not have a CubeStore/CubeRetriever reference), thus recursiveWebOfSubscriptions() is not possible.");
    }
    let recursiveSubs: Set<string> = new Set(this._publicSubscriptions);
    if (curDepth < maxDepth) {
      for (const sub of this._publicSubscriptions) {
        const muc: cciCube = ensureCci(await this.cubeRetriever.getCube(sub));
        if (!muc) continue;
        let id: Identity;
        try {
          id = await Identity.Construct(this.cubeRetriever, muc);
        } catch(err) { continue; }
        if (!id) continue;
        recursiveSubs = new Set([...recursiveSubs,
          ...(await id.recursiveWebOfSubscriptions(maxDepth, curDepth+1))]
        );  // TODO: use Set.union() instead once it's widely available
      }
    }
    return recursiveSubs;
  }

  //###
  // #endregion
  // #region PRIVATE marshalling and demarshalling
  //###

  private writeSubscriptionRecommendations(): void {
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
    const fieldSets: VerityFields[] = [];
    let fields: VerityFields = new VerityFields([], cciMucFieldDefinition);
    if (this.options.idmucApplicationString) {
      fields.appendField(VerityField.Application(this.options.idmucApplicationString));
    }
    // TODO get rid of intermediate Array
    const subs: string[] = Array.from(this._publicSubscriptions).reverse();
    for (let i=0; i<subs.length; i++) {
      // write rel
      fields.appendField(VerityField.RelatesTo(new Relationship(
        RelationshipType.SUBSCRIPTION_RECOMMENDATION,
        keyVariants(subs[i]).binaryKey
      )));

      // time to roll over to the field set for the next cube?
      if (i % relsPerCube == relsPerCube - 1 ||
          i == this.getPublicSubscriptionCount() - 1) {
        fieldSets.push(fields);
        fields = new VerityFields([], cciMucFieldDefinition);
        if (this.options.idmucApplicationString) {
          fields.appendField(VerityField.Application(this.options.idmucApplicationString));
        }
      }
    }
    // Now sculpt the index cubes using the field sets generated before,
    // in reverse order so we can link them together
    for (let i=fieldSets.length - 1; i>=0; i--) {
      fields = fieldSets[i];
      // chain the index cubes together:
      if (i < fieldSets.length - 1 ) {  // last one has no successor, obviously
        fields.appendField(VerityField.RelatesTo(new Relationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX,
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
          false, cciFamily, this.options.requiredDifficulty);
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
   * @returns A promise that will resolve once the Identity reconstruction
   *   process has completed, no matter how successfully so.
   *   The returned promise should *not* be awaited in any interactive context:
   *   (Implementation note / TODO following... whatever, I'll just put that here.)
   *   At least with "foreign" Identities (i.e. Identities not owned by this
   *   node's user) it is expected that some older sub-referenced information
   *   (e.g. lists of old posts) may at some point drop out of the network.
   *   Whenever that happens, the returned promise will not resolve until
   *   after the final timeout, which defaults to at least 60 seconds.
   *   This makes it completely unacceptable to await this promise in any
   *   interactive use case.
   *   Furthermore, this promise finally resolving confers no information
   *   whatsoever on whether the Identity was restored successfully.
   *   In the extreme case of trying to restore on an offline node,
   *   it will just resolve after the retrieval timeout and still be no good.
   *   We need to rethink that...
   */
  private parseMuc(muc: cciCube): Promise<void> {
    if (Settings.RUNTIME_ASSERTIONS) {
      // disabled for now: Identity doesn't *really* require a cciCube object
      // and our codebase currently does not cleanly distinguish required
      // Cube classes yet
      // if (!(muc instanceof cciCube)) {
      //   this.readyPromiseReject(new CubeError("Identity: Supplied Cube is not as CCI Cube"));
      //   return;
      // }
      if (muc.cubeType !== CubeType.MUC &&
          muc.cubeType !== CubeType.MUC_NOTIFY &&
          muc.cubeType !== CubeType.PMUC &&
          muc.cubeType !== CubeType.PMUC_NOTIFY
      ) {
        logger.error("Identity: Supplied Cube is not a MUC");
        this.readyPromiseResolve(this);
        return;
      }
    }

    // read name
    const nameField: VerityField = muc.getFirstField(FieldType.USERNAME);
    if (nameField) this.name = nameField.value.toString('utf-8');

    // read encryption public key
    const encryptionPublicKeyField: VerityField =
      muc.getFirstField(FieldType.CRYPTO_PUBKEY);
    if (encryptionPublicKeyField) {
      this._encryptionPublicKey = encryptionPublicKeyField.value;
    }

    // read cube references, these being:
    // - avatar seed
    const avatarSeedField: VerityField = muc.getFirstField(FieldType.AVATAR);
    if (avatarSeedField) {
      this._avatar = new Avatar(avatarSeedField);
    }

    // - profile picture reference
    const profilePictureRel: Relationship = muc.fields.getFirstRelationship(
      RelationshipType.ILLUSTRATION);
    if (profilePictureRel) this.profilepic = profilePictureRel.remoteKey;

    // - recursively fetch my-post references
    const postPromise: Promise<void> =
      this.recursiveParsePostReferences(muc, []);

    // recursively fetch my own SUBSCRIPTION_RECOMMENDATION references
    const subRecPromise: Promise<void> =
      this.recursiveParseSubscriptionRecommendations(muc);
    // last but not least: store this MUC as our MUC
    this._muc = muc;

    return Promise.all(  // HACKHACK typecast
      [postPromise, subRecPromise]) as unknown as Promise<void>;
  }

  // TODO: implement an actual merge
  private mergeRemoteChanges = (incoming: CubeInfo): void => {
    // check if this is even our MUC
    if (!this.key ||  // can't perform merge if we don't even know our own key
        !(incoming.key?.equals(this.key))) return;
    // optimization: check if this is even an update and skip if it isn't
    if (
        this.muc.getHashIfAvailable() &&  // need to know own hash for skipping,
        incoming.getCube().getHashIfAvailable() &&  // need to know incoming hash,
        this.muc.getHashIfAvailable().equals(  // and they need to be equal
          incoming.getCube().getHashIfAvailable())
    ){ return }
    // check if this MUC is even valid
    if (!Identity.ValidateMuc(incoming)) return;
    // TODO: This does not actually perform a merge.
    // It just gives precedence to "never" version, which is not a good idea
    // to start with and is exacerbated by the fact that no actual time
    // synchronisation exists between nodes.
    // TODO: This currently creates a race condition as parseMuc() is async.
    if (incoming.date > this.muc.getDate()) {
      this.parseMuc(incoming.getCube() as cciCube);
      logger.trace("Identity.mergeRemoteChanges: Adopting incoming MUC");
    } else {
      logger.trace("Identity.mergeRemoteChanges: Rejecting incoming MUC as mine is newer");
    }
  }

  // TODO: check and limit recursion
  private async recursiveParseSubscriptionRecommendations(
      mucOrMucExtension: Cube,
      alreadyTraversedCubes: string[] = []
  ): Promise<void> {
    // sanity check
    if (this.cubeRetriever === undefined) {
      logger.error("Identity.recursiveParseSubscriptionRecommendations(): This Identity is running in read-only mode (i.e. does not have a CubeRetriever reference), thus recursiveParseSubscriptionRecommendations() is not possible.");
      return;
    }
    // do we even have this cube?
    if (!mucOrMucExtension) return;
    // have we been here before? avoid endless recursion
    const thisCubesKeyString = (mucOrMucExtension.getKeyIfAvailable()).toString('hex');
    if (thisCubesKeyString === undefined || alreadyTraversedCubes.includes(thisCubesKeyString)) return;
    else alreadyTraversedCubes.push(thisCubesKeyString);

    // parse this index cube
    if (!(mucOrMucExtension.fields instanceof VerityFields)) return;  // no CCI, no rels
    const fields: VerityFields = mucOrMucExtension.fields as VerityFields;
    if (!fields) return;
    // save the subscriptions recommendations provided:
    const subs = fields.getRelationships(
      RelationshipType.SUBSCRIPTION_RECOMMENDATION);
    for (const sub of subs) {
      this.addPublicSubscription(sub.remoteKey);
    }
    // recurse through further index cubes, if any:
    const furtherIndices = fields.getRelationships(
      RelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX);
    for (const furtherIndex of furtherIndices) {
      const furtherCube: Cube = await this.cubeRetriever.getCube(furtherIndex.remoteKey);
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
  private recursiveParsePostReferences(
      mucOrMucExtension: Cube,
      alreadyTraversedCubes: string[],  // TODO make this a Set
  ): Promise<void> {
    // sanity check
    if (this.cubeRetriever === undefined) {
      logger.warn("Identity.recursiveParsePostReferences(): This Identity is running in read-only mode (i.e. does not have a CubeRetriever reference), thus posts will not be parsed.");
      return;
    }
    // do we even have this cube?
    if (!mucOrMucExtension) {
      // Nothing to do here, so just return a resolved promise
      return new Promise<void>(resolve => resolve());
    }
    // have we been here before? avoid endless recursion
    const thisCubesKeyString = (mucOrMucExtension.getKeyStringIfAvailable());
    if (thisCubesKeyString === undefined ||
        alreadyTraversedCubes.includes(thisCubesKeyString)
    ){
      // Nothing to do here, so just return a resolved promise
      return new Promise<void>(resolve => resolve());
    }
    else { alreadyTraversedCubes.push(thisCubesKeyString) }

    if (!(mucOrMucExtension.fields instanceof VerityFields)) {
      return new Promise<void>(resolve => resolve());  // no CCI, no rels
    }
    const fields: VerityFields = mucOrMucExtension.fields as VerityFields;
    if (!fields) return new Promise<void>(resolve => resolve());

    // prepare return promises
    const retPromises: Promise<void>[] = [];

    const myPostRels: Relationship[] = fields.getRelationships(
      RelationshipType.MYPOST);
    for (const postrel of myPostRels) {
      if (this.hasPost(postrel.remoteKey)) {
        // if we'we already parsed this post, skip it
        continue;
      }
      // fetch referred post
      const postPromise: Promise<CubeInfo> =
        this.cubeRetriever.getCubeInfo(postrel.remoteKey);
      const recursionPromise: Promise<void> = postPromise.then((postInfo: CubeInfo) => {
        if (!postInfo) {  // skip posts we don't actually have
          // TODO: reconsider whether this is actually a good idea.
          // A user's post is after all still this user's post even if it happens
          // not to be available at this moment...
          logger.trace(`Identity.recursiveParsePostReferences(): While reconstructing the post list of Identity ${this.keyString} I skipped a post as I can't find it.`);
          return;
        }
        if (this.hasPost(postInfo.keyString)) {
          // if we'we already parsed this post, skip it
          // (re-checking this here as things might have changed while we
          // waited for the post to get fetched)
          return;
        }
        // Parse & remember this post
        const post: Cube = postInfo.getCube();
        if (post === undefined) return;
        if (this.addPost(post.getKeyStringIfAvailable())) {
          // logger.trace(`Identity ${this.keyString} recursiveParsePostReferences(): Successfully recovered my post ${post.getKeyStringIfAvailable()}. Continuing recursion.`);
        } else {
          logger.trace(`Identity ${this.keyString} recursiveParsePostReferences(): Failed to recover my post ${post.getKeyStringIfAvailable()} even though I fetched the Cube. Still trying to continue the recursive restore.`);
        }

        // Continue recursion:
        // Search for further post references within this post.
        const recursionDone: Promise<void> =
          this.recursiveParsePostReferences(post, alreadyTraversedCubes);
        return recursionDone;
      });
      retPromises.push(recursionPromise);
    }
    return Promise.all(retPromises) as unknown as Promise<void>;  // HACKHACK typecast
  }

  //###
  // #endregion
  // #region PRIVATE key management methods
  //###

  /**
   * Derives this Identity's encryption keys from its master key
   * @param throwOnMismatch Whether to throw an error if the derived keys do not match
   */
  private deriveEncryptionKeys(throwOnMismatch: boolean = true) {
    // derive key
    const encryptionKeyPair: KeyPair = deriveEncryptionKeypair(
      this.masterKey,
      DEFAULT_IDMUC_ENCRYPTION_KEY_INDEX,
      this.options.idmucEncryptionContextString
    );
    // check for potential mismatches
    if (throwOnMismatch) {
      if (this._encryptionPrivateKey &&
          !this._encryptionPrivateKey.equals(encryptionKeyPair.privateKey)) {
        throw new KeyMismatchError("Identity.deriveEncryptionKeys(): Deriving the master key does not yield the already supplied encryption private key. At some point, you must have supplied keys that do not match.");
      }
      if (this.encryptionPublicKey &&
          !this.encryptionPublicKey.equals(encryptionKeyPair.publicKey)) {
        throw new KeyMismatchError("Identity.deriveEncryptionKeys(): Deriving the master key does not yield the already supplied encryption public key. At some point, you must have supplied keys that do not match.");
      }
    }
    // set derived keys
    this._encryptionPrivateKey = Buffer.from(encryptionKeyPair.privateKey);
    this._encryptionPublicKey = Buffer.from(encryptionKeyPair.publicKey);
  }

  /**
   * Derives this Identity's signing keys from its master key
   * @param throwOnMismatch Whether to throw an error if the derived keys do not match
   */
  private deriveSigningKeys(throwOnMismatch: boolean = true) {
    // derive key
    const signingKeyPair: KeyPair = deriveSigningKeypair(
      this.masterKey,
      IDMUC_MASTERINDEX,
      this.options.idmucContextString
    );
    // check for potential mismatches
    if (throwOnMismatch) {
      if (this.privateKey &&
          !this.privateKey.equals(signingKeyPair.privateKey)) {
        throw new KeyMismatchError("Identity.deriveSigningKeys(): Deriving the master key does not yield the already supplied signing private key. At some point, you must have supplied keys that do not match.");
      }
      if (this.publicKey &&
          !this.publicKey.equals(signingKeyPair.publicKey)) {
        throw new KeyMismatchError("Identity.deriveSigningKeys(): Deriving the master key does not yield the already supplied signing public key. At some point, you must have supplied keys that do not match.");
      }
    }
    // set derived keys
    this.privateKey = signingKeyPair.privateKey;
    this.publicKey = signingKeyPair.publicKey;
  }

  //###
  // #endregion
  // #region PRIVATE Post/Subscription/Cube Emission
  //###

  private setSubscriptionRecursionDepthPerSub(
    sub: Identity,
    depth: number = this._subscriptionRecursionDepth,
    except: Set<string> = new Set(),
  ): Promise<void> {
  // input sanitisation
  if (sub === undefined) {
    logger.warn('Identity.setSubscriptionRecursionDepthPerSub(): param sub is undefined; skipping.');
    return Promise.resolve();
  }
  // Prevent infinite recursion.
  // (Sub will itself add itself to the except set once it has been called.)
  if (except.has(sub.keyString)) return Promise.resolve();

  // If any recursion is requested at all, we will re-emit my subscription's events.
  // Otherwise, we obviously cancel our re-emissions.
  if (depth > 0) {
    if (!sub.listeners('cubeAdded').includes(this.doEmitCubeAdded)) {
      sub.on('cubeAdded', this.doEmitCubeAdded);
    }
    if (!sub.listeners('postAdded').includes(this.emitCubeAdded)) {
      sub.on('postAdded', this.doEmitPostAdded);
    }
  } else {
    sub.removeListener('cubeAdded', this.doEmitCubeAdded);
    sub.removeListener('postAdded', this.doEmitPostAdded);
  }

  // Let my subscriptions know the new recursion level, which is obviously
  // reduces by one as we're descending one level.
  const nextLevelDepth: number = (depth < 1) ? 0 : depth - 1;
  return sub.setSubscriptionRecursionDepth(nextLevelDepth, except);
}

  private async emitCubeAdded(
      input: CubeKey|string|CubeInfo|Cube|Promise<CubeInfo>,
  ): Promise<void> {
    if (!this.shouldIEmit('cubeAdded')) return;  // should I even emit?
    const cubeInfo = await this.retrieveCubeInfo(input);  // normalise input

    // assert that we have a CubeInfo -- this also covers invalid input
    if (cubeInfo === undefined) {
      logger.warn(`Identity ${this.keyString}.emitCubeAdded() was called for an unavailable CubeInfo; skipping.`);
      return;
    }

    this.doEmitCubeAdded(cubeInfo);  // okay, emit!
  }

  private retrieveCubeInfo(input: CubeKey|string|CubeInfo|Cube|Promise<CubeInfo>): Promise<CubeInfo> {
    if (input instanceof CubeInfo) {
      return Promise.resolve(input);
    } else if (input instanceof Cube) {
      return input.getCubeInfo();
    } else if (input instanceof Promise) {
      return input;
    } else if (typeof input === 'string' || Buffer.isBuffer(input)) {
      return this.retriever?.getCubeInfo?.(input) ?? Promise.resolve(undefined);  // TODO implement dummy retriever
    }
  }

  // Note: Must use arrow function syntax to keep this method correctly bound
  //       for method handler adding and removal.
  //       This method is also used for recursive re-emissions
  private doEmitCubeAdded = (
    payload: CubeInfo,
    recursionCount: number = 0,
    except: Set<string> = new Set(),
  ): void => {
    if (this.shouldIEmit('cubeAdded', recursionCount, except)) {
      this.doEmit('cubeAdded', payload, recursionCount, except);
    }
  }

  private async emitPostAdded(key: CubeKey): Promise<void> {
    if (!this.shouldIEmit('postAdded')) return;  // should I even emit?
    const veritum = await this.veritumRetriever?.getVeritum?.(key);
    if (veritum === undefined) {
      logger.warn(`Identity ${this.keyString}.emitPostAdded() was called for an unavailable post; skipping.`);
      return;
    }
    this.doEmitPostAdded(veritum);  // okay, emit!
  }


  // Note: Must use arrow function syntax to keep this method correctly bound
  //       for method handler adding and removal.
  //       This method is also used for recursive re-emissions
  private doEmitPostAdded = (
    post: Veritum,
    recursionCount: number = 0,
    except: Set<string> = new Set(),
  ): void => {
    if (this.shouldIEmit('postAdded', recursionCount, except)) {
      this.doEmit('postAdded', post, recursionCount, except);
    }
  }


  private shouldIEmit(
    eventName: string,
    recursionCount: number = 0,
    except?: Set<string>,
  ): boolean {
    // only emit if there is a listener
    if (this.listenerCount(eventName) === 0) return false;

    // prevent endless recursion by keeping track of the recursion count
    if (recursionCount > this._subscriptionRecursionDepth) {
      logger.warn(`Identity ${this.keyString}.emitCubeAdded() was called for a CubeInfo with too many levels of recursion; skipping.`);
      return false;
    }

    // avoid ping-ponging recursion by keeping track of already visited IDs
    if (except?.has?.(this.keyString)) return false;

    return true;
  }

  private doEmit(
    eventName: string,
    payload: any,
    recursionCount: number = 0,
    except: Set<string>,
  ): void {
    recursionCount++;
    except.add(this.keyString);
    this.emit(eventName, payload, recursionCount, except);
  }

  //###
  // #endregion
  //###
}
