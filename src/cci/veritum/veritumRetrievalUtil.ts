import type { CubeKey } from "../../core/cube/cube.definitions";
import type { Veritum } from "./veritum";
import type { Veritable } from "../../core/cube/veritable.definition";
import type { CubeRequestOptions } from "../../core/networking/cubeRetrieval/requestScheduler";

import { Relationship, RelationshipType } from "../cube/relationship";

// Result type declaration
export interface EnhancedRetrievalResult<MainType> {
  main: MainType;

  /**
   * Collective promise that will resolve once all enhancements have been
   * applied.
   * - In case of resolveRels, this resolves once all referenced
   *   Verita have either been retrieved or their retrieval has failed.
   */
  done: Promise<void>;

  // All other properties should be of an application-specific enhancement type;
  // e.g. Promise<Veritable>[] for resolveRels.
  // However, neither me nor my AI assistants could up with a sensible type
  // declaration for this.
};


type RelResult = {
  [key in number]: Promise<Veritable>[];
}
export interface ResolveRelsResult extends EnhancedRetrievalResult<Veritable>, RelResult {
}

type RecursiveRelResult = {
  [key in number]: Promise<ResolveRelsRecursiveResult>[];
}
export interface ResolveRelsRecursiveResult extends EnhancedRetrievalResult<Veritable>, RecursiveRelResult {
}


export interface ResolveRelsOptions extends CubeRequestOptions {
  // TODO implement
  relTypes?: Iterable<number>;
}


export function resolveRels(
  main: Veritable,
  retrievalFn?: (key: CubeKey, options: CubeRequestOptions) => Promise<Veritable>,
  options: ResolveRelsOptions = {},
): ResolveRelsResult {
  const ret: Partial<ResolveRelsResult> = { main };

  // fetch rels
  // HACKHACK typecast: We kinda sorta need an extended Veritable interface
  //   that (optionally?) exposes CCI-compatible relationships.
  //   It still works though as we only call getRelationships() if it exists.
  const rels: Iterable<Relationship> = (main as Veritum).getRelationships?.();

  const donePromises: Promise<Veritable>[] = [];
  for (const rel of rels) {
    // retrieve referred Veritable
    const promise = retrievalFn(rel.remoteKey, options);
    // lazy initialise that rel type's resolutions array if necessary
    if (!ret[rel.type]) ret[rel.type] = [];
    // add that retrieval to ret
    ret[rel.type].push(promise);
    // Add this promise to array of done promises
    donePromises.push(promise);
  }
  ret.done = Promise.all(donePromises).then();

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
  exclude?: Set<string>;
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
  }
  // Ensure an exclusion set exists. (We’re sharing this across recursions.)
  if (!options.exclude) options.exclude = new Set();
  // Add main's key to the exclusion set. Note that this is async, but that's fine.
  main.getKeyString().then((key) => options.exclude.add(key));

  // First, perform the direct resolution.
  const directRels = resolveRels(main, retrievalFn, options);
  const result: Partial<ResolveRelsRecursiveResult> = { main: directRels.main };

  // For every occurring relationship type, map each retrieval promise to a
  // recursive resolution.
  // (Note: By our definition, RelationshipTypes are numeric properties, or rather
  // properties with keys parseable as int as in Javascript all keys are strings.)
  for (const relKey of Object.keys(directRels).filter(key => Number.parseInt(key))) {
    const directPromises: Promise<Veritable>[] = directRels[relKey] || [];
    result[relKey] = directPromises.map((promise) =>
      promise.then(async (veritable) => {
        // Retrieve the veritable's key asynchronously.
        const key = await veritable.getKeyString();

        // Check if we should stop recursing on this branch.
        if (options.maxRecursion <= 1 || options.exclude.has(key)) {
          // Create a leaf result: no further recursion is performed.
          return {
            main: veritable,
            done: Promise.resolve(),
          };
        }
        // Otherwise, add this key to the exclusion set.
        options.exclude.add(key);
        // Prepare child options: decrement the recursion depth.
        const childOptions: ResolveRelsRecursiveOptions = {
          ...options,
          maxRecursion: options.maxRecursion - 1,
          exclude: options.exclude, // sharing the same exclusion set
        };
        // Recurse into the referred cube.
        return resolveRelsRecursive(veritable as Veritum, retrievalFn, childOptions);
      })
    );
  }

  // Build the overall "done" promise; it resolves after the direct retrievals
  // and after every nested recursive call's done promise.
  const nestedDonePromises: Promise<void>[] = [];
  for (const relKey of Object.keys(RelationshipType) as (keyof typeof RelationshipType)[]) {
    const arr = result[relKey] || [];
    for (const recPromise of arr) {
      nestedDonePromises.push(recPromise.then((nestedResult) => nestedResult.done));
    }
  }
  result.done = directRels.done.then(() => Promise.all(nestedDonePromises).then(() => undefined));

  return result as ResolveRelsRecursiveResult;
}
