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
  [key in keyof typeof RelationshipType]: Promise<Veritable>[];
}
export interface ResolveRelsResult extends EnhancedRetrievalResult<Veritable>, RelResult {
}

export interface ResolveRelsOptions {
  // TODO implement
  // maxRecursion?: number;
  // relTypes?: Iterable<RelationshipType>;
}


export function resolveRels(
  main: cciCube|Veritum,
  retrievalFn?: (key: CubeKey, options: CubeRequestOptions) => Promise<Veritable>,
  options: ResolveRelsOptions|CubeRequestOptions = {},
): ResolveRelsResult {
  // set default options
  // options.maxRecursion ??= 10;

  const ret: Partial<ResolveRelsResult> = {
    main,
  };

  // fetch rels
  const donePromises: Promise<Veritable>[] = [];
  for (const rel of main.getRelationships()) {
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