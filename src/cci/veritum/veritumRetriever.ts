import type { CubeKey, NotificationKey } from "../../core/cube/cube.definitions";
import type { Shuttable } from "../../core/helpers/coreInterfaces";
import type { Cube } from "../../core/cube/cube";
import type { CubeInfo } from "../../core/cube/cubeInfo";
import type { CubeRequestOptions, RequestScheduler } from "../../core/networking/cubeRetrieval/requestScheduler";
import type { Veritable } from "../../core/cube/veritable.definition";
import type { CubeStore } from "../../core/cube/cubeStore";
import type { CubeRetrievalInterface } from "../../core/cube/cubeRetrieval.definitions";
import type { cciCube } from "../cube/cciCube";

import { Settings } from "../../core/settings";
import { ArrayFromAsync } from "../../core/helpers/misc";
import { keyVariants } from "../../core/cube/keyUtil";
import { logger } from "../../core/logger";

import { RelationshipType, Relationship } from "../cube/relationship";
import { Veritum } from "./veritum";
import { RetrievalFormat, VeritumFromChunksOptions } from "./veritum.definitions";
import { Identity } from "../identity/identity";
import { MetadataEnhancedRetrieval, resolveRels, ResolveRelsOptions, resolveRelsRecursive, ResolveRelsRecursiveOptions, ResolveRelsRecursiveResult, ResolveRelsResult } from "./veritumRetrievalUtil";

export interface VeritumRetrievalInterface<OptionsType = CubeRequestOptions> extends CubeRetrievalInterface<OptionsType> {
  getVeritum(key: CubeKey|string, options?: OptionsType): Promise<Veritum>;
}

export interface GetVeritumOptions extends CubeRequestOptions, ResolveRelsOptions {
  /**
   * If true, return a unified metadata container object, containing the
   * veritum as its `main` property.
   * Note that you normally don't need to set this option manually.
   * It will always be enabled by default if you select a metadata supplying option,
   * e.g. resolveRels.
   * @default - false if no options supplying metadata selected, true otherwise
   */
  metadata?: boolean;

  /**
   * Automatically attempt to decrypt the Veritum if it is encrypted
   */
  recipient?: Identity|Buffer;
}

export interface GetNotificationsOptions extends GetVeritumOptions {
  format?: RetrievalFormat;
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

