import type { CubeInfo } from "../../cube/cubeInfo";
import type { CubeStore } from "../../cube/cubeStore";
import type { Cube } from "../../cube/cube";
import type { CubeRetrievalInterface } from "../../cube/cubeRetrieval.definitions";
import type { CubeSubscription } from "./pendingRequest";
import type { CubeRequestOptions, CubeSubscribeOptions, RequestScheduler } from "./requestScheduler";

import { CancellableGenerator, eventsToGenerator } from "../../helpers/asyncGenerators";
import { CubeFieldType, type CubeKey, type NotificationKey } from "../../cube/cube.definitions";

export interface CubeSubscribeRetrieverOptions extends CubeSubscribeOptions {
  /**
   * This is an output parameter.
   * It is meant for testing, you will not need it in productive code.
   * It will be set to the Promise for the RequestScheduler's underlying
   * CubeSubscription objects.
   */
  outputSubPromise?: Promise<CubeSubscription>;

  /**
   * Placeholder for VeritumRetriever compatibility; will be removed here
   * once we have a universal `format` option in CubeRetrievalInterface.
   */
  format?: any;
}

/**
 * "He may not be Golden, but he'll be your most trusted companion."
 * CubeRetriever is a helper class for light nodes, facilitating
 * Cube retrieval no matter whether a Cube is already present in the local
 * CubeStore or needs to be requested over the wire.
 */
export class CubeRetriever implements CubeRetrievalInterface<CubeRequestOptions> {

  constructor(
    readonly cubeStore: CubeStore,
    readonly requestScheduler: RequestScheduler,
  ) {
  }

  /**
   * Fetches a single CubeInfo, either from the local CubeStore or over the
   * wire if it is not present.
   * Note that a network request will strictly only be sent if the Cube is not
   * present in the local CubeStore, thus mutable Cubes will not be updated
   * using this method.
   * @param key - The key of the Cube to fetch
   * @param options - Any optional Cube request parameters
   */
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

  /**
   * Fetches a single Cube, either from the local CubeStore or over the
   * wire if it is not present.
   * Note that a network request will strictly only be sent if the Cube is not
   * present in the local CubeStore, thus mutable Cubes will not be updated
   * using this method.
   * @param key - The key of the Cube to fetch
   * @param options - Any optional Cube request parameters
   */
  async getCube<cubeClass extends Cube>(
      key: CubeKey | string,
      options: CubeRequestOptions = undefined,  // undefined = will use RequestScheduler's and CubeInfo's default
  ): Promise<cubeClass> {
    const cubeInfo = await this.getCubeInfo(key, options);
    return cubeInfo?.getCube<cubeClass>(options);
  }

  /**
   * Subscribe to any updates to a single Cube.
   * To achieve this, we will network-subscribe to the key provided with a
   * single remote note.
   * If we currently do not have the specified Cube, we will try to request it
   * and yield it once received.
   * Note: In case the requested Cube is already in our local store, this call
   *   will *not* yield the currently stored version. Only updates will be
   *   yielded.
   *   This obviously means that this call will yield nothing and is thus
   *   useless for already-stored non-mutable Cubes.
   * @param key - The key of the Cube to subscribe to
   * @param options - Any optional Cube request parameters
   * @returns - A cancellable AsyncGenerator yielding any updates to the
   *   requested Cube.
   */
  // TODO Cleanup: Netowrk-subscription should be cancelled when generator is
  //   cancelled, but only if there are no other active generators relying on
  //   the same subscription.
  subscribeCube(
      key: CubeKey,
      options: CubeSubscribeRetrieverOptions = {},
  ): CancellableGenerator<Cube> {
    // Prepare a Generator that will yield all updates to this Cube.
    // To do this, we will leverage CubeStore's cubeAdded events and adapt
    // them into a Generator.
    // That generator will be limited to only yielding events which match the
    // subscribed key.
    const generator: CancellableGenerator<Cube> = eventsToGenerator(
      [{ emitter: this.cubeStore, event: 'cubeAdded' }],
      {
        limit: (cubeInfo: CubeInfo) => cubeInfo.key.equals(key),
        transform: (cubeInfo: CubeInfo) => cubeInfo.getCube(),
      },
    );

    // Have our scheduler actually network-subscribe the requested Cube first
    // This needs to happen synchronously to ensure we don't miss any updates
    options.outputSubPromise = this.requestScheduler.subscribeCube(key);

    // Then try to fetch the cube if it doesn't exist locally
    // This maintains the high-level behavior of getting initial state when subscribing
    this.getCubeInfo(key).catch(() => {
      // If initial fetch fails, that's okay - we still have the subscription
      // for future updates
    });

    return generator;
  }

