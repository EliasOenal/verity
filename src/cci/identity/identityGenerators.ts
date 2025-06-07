import type { Cube } from "../../core/cube/cube";
import type { CubeKey } from "../../core/cube/cube.definitions";
import type { CubeRetrievalInterface } from "../../core/cube/cubeStore";
import type { CubeRetriever } from "../../core/networking/cubeRetrieval/cubeRetriever";
import type { cciCube } from "../cube/cciCube";
import type { IdentityStore } from "./identityStore";

import { MergedAsyncGenerator, mergeAsyncGenerators } from "../../core/helpers/asyncGenerators";
import { isCci } from "../cube/cciCubeUtil";
import { Identity } from "./identity";
import { RetrievalFormat } from "../veritum/veritumRetriever";


export interface NotifyingIdentitiesOptions {
  /**
   * In subscribe mode, we will network-subscribe the supplied notificiation key
   * and keep yielding further notifying Identities as we learn of them.
   * The returned async generator will never terminate;
   * it will keep running indefinetely.
   */
  subscribe?: boolean;
}

// TODO: make cancellable, in particular in subscribe mode
// Note: cubeStoreOrRetriever should actually be a CubeStore or a CubeRetriever;
//   supplying a VeritumRetriever will not work properly.
export async function *notifyingIdentities(
    cubeStoreOrRetriever: CubeRetrievalInterface<any>,
    notificationKey: CubeKey,
    identityStore: IdentityStore,
    options: NotifyingIdentitiesOptions = {},
): AsyncGenerator<Identity> {
  // First, get any notifying Identity root Cube matching the notification key
  let idRoots: MergedAsyncGenerator<Cube>;
  const existingIdRoots: AsyncGenerator<Cube> =
    cubeStoreOrRetriever.getNotifications(notificationKey, { format: RetrievalFormat.Cube }) as AsyncGenerator<Cube>;
  if (options.subscribe && 'subscribeNotifications' in cubeStoreOrRetriever) {
    const futureIdRoots: AsyncGenerator<Cube> =
      (cubeStoreOrRetriever as CubeRetriever).subscribeNotifications(notificationKey);
    idRoots = mergeAsyncGenerators(existingIdRoots, futureIdRoots);
  } else {
    idRoots = mergeAsyncGenerators(existingIdRoots);
  }

  const idsHandled: Set<string> = new Set();

  // Then, for each notifying Identity root Cube, yield its Identity
  for await (const idRoot of idRoots) {
    if (!isCci(idRoot)) continue;
    const keyString = idRoot.getKeyStringIfAvailable();

    // In subscribe mode, we may receive the same Identity multiple times.
    // So let's skip any duplicates.
    if (idsHandled.has(keyString)) continue;
    idsHandled.add(keyString);

    // Do we already have an object for this Identity?
    const id = identityStore.getIdentity(keyString);
    if (id)  yield id;
    else {
    // We don't yet have an object for this Identity.
    // Create one, then yield it.
      const id = new Identity(cubeStoreOrRetriever, idRoot as cciCube, {
        identityStore,
      });
      yield id;
    }
  }
}
