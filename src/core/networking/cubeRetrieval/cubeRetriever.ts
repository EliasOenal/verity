import { Cube } from "../../cube/cube";
import { CubeKey } from "../../cube/cube.definitions";
import { CubeFamilyDefinition } from "../../cube/cubeFields";
import { CubeInfo } from "../../cube/cubeInfo";
import { CubeRetrievalInterface, CubeStore } from "../../cube/cubeStore";
import { keyVariants } from "../../cube/cubeUtil";
import { eventsToGenerator } from "../../helpers/asyncGenerators";
import { CubeSubscription } from "./pendingRequest";
import { CubeRequestOptions, CubeSubscribeOptions, RequestScheduler } from "./requestScheduler";

export interface CubeSubscribeRetrieverOptions extends CubeSubscribeOptions {
  /**
   * This is an output parameter.
   * It is meant for testing, you will not need it in productive code.
   * It will be set to the Promise for the RequestScheduler's underlying
   * CubeSubscription objects.
   */
  outputSubPromise?: Promise<CubeSubscription>;
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

  async getCube<cubeClass extends Cube>(
      key: CubeKey | string,
      options: CubeRequestOptions = undefined,  // undefined = will use RequestScheduler's and CubeInfo's default
  ): Promise<cubeClass> {
    const cubeInfo = await this.getCubeInfo(key, options);
    return cubeInfo?.getCube<cubeClass>(options);
  }

  subscribeCube(
      keyInput: CubeKey|string,
      options: CubeSubscribeRetrieverOptions = {},
  ): AsyncGenerator<Cube> {
    // normalise input
    const key: CubeKey = keyVariants(keyInput).binaryKey;

    // Prepare a Generator that will yield all updates to this Cube.
    // To do this, we will leverage CubeStore's cubeAdded events and adapt
    // them into a Generator.
    // That generator will be limited to only yielding events which match the
    // subscribed key.
    const generator: AsyncGenerator<Cube> = eventsToGenerator(
      [{ emitter: this.cubeStore, event: 'cubeAdded' }],
      {
        limit: (cubeInfo: CubeInfo) => cubeInfo.key.equals(key),
        transform: (cubeInfo: CubeInfo) => cubeInfo.getCube(),
      },
    );

    // Have our scheduler actually network-subscribe the requested Cube
    options.outputSubPromise =this.requestScheduler.subscribeCube(keyInput);
    // TODO error handling

    return generator;
  }

  subscribeNotifications(
    keyInput: CubeKey|string,
    options: CubeSubscribeRetrieverOptions = {},
  ): AsyncGenerator<Cube> {
    // normalise input
    const key: CubeKey = keyVariants(keyInput).binaryKey;

    // Prepare a Generator that will yield Cubes notifying this key
    // To do this, we will leverage CubeStore's notificationAdded events and adapt
    // them into a Generator.
    // That generator will be limited to only yielding events which match the
    // subscribed key.
    const generator: AsyncGenerator<Cube> = eventsToGenerator(
      [{ emitter: this.cubeStore, event: 'notificationAdded' }],
      {
        limit: (emittedKey: CubeKey, cube: Cube) => emittedKey.equals(key),
        transform: (emittedKey: CubeKey, cube: Cube) => cube,
      },
    );

    // Have our scheduler actually network-subscribe the requested notification key
    options.outputSubPromise = this.requestScheduler.subscribeNotifications(keyInput);
    // TODO error handling

    return generator;
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

  // TODO add retrieval methods for notifications
}