  /**
   * Fetches any notifications to a specific recipient key.
   * This will first yield all notifications already locally present;
   * then, it will perform a single network request for new notifications.
   * @param recipient - The notification key to fetch notifications for
   * @param options - Currently unused
   */
  async *getNotifications(recipient: NotificationKey, options?: {}): AsyncGenerator<Cube> {
    // HACKHACK:
    // We first yield all notifications already locally present;
    // only then we request them from the network.
    // This is to both avoid having to wait for a network request to complete,
    // and to avoid duplicates.
    // (Note that there can still be "duplicates" in the form of newly received
    // updates to mutable Cubes.)
    // While the performance impact should be minimal (local store retrieval is
    // very fast compared to network requests), this does mean that the network
    // request is only fired once the caller has started iterating and is done
    // processing the local notifications.
    // TODO: pass through options to individual retrieval calls
    yield* this.cubeStore.getNotifications(recipient);

    // Prepare to add newly added notifications
    const newlyAdded = eventsToGenerator([
      { emitter: this.cubeStore, event: 'cubeAdded' },
    ], {
      limit: (cubeInfo: CubeInfo) =>
        cubeInfo.getCube()?.getFirstField?.(CubeFieldType.NOTIFY)?.value
          ?.equals?.(recipient) ?? false,
      transform: (cubeInfo: CubeInfo) => cubeInfo.getCube(),
    });

    // Fire a single network request for new notifications
    const req = this.requestScheduler.requestNotifications(recipient);
    req.then(async () => {
      // HACKHACK: Wait a few more millis before terminating.
      // The reason for this is that RequestScheduler resolves it's requestNotifications()
      // promise within the cubeAddedHandler(), which is obviously called right after
      // the first response has been stored; there may be more responses in
      // the same batch waiting to be processed.
      await new Promise(resolve => setTimeout(resolve, 100));
      newlyAdded.cancel();
    });

    yield *newlyAdded;
  }

  /**
   * Subscribe to new notifications to a specific recipient key.
   * To achieve this, we will network-subscribe to the key provided with a
   * single remote note.
   * Note: This call will *not* yield any notifications already in our local
   *   store. Only newly received notifications will be yielded.
   * @param key - The notification key to subscribe to
   * @param options - Any optional network subscription parameters
   * @returns - A cancellable AsyncGenerator yielding new notifications
   */
  subscribeNotifications(
    key: NotificationKey,
    options: CubeSubscribeRetrieverOptions = {},
  ): CancellableGenerator<Cube> {
    // Prepare a Generator that will yield Cubes notifying this key
    // To do this, we will leverage CubeStore's notificationAdded events and adapt
    // them into a Generator.
    // That generator will be limited to only yielding events which match the
    // subscribed key.
    const generator: CancellableGenerator<Cube> = eventsToGenerator(
      [{ emitter: this.cubeStore, event: 'notificationAdded' }],
      {
        limit: (emittedKey: CubeKey, cube: Cube) => emittedKey.equals(key),
        transform: (emittedKey: CubeKey, cube: Cube) => cube,
      },
    );

    // Have our scheduler actually network-subscribe the requested notification key
    options.outputSubPromise = this.requestScheduler.subscribeNotifications(key);
    // TODO error handling

    return generator;
  }

  /**
   * Expects a Cube to be received soon, without actually requesting it.
   * @param key The key of the Cube to expect
   * @returns A promise that will resolve to the expected Cube's CubeInfo
   *   if and when it is eventually received.
   */
  expectCube(key: CubeKey): Promise<CubeInfo> {
    return this.cubeStore.expectCube(key);
  }

  // TODO add retrieval methods for notifications
}
