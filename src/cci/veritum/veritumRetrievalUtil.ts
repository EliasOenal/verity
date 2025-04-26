import type { CubeKey } from "../../core/cube/cube.definitions";
import type { Veritum } from "./veritum";
import type { Veritable } from "../../core/cube/veritable.definition";
import type { CubeRequestOptions } from "../../core/networking/cubeRetrieval/requestScheduler";

import { Relationship, RelationshipType } from "../cube/relationship";

// Result type declaration
export interface MetadataEnhancedRetrieval<MainType> {
  main: MainType;

  /**
   * Collective promise that will resolve once all enhancements have been
   * applied.
   * - In case of resolveRels, this resolves once all referenced
   *   Verita have either been retrieved or their retrieval has failed.
   */
  done: Promise<void>;

  /**
   * True once the done promise resolves.
   * Wouldn't it be great if you could query a promise's status directly?
   **/
  isDone: boolean;

  // All other properties should be of an application-specific enhancement type;
  // e.g. Promise<Veritable>[] for resolveRels.
  // However, neither me nor my AI assistants could up with a sensible type
  // declaration for this.
};

interface RetrievalMetadata {
  /**
   * Set to true if and when all referenced Verita have been retrieved.
   * Note that this means it will be false:
   *   - While a retrieval is still in progress
   *   - If any retrieval has failed
   * And in the case of recursive retrieval:
   *   - If the depth limit has been reached
   *   - If an encluded Veritable has been encountered
   *   - If a circular reference has been encountered
   *     (which is technically the same thing as an excluded Veritable)
   * Note that if you limit resolution to certain types of references using
   *   the relTypes option, allResolved will become true as soon as those have
   *   been retrieved, as any other references will be disregarded.
   */
  allResolved: boolean;

  /**
   * Will be set to true if retrieval of any referenced Veritable has failed,
   * e.g. due it not being in store while we're offline, or due to it not being
   * available on the network at all.
   */
  resolutionFailure: boolean;
}

type RelResult = {
  [key in number]: Promise<Veritable>[];
}
export interface ResolveRelsResult
  extends MetadataEnhancedRetrieval<Veritable>, RelResult, RetrievalMetadata
{ }

/** Returns an almost valid initialization of ResolveRelsResult, just without the done promise */
export function emptyResolveRelsResult(main: Veritable): Partial<ResolveRelsResult> {
  const ret: Partial<ResolveRelsResult> = {
    main,
    isDone: false,
    allResolved: false,
    resolutionFailure: false,
    // note the done Promise is missing and must be supplied by the caller
  };
  return ret;
}

type RecursiveRelResult = {
  [key in number]: Promise<ResolveRelsRecursiveResult>[];
}
export interface ResolveRelsRecursiveResult
  extends MetadataEnhancedRetrieval<Veritable>, RecursiveRelResult, RetrievalMetadata
{
  /**
   * Will be set to true if an excluded Veritable has been encountered,
   * or in case of a circular reference (which technically is an automatic exclusion).
   **/
  exclusionApplied: boolean;

  /**
   * Will be set to true if the specified recursion depth limit has been reached.
   * Note that this does not mean it was *exceeded* or that anything actually
   * was skipped because of this, it was just reached -- e.g., a chain of depth
   * 2 will still be fully resolved using a depth limit of 2, even though the
   * limit was reached.
   **/
  depthLimitReached: boolean;
}

/** Returns an almost valid initialization of ResolveRelsRecursiveResult, just without the done promise */
export function emptyResolveRelsRecursiveResult(main: Veritable): Partial<ResolveRelsRecursiveResult> {
  const partial: Partial<ResolveRelsResult> = emptyResolveRelsResult(main);
  const ret: Partial<ResolveRelsRecursiveResult> = {
    ...partial,
    exclusionApplied: false,
    depthLimitReached: false,
  };
  return ret;
}


export interface ResolveRelsOptions extends CubeRequestOptions {
  /**
   * If specified, only resolve relationships of the specified types.
   * @default - All standard relationship types (CCI)
   */
  relTypes?: number[];
}


export function resolveRels(
  main: Veritable,
  retrievalFn?: (key: CubeKey, options: CubeRequestOptions) => Promise<Veritable>,
  options: ResolveRelsOptions = {},
): ResolveRelsResult {
  // Set default options
  options.relTypes ??= Object.keys(RelationshipType)
    .map(key => Number.parseInt(key))
    .filter(key => !Number.isNaN(key));

  const ret: Partial<ResolveRelsResult> = emptyResolveRelsResult(main);

  // fetch rels
  // HACKHACK typecast: We kinda sorta need an extended Veritable interface
  //   that (optionally?) exposes CCI-compatible relationships.
  //   It still works though as we only call getRelationships() if it exists.
  const rels: Iterable<Relationship> = (main as Veritum).getRelationships?.();

  const donePromises: Promise<Veritable>[] = [];
  for (const rel of rels) {
    if (!options.relTypes.includes(rel.type)) continue;
    // retrieve referred Veritable
    const promise = retrievalFn(rel.remoteKey, options);
    // lazy initialise that rel type's resolutions array if necessary
    if (!ret[rel.type]) ret[rel.type] = [];
    // add that retrieval to ret
    ret[rel.type].push(promise);
    // Add this promise to array of done promises
    donePromises.push(promise);
  }
  ret.done = Promise.all(donePromises).then((retrievalResults: Veritable[]) => {
    ret.isDone = true;
    ret.resolutionFailure = retrievalResults.some(veritum => veritum === undefined);
    ret.allResolved = !ret.resolutionFailure;
  });

  return ret as ResolveRelsResult;
}

