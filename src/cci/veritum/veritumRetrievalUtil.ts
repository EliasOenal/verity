import type { CubeKey } from "../../core/cube/cube.definitions";

import { Veritable } from "../../core/cube/veritable.definition";
import { CubeRequestOptions } from "../../core/networking/cubeRetrieval/requestScheduler";
import { cciCube } from "../cube/cciCube";
import { RelationshipType } from "../cube/relationship";
import { Veritum } from "./veritum";

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
  -readonly [key in keyof typeof RelationshipType]: Promise<Veritable>[];
}
export interface ResolveRelsResult extends EnhancedRetrievalResult<Veritable>, RelResult {
}

type RecursiveRelResult = {
  -readonly [key in keyof typeof RelationshipType]: Promise<ResolveRelsRecursiveResult>[];
}
export interface ResolveRelsRecursiveResult extends EnhancedRetrievalResult<Veritable>, RecursiveRelResult {
}

export interface ResolveRelsOptions extends CubeRequestOptions {
  // TODO implement
  // relTypes?: Iterable<RelationshipType>;
}


export function resolveRels(
  main: cciCube|Veritum,
  retrievalFn?: (key: CubeKey, options: CubeRequestOptions) => Promise<Veritable>,
  options: ResolveRelsOptions = {},
): ResolveRelsResult {
  const ret: Partial<ResolveRelsResult> = { main };

  // fetch rels
  const donePromises: Promise<Veritable>[] = [];
  for (const rel of main.getRelationships?.()) {
    // retrieve referred Veritable
    const promise = retrievalFn(rel.remoteKey, options);
    // lazy initialise that rel type's resolutions array if necessary
    if (!ret[RelationshipType[rel.type]]) ret[RelationshipType[rel.type]] = [];
    // add that retrieval to ret
    ret[RelationshipType[rel.type]].push(promise);
    // Add this promise to array of done promises
    donePromises.push(promise);
  }
  ret.done = Promise.all(donePromises).then();

  return ret as ResolveRelsResult;
}

export interface ResolveRelsRecursiveOptions extends ResolveRelsOptions {
  maxRecursion?: number;
}

export function resolveRelsRecursive(
  main: cciCube | Veritum,
  retrievalFn?: (key: CubeKey, options: CubeRequestOptions) => Promise<Veritable>,
  options: ResolveRelsOptions | CubeRequestOptions = {},
): ResolveRelsRecursiveResult {
  // First, resolve the direct relationships for the current main object.
  const directRels = resolveRels(main, retrievalFn, options);
  const result: Partial<ResolveRelsRecursiveResult> = { main: directRels.main };

  // For each relationship type in RelationshipType,
  // map each direct retrieval promise into a recursive resolution.
  for (const relKey of Object.keys(RelationshipType) as (keyof typeof RelationshipType)[]) {
    const directPromises = directRels[relKey] || [];
    result[relKey] = directPromises.map((promise) =>
      promise.then((veritable) => resolveRelsRecursive(veritable as Veritum, retrievalFn, options))
    );
  }

  // Now, we need a "done" promise that waits for both the direct retrievals and all of the recursive enhancements.
  // For each recursive promise, wait for its own "done" promise to resolve.
  const nestedDonePromises: Promise<void>[] = [];
  for (const relKey of Object.keys(RelationshipType) as (keyof typeof RelationshipType)[]) {
    const recursivePromises = result[relKey] || [];
    for (const recPromise of recursivePromises) {
      nestedDonePromises.push(
        recPromise.then((recursiveResult) => recursiveResult.done)
      );
    }
  }

  // The overall done promise waits for the direct relationships to be resolved
  // and then for every nested resolution to complete.
  result.done = directRels.done.then(() => Promise.all(nestedDonePromises)).then(() => {});

  return result as ResolveRelsRecursiveResult;
}
