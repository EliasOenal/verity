import { ApiMisuseError, Settings } from "../../core/settings";
import { ArrayFromAsync } from "../../core/helpers/misc";
import { CubeKey } from "../../core/cube/cube.definitions";
import { Shuttable } from "../../core/helpers/coreInterfaces";
import { Cube } from "../../core/cube/cube";
import { CubeInfo } from "../../core/cube/cubeInfo";
import { keyVariants } from "../../core/cube/cubeUtil";
import { CubeRequestOptions, RequestScheduler } from "../../core/networking/cubeRetrieval/requestScheduler";
import { logger } from "../../core/logger";

import { cciCube } from "../cube/cciCube";
import { CubeRetrievalInterface, CubeStore } from "../../core/cube/cubeStore";
import { RelationshipType, Relationship } from "../cube/relationship";
import { Veritum, VeritumFromChunksOptions } from "./veritum";
import { Identity } from "../identity/identity";

export interface VeritumRetrievalInterface<OptionsType = any> extends CubeRetrievalInterface<OptionsType> {
  getVeritum(key: CubeKey|string, options?: OptionsType): Promise<Veritum>;
}

export interface GetVeritumOptions {
  /**
   * Automatically attempt to decrypt the Veritum if it is encrypted
   */
  recipient?: Identity|Buffer;
}

