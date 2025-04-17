import type { CubeKey } from "../../core/cube/cube.definitions";

import { Cube } from "../../core/cube/cube";
import { CubeRetrievalInterface } from "../../core/cube/cubeStore";
import { MergedAsyncGenerator, mergeAsyncGenerators } from "../../core/helpers/asyncGenerators";
import { CubeRetriever } from "../../core/networking/cubeRetrieval/cubeRetriever";
import { Identity } from "./identity";
import { isCci } from "../cube/cciCubeUtil";
import { cciCube } from "../cube/cciCube";
import { IdentityStore } from "./identityStore";

export interface NotifyingIdentitiesOptions {
  /**
   * In subscribe mode, we will network-subscribe the supplied notificiation key
   * and keep yielding further notifying Identities as we learn of them.
   * The returned async generator will never terminate;
   * it will keep running indefinetely.
   */
  subscribe?: boolean;
}

export async function *notifyingIdentities(
    cubeStoreOrRetriever: CubeRetrievalInterface<any>,
    notificationKey: CubeKey,
    identityStore: IdentityStore,
    options: NotifyingIdentitiesOptions = {},
): AsyncGenerator<Identity> {
  // First, get any notifying Identity root Cube matching the notification key
  let idRoots: MergedAsyncGenerator<Cube>;
  const existingIdRoots: AsyncGenerator<Cube> =
    cubeStoreOrRetriever.getNotifications(notificationKey) as AsyncGenerator<Cube>;
  if (options.subscribe && 'subscribeNotifications' in cubeStoreOrRetriever) {
    const futureIdRoots: AsyncGenerator<Cube> =
      (cubeStoreOrRetriever as CubeRetriever).subscribeNotifications(notificationKey);
    idRoots = mergeAsyncGenerators(existingIdRoots, futureIdRoots);
  } else {
    idRoots = mergeAsyncGenerators(existingIdRoots);
  }

  // Then, for each notifying Identity root Cube, yield its Identity
  for await (const idRoot of idRoots) {
    if (!isCci(idRoot)) continue;
    const id = new Identity(cubeStoreOrRetriever, idRoot as cciCube, {
      identityStore,
    });
    yield id;
  }
}
