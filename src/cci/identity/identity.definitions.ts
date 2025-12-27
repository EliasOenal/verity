import type { MergedAsyncGenerator } from "../../core/helpers/asyncGenerators";

import type { CubeKey, NotificationKey } from "../../core/cube/coreCube.definitions";
import type { CoreCube } from "../../core/cube/coreCube";
import type { CubeEmitterEvents } from "../../core/cube/cubeRetrieval.definitions";

import type { CubeRequestOptions } from "../../core/networking/cubeRetrieval/requestScheduler";

import type { Veritum } from "../veritum/veritum";
import type { MetadataEnhancedRetrieval, ResolveRelsResult, ResolveRelsRecursiveResult } from "../veritum/veritumRetrievalUtil";
import type { GetVeritumOptions } from "../veritum/veritumRetriever";

import type { Identity } from "./identity";
import type { IdentityPersistence } from "./identityPersistence";
import type { IdentityStore } from "./identityStore";
import { RetrievalFormat } from "../veritum/veritum.definitions";

// Identity defaults
export const DEFAULT_IDMUC_APPLICATION_STRING = "ID";
export const DEFAULT_MIN_MUC_REBUILD_DELAY = 5;  // minimum five seconds between Identity MUC generations unless specified otherwise
export const DEFAULT_SUBSCRIPTION_RECURSION_DEPTH = 10;

// Key derivation defaults
export const DEFAULT_IDMUC_CONTEXT_STRING = "CCI Identity";
export const IDMUC_MASTERINDEX = 0;
export const DEFAULT_IDMUC_ENCRYPTION_CONTEXT_STRING = "CCI Encrpytion";
export const DEFAULT_IDMUC_ENCRYPTION_KEY_INDEX = 0;

export interface IdentityOptions {
  /**
   * Local Identities (i.e. one owned by the user running this node, for
   * which we have the private key) can be stored in local persistant storage
   * through an IdentityPersistence object. There should only be a single
   * IdentityPersistence object per node.
   * If you want persistent Identities, you may supply your IdentityPersistence
   * object here. Otherwise, set this option to false.
   * @default - Behaviour on undefined depends on the component evaluating this option:
   *   - Identity objects themselves will default to no persistence.
   *   - Framework components like Identity.Load() or the Verity WebUI framework
   *     will default to enabling persistence.
   */
  identityPersistence?: IdentityPersistence | false,

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

  /**
   * If specified, this Identity's root Cube will be a notification Cube,
   * with the specified key as its notification key.
   */
  idmucNotificationKey?: NotificationKey,

  /**
   * Whether this Identity should listen for remote updates to itself.
   * This is required whenever the same Identity may be actively used (= edited)
   * on different nodes as otherwise changes won't be synced.
   * Default: true
   **/
  subscribeRemoteChanges?: boolean;

  /**
   * To avoid having multiple Identity objects representing the same Identity
   * (and the associated overhead as well as increased complexity), all local
   * Identity object should share the same IdentityStore.
   * If none is provided, an new one will be constructed when constructing an
   * Identity object.
   */
  identityStore?: IdentityStore;
}

export interface IdentityLoadOptions extends IdentityOptions, CubeRequestOptions {
  /**
   * Owned Identities can be retrieved either by their master key, or by one
   * of the alternative recovery methods described below.
   * It does not make sense to provide both the master key and alternative methods
   * in the same load request; if you still do, the master key will take precedence.
   */
  masterKey?: Buffer|string;

  /**
   * Username and password are an alternative method of retrieving an owned
   * Identity (instead of using the master key).
   */
  username?: string;
  /**
   * Username and password are an alternative method of retrieving an owned
   * Identity (instead of using the master key).
   */
  password?: string;

  /**
   * The recovery phrase is an alternative method of retrieving an owned
   * Identity (instead of using the master key).
   */
  recoveryPhrase?: string;
}

export const PostFormatEventMap = {
  [RetrievalFormat.Cube]: 'postAddedCube',
  [RetrievalFormat.Veritum]: 'postAdded',
} as const;

export interface PostInfo<postFormat> extends MetadataEnhancedRetrieval<postFormat>{
  main: postFormat;
  author: Identity;
}
export type RelResolvingPostInfo<T> = PostInfo<T> & ResolveRelsResult<T>;
export type RecursiveRelResolvingPostInfo<T> = PostInfo<T> & ResolveRelsRecursiveResult<T>;

export interface GetPostsOptions extends GetVeritumOptions {
  /**
   * Select in which way you'd like your posts yielded, either as the full post
   * Veritum or as a compact CubeInfo object.
   * Note:
   *  - Using the default Veritum format implies that all posts need to be
   *    retrieved over the wire in full, while using the CubeInfo format only
   *    retrieves the first chunk.
   *  - Therefore, a post yielded using the CubeInfo format does not guarantee
   *    that the full post is actually retrievable from the network.
   *  - If posts in your application may be very large
   *    (e.g. representing large files), you may wish to use the CubeInfo format.
   * @default Veritum, allowing callers to directly process (e.g. display)
   *   the yielded posts. The goal behind this is having the default API as
   *   intuitive as possible.
   */
  format?: RetrievalFormat;

  /**
   * If true, the generator will not exit when all existing data has been yielded.
   * Instead, it will keep running indefinetely, yielding values as new data
   * becomes available.
   * TODO provide a way to terminate the generator
   */
  subscribe?: boolean;

  /**
   * When set to a number greater than 0, getPosts() will not only fetch this
   * Identity's own posts but also posts by subscribed authors.
   * This number is the maximum recursion depth, i.e. the maximum level of
   * indirect subscriptions.
   * Defaults to 0, i.e. only retrieves this Identity's own posts.
   */
  subscriptionDepth?: number;

  /**
   * A set of Identity key strings to exclude when retrieving not just own posts
   * but also posts by subscribed authors.
   * Note: This options only applies to retrieving pre-existing posts, not to
   *       new posts in subscription mode.
   * You will usually not need this.
   */
  recursionExclude?: Set<string>;
}

export type GetPostsGenerator<T> = MergedAsyncGenerator<T> & {
  /**
   * A Promise that will resolve once all existing posts have been yielded.
   * This is useful in subscribe mode to know from which point on we're no longer
   * actively retrieving existing posts but just hope to learn about new ones
   * over the network.
   */
  existingYielded?: Promise<void>;
};
export type RelResolvingGetPostsGenerator<T> = GetPostsGenerator<RelResolvingPostInfo<T>>;
export type RecursiveRelResolvingGetPostsGenerator<T> = GetPostsGenerator<RecursiveRelResolvingPostInfo<T>>;

export interface GetRecursiveEmitterOptions {
  depth?: number,
  event?: string,
}

export interface IdentityEvents extends CubeEmitterEvents {
  postAdded: [PostInfo<Veritum>];
  postAddedCube: [PostInfo<CoreCube>];
}
