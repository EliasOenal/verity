import { EventEmitter } from "events";
import { Cube } from "./cube";
import { CubeKey, GetCubeOptions, NotificationKey } from "./cube.definitions";
import { CubeInfo } from "./cubeInfo";
import { CubeStore } from "./cubeStore";
import { Veritable } from "./veritable.definition";

/**
 * A generalised interface for objects that can retrieve Cubes.
 * Examples within the core library include CubeStore and CubeRetriever.
 */

export interface CubeRetrievalInterface<OptionsType = GetCubeOptions> {
  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo>;
  getCube<cubeClass extends Cube>(key: CubeKey | string, options?: OptionsType): Promise<cubeClass>;
  expectCube(keyInput: CubeKey | string): Promise<CubeInfo>; // maybe TODO: add timeout?
  getNotifications(recipientKey: NotificationKey | string, options?: {}): AsyncGenerator<Veritable>;
  cubeStore: CubeStore;
}

export type CubeIteratorOptions = {
  gt?: CubeKey | NotificationKey;
  gte?: CubeKey | NotificationKey;
  lt?: CubeKey | NotificationKey;
  lte?: CubeKey | NotificationKey;
  limit?: number;
  asString?: boolean;
  wraparound?: boolean;
  reverse?: boolean;
};


export interface CubeEmitterEvents extends Record<string, any[]> {
  cubeAdded: [CubeInfo];
  notificationAdded: [notificationKey: CubeKey, cube: Cube];
}
/**
 * CubeEmitter is a generelised interface for objects that can emit CubeInfos.
 * They will also keep track of all emitted Cubes.
 * CubeStore is obviously an example of a CubeEmitter, emitting a CubeInfo
 * whenever a Cube is added to or updated in store.
 */

export interface CubeEmitter extends EventEmitter<CubeEmitterEvents> {
  /**
   * A Generator producing all CubeInfos that have been emitted by this emitter;
   * or would have been emitted if the emitter existed at the appropriate time.
   */
  getAllCubeInfos(): AsyncGenerator<CubeInfo>;

  // CubeEmitter may optionally implement Shuttable.
  // You should thus also call cubeEmitter?.shutdown?.() when you're done with it.
  shutdown?: () => Promise<void>;
}
