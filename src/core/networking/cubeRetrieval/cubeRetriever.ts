import { Cube } from "../../cube/cube";
import { CubeKey } from "../../cube/cube.definitions";
import { CubeFamilyDefinition } from "../../cube/cubeFields";
import { CubeInfo } from "../../cube/cubeInfo";
import { CubeRetrievalInterface, CubeStore } from "../../cube/cubeStore";
import { CubeRequestOptions, RequestScheduler } from "./requestScheduler";

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
