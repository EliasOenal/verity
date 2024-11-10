import { cciCube } from "../../../cci/cube/cciCube";
import { cciFieldType } from "../../../cci/cube/cciCube.definitions";
import { cciRelationship, cciRelationshipType } from "../../../cci/cube/cciRelationship";
import { Cube } from "../../cube/cube";
import { CubeKey } from "../../cube/cube.definitions";
import { CubeFamilyDefinition } from "../../cube/cubeFields";
import { CubeInfo } from "../../cube/cubeInfo";
import { CubeRetrievalInterface, CubeStore } from "../../cube/cubeStore";
import { keyVariants } from "../../cube/cubeUtil";
import { logger } from "../../logger";
import { Settings } from "../../settings";
import { CubeRequestOptions, RequestScheduler } from "./requestScheduler";

/**
 * "He may not be Golden, but he'll be your most trusted companion."
 * CubeRetriever is a helper class for light nodes, facilitating
 * Cube retrieval no matter whether a Cube is already present in the local
 * CubeStore or needs to be requested over the wire.
 */
export class CubeRetriever implements CubeRetrievalInterface {
  private timers: NodeJS.Timeout[] = [];

  private shutdownPromiseResolve: () => void;
  shutdownPromise: Promise<void> =
      new Promise(resolve => this.shutdownPromiseResolve = resolve);

  constructor(
    readonly cubeStore: CubeStore,
    readonly requestScheduler: RequestScheduler,
  ) {
  }

  async getCubeInfo(
      keyInput: CubeKey | string,
      options: CubeRequestOptions = undefined,  // undefined = will use RequestScheduler's default
  ): Promise<CubeInfo> {
    const local: CubeInfo = await this.cubeStore.getCubeInfo(keyInput);
    if (local !== undefined) return local;
    try {
      const retrieved = await this.requestScheduler.requestCube(keyInput, options);
      return retrieved;
    } catch(error) {
      return undefined;
    }
  }

  async getCube(
      key: CubeKey | string,
      family: CubeFamilyDefinition = undefined,  // undefined = will use CubeInfo's default
      options: CubeRequestOptions = undefined,  // undefined = will use RequestScheduler's default
  ): Promise<Cube> {
    return (await this.getCubeInfo(key, options))?.getCube(family);
  }

  /**
   * Expects a Cube to be received soon, without actually requesting it.
   * @param keyInput The key of the Cube to expect
   * @returns A promise that will resolve to the expected Cube's CubeInfo
   *   if and when it is eventually received.
   */
  expectCube(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.cubeStore.expectCube(keyInput);
  }

