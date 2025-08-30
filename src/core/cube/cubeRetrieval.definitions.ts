import type { CubeKey, GetCubeOptions, NotificationKey } from "./cube.definitions";
import type { Cube } from "./cube";
import type { CubeInfo } from "./cubeInfo";
import type { CubeStore } from "./cubeStore";
import type { Veritable } from "./veritable.definition";
import type { Sublevels } from "./levelBackend";

import type { EventEmitter } from "events";

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

  // BUGBUG TODO: not all methods accepting CubeIteratorOptions support asString
  asString?: boolean;

  // BUGBUG TODO: not all methods accepting CubeIteratorOptions support wraparound
  wraparound?: boolean;
};

export type CubeIteratorOptionsSublevel = {
  /**
   * Which database (sublevel) to use.
   * @default Sublevels.CUBES
   */
  sublevel?: Sublevels;

  /**
   * If false, which is the default, return/yield values will be CubeKeys,
   * meaning we will perform the necessary conversion for you, if any.
   * (The technical reason is that only on the CUBES sublevel the database
   * keys are actually Cube keys; on all other sublevels, they are prefixed.)
   * @default false
   */
  getRawSublevelKeys?: boolean;

  /**
   * If true, which is the default, all keys you input (such as limit --
   * gt, gte, etc) will automatically converted to proper database keys, if necessary.
   * (The technical reason is that only on the CUBES sublevel the database
   * keys are actually Cube keys; on all other sublevels, they are prefixed.)
   * @default true
   */
  autoConvertInputKeys?: boolean;
}


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