  get cubeStore(): CubeStore { return this.cubeRetriever.cubeStore }

  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.cubeRetriever.getCubeInfo(keyInput);
  }

  expectCube(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.cubeRetriever.expectCube(keyInput);
  }

  getCube<cubeClass extends Cube = cciCube>(
      key: CubeKey | string,
      options: {resolveRels: true, metadata?: true} & GetCubeOptionsT & GetVeritumOptions & ResolveRelsOptions,
  ): Promise<ResolveRelsResult>;
  getCube<cubeClass extends Cube = cciCube>(
      key: CubeKey | string,
      options: {resolveRels: 'recursive', metadata?: true} & GetCubeOptionsT & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<ResolveRelsRecursiveResult>;
  getCube<cubeClass extends Cube = cciCube>(
    key: CubeKey | string,
    options: {metadata: true} & GetCubeOptionsT & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<MetadataEnhancedRetrieval<Cube>>;
  getCube<cubeClass extends Cube = cciCube>(
      key: CubeKey | string,
      options?: GetCubeOptionsT & GetVeritumOptions
  ): Promise<cubeClass>;
// TODO implement auto-decryption of single encrypted Cubes
  getCube<cubeClass extends Cube = cciCube>(
      key: CubeKey | string,
      options: Partial<GetCubeOptionsT & GetVeritumOptions & ResolveRelsRecursiveOptions> = {}
  ): Promise<cubeClass|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<Cube>> {
    // set default options
    if (options.resolveRels) (options as GetVeritumOptions).metadata ??= true;

    // Fire retrieval
    const cubePromise: Promise<cubeClass> =
      this.cubeRetriever.getCube(key, options as GetCubeOptionsT);

    // Shall we enhance the result with metadata?
    if (!options.metadata) return cubePromise;  // nope, we're good

    // In case we shall resolve recursions, it's us who handles this -- the layers
    // below will not be passed `resolveRels` again
    const avoidDoubleRes = { ...options, resolveRels: false, metadata: false };

    // Determine and prepare output format:
    // - Resolve relationships (single level)
    if (options.resolveRels === true) {
      return cubePromise.then(cube =>
        resolveRels(cube, this.getCube.bind(this), avoidDoubleRes as ResolveRelsOptions));
    }
    // - Resolve relationships (recursive)
    else if (options.resolveRels === 'recursive') {
      return cubePromise.then(cube =>
        resolveRelsRecursive(cube, this.getCube.bind(this), avoidDoubleRes as ResolveRelsRecursiveOptions));
    }
    // - None of that? Craft an empty meta data object then I guess.
    else return cubePromise.then(cube => {
      const ret: MetadataEnhancedRetrieval<Cube> = {
        main: cube,
        done: Promise.resolve(),
        isDone: true,
      };
      return ret;
    });
  }

  // Overloads:
  // - Auto-resolving relationships, single level
  getVeritum(
      key: CubeKey | string,
      options: {resolveRels: true, metadata?: true} & GetCubeOptionsT & GetVeritumOptions & ResolveRelsOptions,
  ): Promise<ResolveRelsResult<Veritum>>;
  // - Auto-resolving relationships, recursive
  getVeritum(
      key: CubeKey | string,
      options: {resolveRels: 'recursive', metadata?: true} & GetCubeOptionsT & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<ResolveRelsRecursiveResult<Veritum>>;
  // - Using metadata, but not auto-resolving relationships
  getVeritum(
      key: CubeKey | string,
      options: {metadata: true} & GetCubeOptionsT & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<MetadataEnhancedRetrieval<Veritum>>;
  // - Plain output, no metadata
  getVeritum(
      key: CubeKey | string,
      options?: GetCubeOptionsT & GetVeritumOptions
  ): Promise<Veritum>;

  async getVeritum(
      key: CubeKey|string,
      options: Partial<GetCubeOptionsT&GetVeritumOptions> = {},
  ): Promise<Veritum|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<Veritum>> {
    // set default options
    if (options.resolveRels) (options as GetVeritumOptions).metadata ??= true;

    // Request this Veritum's chunk Cubes
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
        logger.error("VeritumRetriever.getVeritum(): Invalid param for options.recipient, must be a Buffer containing a private key or an Identity object. Will not attempt to decrypt.");
      }
    }

    // Decompile the Veritum
    const fromChunksOptions: VeritumFromChunksOptions = options?
      {
        ...options,
        // TODO BUGBUG: Try decompilation for every family definition supplied
        family: Array.isArray(options.family) ? options.family[0] : options.family,
        recipientPrivateKey,
      } :
      { recipientPrivateKey }
    ;
    const veritum: Veritum = Veritum.FromChunks(chunks, fromChunksOptions);

    return this.enhanceMetadata(veritum, options) as Veritum|MetadataEnhancedRetrieval<Veritum>;
  }

  // Overloads for getNotifications()
  // Overloads using the `Cube` RetrievalFormat:
  // - Auto-resolving relationships, single level
  getNotifications<cubeClass extends Cube>(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format: RetrievalFormat.Cube,
      metadata: true,
      resolveRels: true,
    },
  ): AsyncGenerator<ResolveRelsResult<cubeClass>>;
  // - Auto-resolving relationships, recursive
  getNotifications<cubeClass extends Cube>(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format: RetrievalFormat.Cube,
      metadata: true,
      resolveRels: 'recursive',
    },
  ): AsyncGenerator<ResolveRelsRecursiveResult<cubeClass>>;
  // - Using metadata, but not auto-resolving relationships
  getNotifications<cubeClass extends Cube>(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format: RetrievalFormat.Cube,
      metadata: true,
    },
  ): AsyncGenerator<MetadataEnhancedRetrieval<cubeClass>>;
  // - Plain output, no metadata
  getNotifications<cubeClass extends Cube>(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format: RetrievalFormat.Cube,
    },
  ): AsyncGenerator<cubeClass>;
  // Overloads using the `Veritum` RetrievalFormat (default):
  // - Auto-resolving relationships, single level
  getNotifications(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format?: RetrievalFormat.Veritum,
      metadata: true,
      resolveRels: true,
    },
  ): AsyncGenerator<ResolveRelsResult<Veritum>>;
  // - Auto-resolving relationships, recursive
  getNotifications(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format?: RetrievalFormat.Veritum,
      metadata: true,
      resolveRels: 'recursive',
    },
  ): AsyncGenerator<ResolveRelsRecursiveResult<Veritum>>;
  // - Using metadata, but not auto-resolving relationships
  getNotifications(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format?: RetrievalFormat.Veritum,
      metadata: true,
    },
  ): AsyncGenerator<MetadataEnhancedRetrieval<Veritum>>;
  // - Plain output, no metadata
  getNotifications(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions & {
      format?: RetrievalFormat.Veritum,
    },
  ): AsyncGenerator<Veritum>;
  // - Default overload with no options supplied
  getNotifications(
    keyInput: NotificationKey | string,
  ): AsyncGenerator<Veritum>;

  /**
   * Retrieves all available Verita notifying a given key.
   * Any Veritum can only notify a single key, and is considered a notification
   * Veritum if its first Chunk Cube contains an appropriate NOTIFY field.
   * @returns An AsyncGenerator yielding notification Verita
   */
  // TODO: This method contains lots of async glue code which should be
  //   generalised as a helpers, perhaps even included in mergeAsyncGenerators()
  async *getNotifications(
    keyInput: NotificationKey | string,
    options: GetNotificationsOptions = {},
  ): AsyncGenerator<Veritable|MetadataEnhancedRetrieval<Veritable>> {
    // set default options
    options.format ??= RetrievalFormat.Veritum;

    // If the user just wants notification Cubes rather than notification
    // Verita, everything that follows below is complete overkill.
    // Rather, let's just redirect the user to CubeRetriever.
    if (options.format === RetrievalFormat.Cube) {
      yield* this.cubeRetriever.getNotifications(keyInput, options);
      return;
    }

    // To retrieve notification Verita, we first must retrieve the notifying
    // root chunk Cubes. This is done using CubeRetriever's getNotifications()
    // method, which is also an AsyncGenerator.
    // As soon as CubeRetriever yields a root chunk for us, we immediately
    // want to retrieve the full notification Veritum, and immediately yield
    // it once it arrives.

    // We'll use a set to store pending retrievals of remaining chunks,
    // which are the retrievals initiated after we received the corresponding
    // root chunks.
    const pending = new Set<Promise<Veritum>>();
    const concurrencyLimit = 10; // TODO parametrise

    // Helper function to wrap a promise so that it resolves to a tuple of
    // [result, originalPromise]. We use this to remove the promise from the
    // pending set once it has been handled (i.e. the Veritum has been yielded).
    const wrapPromise = (p: Promise<Veritum>): Promise<[Veritum, Promise<Veritum>]> =>
      p.then((value) => [value, p] as [Veritum, Promise<Veritum>]);

    // Helper function to yield one notification Veritum as soon as we have it in full.
    async function yieldOne(retriever: VeritumRetriever): Promise<Veritable|MetadataEnhancedRetrieval<Veritable>> {
      // Wait for the fastest promise in the pending set.
      // Wrap each pending promise so that it resolves with a tuple [value, originalPromise].
      const wrappedPromises = Array.from(pending).map(wrapPromise);
      const [value, originalPromise] = await Promise.race(wrappedPromises);
      // Now that we've handled it, remove the promise from the pending set.
      pending.delete(originalPromise);
      return retriever.enhanceMetadata(value, options);
    }

    // Launch Veritum retrievals as we get notifying root chunks.
    for await (const rootChunk of this.cubeRetriever.getNotifications(keyInput)) {
      // Start retrieving the remaining chunks immediately.
      const task = (async () => {
        const key = await rootChunk.getKey();
        return this.getVeritum(key);
      })();
      pending.add(task);

      // If we have reached the concurrency limit, yield one as soon as it finishes.
      if (pending.size >= concurrencyLimit) {
        yield await yieldOne(this);
      }
    }

    // Yield any remaining notifications as soon as they complete.
    while (pending.size > 0) {
      yield await yieldOne(this);
    }
  }

  // TODO implement subscribeNotifications()


  // Note: This method basically defines a subclass and instantiates it for every call.
  //   Maybe we should refactor it into an actual class "ChunkRetriever" or something.
  //   Or maybe we call this idiomatic and leave it as it is? I don't know.
  // TODO: Add an option to limit the maximum number of Continuation chunks.
  //   This is important as applications expecting e.g. 5KB Verita will not
  //   want to inadvertently initiate a 300MB video download just because
  //   of a misplaced (or malicious) reference.
  //   We should probably even set a (rather low) limit as default an print a
  //   warning whenever the application does not provide its own limit.
  /**
   * This is a low level method retrieving a Veritum's chunks without actually
   * reconstructing the Veritum. You will usually want to use getVeritum()
   * instead.
   * @returns An AsyncGenerator of chunk Cubes
   */
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
        const newRefs = chunk.getRelationships?.(RelationshipType.CONTINUED_IN);
        if (Array.isArray(newRefs)) refs.push(...newRefs);
        // maybe TODO get rid of this potentially enormous amount of array
        // operations, see above
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
        // There are no further CONTINUED_IN references in the chunks we've received so far.
        // However, we might still have chunks being retrieved that could contain additional
        // CONTINUED_IN references. We should wait for all pending retrievals to complete
        // before declaring the chain complete to avoid race conditions.
        if (currentlyRetrieving.size > 0) {
          // Wait for all pending retrievals and then re-check
          Promise.all(Array.from(currentlyRetrieving)).then(() => {
            // Re-run the check after all pending retrievals complete
            resolveNextChunkPromiseIfPossible();
          });
          return;
        }

        // Now we can safely say there are no further CONTINUED_IN references.
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

    const newNextChunkPromise = (chunkKey: CubeKey) => {
      // abort if timeout reached
      if (timeoutReached) {
        logger.trace(`VeritumRetriever newNextChunkPromise(): timeout reached while retrieving chain ${keyVariants(key).keyString} expecting chunk ${keyVariants(chunkKey).keyString}, aborting. Aborting retrieval.`);
        return;
      }

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
      logger.trace(`VeritumRetriever newNextChunkPromise(): timeout reached while retrieving chain ${keyVariants(key).keyString}, aborting. Aborting retrieval.`);
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

  private enhanceMetadata(
    veritable: Veritable,
    options: GetVeritumOptions,
  ): Veritable|MetadataEnhancedRetrieval<Veritable> {
    // Shall we enhance the result with metadata?
    if (!options.metadata) return veritable;  // nope, we're good

    // In case we shall resolve recursions, it's us who handles this -- the layers
    // below will not be passed `resolveRels` again
    const avoidDoubleRes = { ...options, resolveRels: false, metadata: false };

    // Determine and prepare output format:
    // - Resolve relationships (single level)
    if (options.resolveRels === true) {
      return resolveRels(
        veritable,
        this.getVeritum.bind(this),
        avoidDoubleRes as ResolveRelsOptions,
      );
    }
    // - Resolve relationships (recursive)
    else if (options.resolveRels === 'recursive') {
      return resolveRelsRecursive(
        veritable,
        this.getVeritum.bind(this),
        avoidDoubleRes as ResolveRelsRecursiveOptions,
      );
    }
    // - None of that? Craft an empty meta data object then I guess.
    else {
      const ret: MetadataEnhancedRetrieval<Veritable> = {
        main: veritable,
        done: Promise.resolve(),
        isDone: true,
      };
      return ret;
    }
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
