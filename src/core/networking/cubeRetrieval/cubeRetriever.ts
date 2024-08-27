import { Cube } from "../../cube/cube";
import { CubeKey } from "../../cube/cube.definitions";
import { CubeFamilyDefinition } from "../../cube/cubeFields";
import { CubeInfo } from "../../cube/cubeInfo";
import { CubeRetrievalInterface, CubeStore } from "../../cube/cubeStore";
import { RequestScheduler } from "./requestScheduler";

/**
 * "He may not be Golden, but he'll always be your most trusted companion."
 * CubeRetriever is a helper class mainly used for light nodes, facilitating
 * Cube retrieval no matter whether a Cube is already present in the local
 * CubeStore or needs to be requested over the wire.
 */
export class CubeRetriever implements CubeRetrievalInterface {
  constructor(
    readonly cubeStore: CubeStore,
    readonly requestScheduler: RequestScheduler,
  ) {
  }

  async getCubeInfo(
      keyInput: CubeKey | string,
      scheduleIn: number = undefined,  // undefined = will use RequestScheduler's default
      timeout: number = undefined, // undefined = will use RequestScheduler's default
  ): Promise<CubeInfo> {
    const local: CubeInfo = await this.cubeStore.getCubeInfo(keyInput);
    if (local !== undefined) return local;
    try {
      const retrieved = await this.requestScheduler.requestCube(
        keyInput, scheduleIn, timeout);
      return retrieved;
    } catch(error) {
      return undefined;
    }
  }

  async getCube(
      key: CubeKey | string,
      family: CubeFamilyDefinition = undefined,  // undefined = will use CubeInfo's default
      scheduleIn: number = undefined,  // undefined = will use RequestScheduler's default
      timeout: number = undefined,  // undefined = will use RequestScheduler's default
  ): Promise<Cube> {
    return (await this.getCubeInfo(key, scheduleIn, timeout))?.getCube(family);
  }
}