  // Note: This kind of breaks our layering as Continuation is a CCI feature
  // while the CubeRetriever is a core feature.
  // maybe TODO fix this somehow...?
  // maybe TODO: make this an AsyncGenerator... I tried but it's hard
  async *getContinuationChunks(
      key: CubeKey | string,
      family: CubeFamilyDefinition = undefined,  // undefined = will use CubeInfo's default
      options: CubeRequestOptions = {},
  ): AsyncGenerator<cciCube> {
    // set default timeout (other options will use RequestScheduler's default)
    options.timeout ??= this.requestScheduler?.options?.requestTimeout ?? Settings.CUBE_REQUEST_TIMEOUT;

    // First, define some helper functions:
    // chunkRetrieved will be run for, well, every chunk Cube retrieved
    const chunkRetrieved = (chunk: cciCube, resolved: Promise<cciCube>) => {
      if (timeoutReached) return;  // abort if timeout reached
      if (chunk === undefined) return;  // this is probably a chunk retrieval timeout, maybe TODO handle it?!

      // Cool, we got a new chunk!
      // Let's save it and remove its retrieval promise
      retrieved.set(keyVariants(chunk.getKeyIfAvailable()).keyString, chunk);
      currentlyRetrieving.delete(resolved);

      // get further chunk references
      const refs = chunk.fields.getRelationships?.(cciRelationshipType.CONTINUED_IN);
      for (let refIndexInCube=0; refIndexInCube < refs?.length ?? 0; refIndexInCube++) {
        const ref = refs[refIndexInCube];

        // ensure no circular references
        if (retrieved.has(ref.remoteKeyString)) continue;

        // schedule retrieval of referred chunk
        const retrievalPromise = this.getCube(
          ref.remoteKey, family, options) as Promise<cciCube>;
        retrievalPromise.then((nextChunk) => chunkRetrieved(nextChunk, retrievalPromise));
        currentlyRetrieving.add(retrievalPromise);
      }
      // Check if this successful retrieval allows us to yield the next chunk.
      resolveNextChunkPromiseIfPossible();
    };

    // Helper function that will be called after a chunk has been retrieved
    // as well as after a chunk has been yielded. This helps us make sure
    // we yield all those chunks in the correct order.
    const resolveNextChunkPromiseIfPossible = () => {
      if (timeoutReached) return;  // abort if timeout reached

      // This call is not required for the very first chunk, which resolves
      // automatically.
      if (nextChunkPromise === firstChunkPromise || orderedChunks.length === 0) return;

      // What was the key of the previously yielded chunk again?
      const previous: CubeKey = orderedChunks[orderedChunks.length - 1]?.getKeyIfAvailable();
      if (previous === undefined) {
        logger.error(`resolveNextChunkPromiseIfPossible(): previous is undefined, aborting. This should never happen.`);
        nextChunkPromiseResolve(undefined);
        return;
      }

      // Traverse all references to get an ordered list of all
      // chunk keys known so far
      // maybe TODO: if necessary, this can be optimised by keeping a separate
      // list and amending it as chunks are retrieved rather than recalculating
      // it each time
      const refs: cciRelationship[] = [];
      for (const chunk of orderedChunks) {
        // maybe TODO get rid of this potentially enormous amount of array
        // operations, see above
        refs.push(...chunk.fields.getRelationships?.(cciRelationshipType.CONTINUED_IN));
      }
      // Find the previously yielded chunk's key in that list -- the key of
      // the chunk to be yielded next is obviously the one that follows it.
      let next: CubeKey = undefined;
      if (previous.equals(firstChunkKey)) next = refs[0]?.remoteKey;
      else for (let i=0; i < refs.length; i++) {
        if (previous.equals(refs[i].remoteKey)) {
          next = refs[i+1]?.remoteKey;
          break;
        }
      }
      if (next === undefined) {
        // There are no further CONTINUED_IN references.
        // Either we're done fetching the whole continuation chain,
        // or the chain is corrupt, or there's a serious bug here in the
        // fetching code. Anyway, we can't continue.
        nextChunkPromiseResolve(undefined);
        return;
      }

      // Check if we've already retrieved the next chunk
      const resolveTo = retrieved.get(keyVariants(next).keyString);
      if (resolveTo !== undefined) {
        // Yay, we've already retrieved the next chunk
        nextChunkPromiseResolve(resolveTo);
      }
    }

    const newNextChunkPromise = (key: CubeKey) => {
      // abort if timeout reached
      if (timeoutReached) return;

      // create new promise
      nextChunkPromise = new Promise(resolve => {
        nextChunkPromiseResolve = resolve;
      });
      // check if we can resolve it right away
      resolveNextChunkPromiseIfPossible();
    }

    // Prepare containers for both retrieved chunks and retrieval promises.
    // Chunks will, obviously, first be added to retrievalPromises once we
    // learn their key, and to retrieved once we, you know, retrieved them.
    // Finally, they will be added to orderedChunks once we figured out
    // where they belong in the chain.
    const retrieved: Map<string, cciCube> = new Map();
    const orderedChunks: cciCube[] = [];
    const currentlyRetrieving: Set<Promise<cciCube>> = new Set();

    // While we retrieve all those chunks we'll yield them one by once we
    // happen to retrieve the one that's next in line.
    // nextCubePromise represents the next chunk to be yielded.
    let nextChunkPromiseResolve: (cube: cciCube) => void = undefined;
    let nextChunkPromise: Promise<cciCube> = new Promise(resolve => {
      nextChunkPromiseResolve = resolve;
    });

    // The was a timeout, wasn't there?
    let timeoutReached: boolean = false;
    const timer: NodeJS.Timeout = setTimeout(() => {
      timeoutReached = true;
      nextChunkPromiseResolve(undefined);
    }, options.timeout);
    this.timers.push(timer);

    // Finally, initiate retrievals by retrieving first Cube:
    const firstChunkPromise: Promise<cciCube> =
      this.getCube(key, family, options) as Promise<cciCube>;
    currentlyRetrieving.add(firstChunkPromise);
    let firstChunkKey: CubeKey = undefined;
    firstChunkPromise.then(chunk => {
      chunkRetrieved(chunk as cciCube, firstChunkPromise);
      firstChunkKey = chunk.getKeyIfAvailable();
    });
    nextChunkPromise = firstChunkPromise;

    // Wait for all Cubes to be retrieved and yield them:
    let chunk: cciCube;
    while ( (chunk = await nextChunkPromise) !== undefined ) {
      if (chunk !== undefined) {
        yield chunk;
        orderedChunks.push(chunk);
        newNextChunkPromise(chunk.getKeyIfAvailable());
      }
    }

    // cleanup
    clearTimeout(timer);
  }

  shutdown(): Promise<void> {
    for (const timer in this.timers) {
      clearTimeout(timer);
    }
    this.shutdownPromiseResolve();
    return this.shutdownPromise;
  }
}