export class VeritumRetriever
  <GetCubeOptionsT extends CubeRequestOptions = CubeRequestOptions>
  implements VeritumRetrievalInterface<GetCubeOptionsT>, Shuttable
{
  private timers: NodeJS.Timeout[] = [];  // maybe TODO make optional in case of CubeStore backend?

  constructor(
      public cubeRetriever: CubeRetrievalInterface<GetCubeOptionsT>,
  ) {
  }

  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.cubeRetriever.getCubeInfo(keyInput);
  }
  getCube<cubeClass extends Cube>(key: CubeKey | string, options?: GetCubeOptionsT): Promise<cubeClass> {
    return this.cubeRetriever.getCube(key, options);
  }
  expectCube(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.cubeRetriever.expectCube(keyInput);
  }
  get cubeStore(): CubeStore { return this.cubeRetriever.cubeStore }

  async getVeritum(key: CubeKey|string, options?: GetCubeOptionsT&GetVeritumOptions): Promise<Veritum> {
    const chunks: cciCube[] = await ArrayFromAsync(
      this.getContinuationChunks(key, options));
    // maybe TODO: get rid of ugly Array conversion?

    // If auto-decryption was requested, prepare the necessary params
    // for decryption
    let recipientPrivateKey: Buffer = undefined;
    if (options?.recipient) {
      if (options.recipient instanceof Identity) {
        recipientPrivateKey = options.recipient.encryptionPrivateKey;
      } else if (Buffer.isBuffer(options.recipient)) {
        recipientPrivateKey = options.recipient;
      } else {
        logger.error("VeritumRetriever.getVeritum(): Invalid param for options.recipient, must be a Buffer containing a private key or an Identity object");
      }
    }

    // Decompile the Veritum
    const fromChunksOptions: VeritumFromChunksOptions = options?
      {
        ...options,
        recipientPrivateKey,
      } :
      { recipientPrivateKey }
    ;
    const veritum: Veritum = Veritum.FromChunks(chunks, fromChunksOptions);
    return veritum;
  }

  // Note: This method basically defines a subclass and instantiates it for every call.
  //   Maybe we should refactor it into an actual class "ChunkRetriever" or something.
  //   Or maybe we call this idiomatic and leave it as it is? I don't know.
  async *getContinuationChunks(
    key: CubeKey | string,
    options: CubeRequestOptions|GetCubeOptionsT = {},  // undefined = will use RequestScheduler's default
  ): AsyncGenerator<cciCube, boolean, void> {
    // copy options object to avoid side effects
    options = {...options};
    // set default timeout
    if (options.timeout === undefined) {
      // HACKHACK: break through our interfacing to adopt RequestScheduler's
      // timeout if there is one.
        const requestScheduler: RequestScheduler = this.cubeRetriever['requestScheduler'];
      if (requestScheduler !== undefined) {
        options.timeout = requestScheduler.options.requestTimeout;
      } else {
        options.timeout = Settings.CUBE_REQUEST_TIMEOUT;
      }
    }

    // Prepare containers for both retrieved chunks and retrieval promises.
    // Chunks will, obviously, first be added to retrievalPromises once we
    // learn their key, and to retrieved once we, you know, retrieved them.
    // Finally, they will be added to orderedChunks once we figured out
    // where they belong in the chain.
    const retrieved: Map<string, cciCube> = new Map();
    const orderedChunks: cciCube[] = [];
    const currentlyRetrieving: Set<Promise<cciCube>> = new Set();

    // Let's define some helper functions:
    // This will act as the main body of this AsyncGenerator and be called
    // recursively for, well, every chunk Cube retrieved.
    // Note that these calls are not in sync with chunk yielding as chunks
    // are retrieved in parallel and may arrive out of order.
    // (Yielding is instead governed by the nextChunkPromise, which gets updated
    // whenever we happen to receive the next chunk in order.)
    const chunkRetrieved = (key: CubeKey|string, chunk: cciCube, resolved: Promise<cciCube>): void => {
      if (timeoutReached || chunk === undefined) {
        // Retrieval failed, either due to timeout or due to missing chunk.
        // No matter if the failed chunk is the next in order or a completely
        // different one, this means that retrieval as a whole has failed.
        // maybe TODO: Allow retrying chunk? Allow partial retrieval?
        //   (Partial retrieval and retrying sound a bit like we're pretending
        //    ot be BitTorrent.)
        nextChunkPromiseResolve?.(undefined);  // note nextChunkPromise is undefined for first chunk
        return;
      }

      // Cool, we got a new chunk!
      // Let's save it and remove its retrieval promise
      retrieved.set(keyVariants(key).keyString, chunk);
      currentlyRetrieving.delete(resolved);

      // get further chunk references
      const refs = chunk.getRelationships?.(RelationshipType.CONTINUED_IN);
      for (let refIndexInCube=0; refIndexInCube < refs?.length; refIndexInCube++) {
        const ref = refs[refIndexInCube];

        // ensure no circular references
        if (retrieved.has(ref.remoteKeyString)) continue;  // maybe error out instead?

        // schedule retrieval of referred chunk
        const retrievalPromise = this.cubeRetriever.getCube(
          ref.remoteKey, options as GetCubeOptionsT) as Promise<cciCube>;
        currentlyRetrieving.add(retrievalPromise);
        retrievalPromise.then((nextChunk) => chunkRetrieved(ref.remoteKey, nextChunk, retrievalPromise));
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
        nextChunkPromiseResolve(undefined);  // aborts retrieval as a whole
        return;
      }

      // Traverse all references to get an ordered list of all
      // chunk keys known so far
      // maybe TODO: if necessary, this can be optimised by keeping a separate
      // list and amending it as chunks are retrieved rather than recalculating
      // it each time
      const refs: Relationship[] = [];
      for (const chunk of orderedChunks) {
        // maybe TODO get rid of this potentially enormous amount of array
        // operations, see above
        refs.push(...chunk.getRelationships?.(RelationshipType.CONTINUED_IN));
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

    // cleanup
    const cleanup = (): void => {
      clearTimeout(timer);
    }

    // While we retrieve all those chunks we'll yield them one by once we
    // happen to retrieve the one that's next in line.
    // nextCubePromise represents the next chunk to be yielded.
    let nextChunkPromiseResolve: (cube: cciCube) => void = undefined;
    let nextChunkPromise: Promise<cciCube> = new Promise(resolve => {
      nextChunkPromiseResolve = resolve;
    });

    // There was a timeout, wasn't there?
    let timeoutReached: boolean = false;
    const timer: NodeJS.Timeout = setTimeout(() => {
      timeoutReached = true;
      nextChunkPromiseResolve(undefined);
    }, options.timeout);
    this.timers.push(timer);

    // Finally, initiate retrievals by retrieving first Cube:
    const firstChunkPromise: Promise<cciCube> =
      this.cubeRetriever.getCube(key, options as GetCubeOptionsT) as Promise<cciCube>;
    currentlyRetrieving.add(firstChunkPromise);
    let firstChunkKey: CubeKey = undefined;
    firstChunkPromise.then(chunk => {
      if (chunk !== undefined) {
        firstChunkKey = chunk.getKeyIfAvailable();
        chunkRetrieved(key, chunk as cciCube, firstChunkPromise);
      } else {
        // retrieval failed, either due to timeout or due to unavailable chunk
        cleanup();
        return false;
      }
    });
    nextChunkPromise = firstChunkPromise;

    // Wait for all Cubes to be retrieved and yield them:
    let chunk: cciCube;
    while ( (chunk = await nextChunkPromise) !== undefined ) {
      if (chunk === undefined) return false;  // retrieval failed
      yield chunk;
      orderedChunks.push(chunk);
      newNextChunkPromise(chunk.getKeyIfAvailable());
    }

    cleanup();
    return true;  // retrieval successful
  }

  // implement Shuttable
  private _shutdown: boolean = false;
  get shuttingDown(): boolean { return this._shutdown }
  private shutdownPromiseResolve: () => void;
  shutdownPromise: Promise<void> =
    new Promise(resolve => this.shutdownPromiseResolve = resolve);
  shutdown(): Promise<void> {
    this._shutdown = true;
    for (const timer in this.timers) {
      clearTimeout(timer);
    }
    this.shutdownPromiseResolve();
    return this.shutdownPromise;
  }
}