export interface ResolveRelsRecursiveOptions extends ResolveRelsOptions {
  /**
   * The maximum number of levels to recurse into. (Minimum is 1.)
   * @default 10
   */
  maxRecursion?: number;

  /**
   * Stop recursing when encountering a Veritable with any of these keys.
   * Note that we will still retrieve the veritable, but not recurse into it.
   */
  excludeVeritable?: Set<string>;
}

/**
 * Recursively resolves all relationships for a Veritable.
 * Note:
 *   - Each referred Veritum will only be resolved once,
 *     even if it is referenced through multiple relationship types,
 *     even if those referrals originate from different Verita.
 * @param main - Start resolving references from this Veritable
 * @param retrievalFn - Function to retrieve a Veritable from a CubeKey, e.g.
 *   CubeStore.getCube(), CubeRetriever.getCube(), or VeritumRetriever.getVeritum().
 * @param options - See ResolveRelsRecursiveOptions
 * @returns - A ResolveRelsRecursiveResult object,
 *   containing a retrieval promise for each reference.
 */
export function resolveRelsRecursive(
  main: Veritable,
  retrievalFn?: (key: CubeKey, options: CubeRequestOptions) => Promise<Veritable>,
  options: ResolveRelsRecursiveOptions = {},
): ResolveRelsRecursiveResult {
  // Set the default recursion limit if not specified.
  if (options.maxRecursion === undefined) {
    options.maxRecursion = 10;
    // Note: options.relTypes will be set by resolveRels() if not specified
  }
  // Ensure an exclusion set exists. (We’re sharing this across recursions.)
  if (!options.excludeVeritable) options.excludeVeritable = new Set();
  // Add main's key to the exclusion set. (This is async; we assume it’s okay if not awaited.)
  main.getKeyString().then((key) => options.excludeVeritable.add(key));

  // First, perform the direct resolution.
  const directRels = resolveRels(main, retrievalFn, options);
  const result: Partial<ResolveRelsRecursiveResult> = emptyResolveRelsRecursiveResult(main);

  // For every occurring relationship type, map each retrieval promise to a
  // recursive resolution.
  // (Note: By our definition, RelationshipTypes are numeric properties, e.g. '1', '2', etc.)
  for (const relKey of Object.keys(directRels).filter(key => Number.parseInt(key))) {
    const directPromises: Promise<Veritable>[] = directRels[relKey] || [];
    result[relKey] = directPromises.map((promise) =>
      promise.then(async (veritable) => {
        // Retrieve the veritable's key asynchronously.
        const key = await veritable.getKeyString();

        // Check if we should stop recursing on this branch.
        if (options.maxRecursion <= 1 || options.excludeVeritable.has(key)) {
          // Create a leaf result: no further recursion is performed.
          return {
            main: veritable,
            done: Promise.resolve(),
            isDone: true,
            allResolved:
              (veritable as Veritum).getRelationships?.() === undefined ||
              (veritable as Veritum).getRelationships?.().length === 0,
            depthLimitReached: options.maxRecursion <= 1,
            exclusionApplied: options.excludeVeritable.has(key),
            resolutionFailure: false,
          };
        }
        // Otherwise, add this key to the exclusion set.
        options.excludeVeritable.add(key);
        // Prepare child options: decrement the recursion depth.
        const childOptions: ResolveRelsRecursiveOptions = {
          ...options,
          maxRecursion: options.maxRecursion - 1,
          excludeVeritable: options.excludeVeritable, // sharing the same exclusion set
        };
        // Recurse into the referred cube.
        return resolveRelsRecursive(veritable as Veritum, retrievalFn, childOptions);
      })
    );
  }

  // Build the overall "done" promise;
  // it waits for the direct retrievals (directRels.done) and for every nested recursive call’s done promise.
  result.done = Promise.all([
    directRels.done,
    // For every relationship type, wait for each recursive result
    ...options.relTypes.flatMap((relKey) =>
      (result[relKey] ?? []).map(async (subPromise) => {
        const nestedResult = await subPromise;
        await nestedResult.done;
      })
    ),
  ]).then(() => {
    return Promise.all(
      options.relTypes.flatMap((relKey) =>
        (result[relKey] ?? []).map(async (subPromise) => await subPromise)
      )
    ).then((nestedResults) => {
      result.isDone = true;
      result.resolutionFailure = nestedResults.some(r => r.resolutionFailure);
      result.allResolved = nestedResults.every(r => r.allResolved);
      result.depthLimitReached = nestedResults.some(r => r.depthLimitReached);
      result.exclusionApplied = nestedResults.some(r => r.exclusionApplied);
    });
  });

  return result as ResolveRelsRecursiveResult;
}
