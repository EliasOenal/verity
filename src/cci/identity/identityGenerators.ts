import type { CoreCube } from "../../core/cube/coreCube";
import type { CubeKey, NotificationKey } from "../../core/cube/coreCube.definitions";
import type { CubeRetrievalInterface } from "../../core/cube/cubeRetrieval.definitions";
import type { Cube } from "../cube/cube";
import type { IdentityStore } from "./identityStore";

import { MergedAsyncGenerator, mergeAsyncGenerators } from "../../core/helpers/asyncGenerators";
import { isCci } from "../cube/cubeUtil";
import { Identity } from "./identity";
import { RetrievalFormat } from "../veritum/veritum.definitions";


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
export async function *notifyingIdentities(
    cubeStoreOrRetriever: CubeRetrievalInterface<any>,
    notificationKey: NotificationKey,
    identityStore: IdentityStore,
    options: NotifyingIdentitiesOptions = {},
): AsyncGenerator<Identity> {
  // First, get any notifying Identity root Cube matching the notification key
  let idRoots: MergedAsyncGenerator<CoreCube>;
  const existingIdRoots: AsyncGenerator<CoreCube> =
    cubeStoreOrRetriever.getNotifications(notificationKey, { format: RetrievalFormat.Cube }) as AsyncGenerator<CoreCube>;

  // HACKHACK: Check if there's a subscribeNotifications() method.
  //   This is a "temporary" hack to work around the fact that CubeRetrievalInterface
  //   does not yet mandate the presence of a subscribeNotifications() method;
  //   and notably CubeStore does not implement it.
  if (options.subscribe && 'subscribeNotifications' in cubeStoreOrRetriever) {
    const futureIdRoots: AsyncGenerator<CoreCube> =
      (cubeStoreOrRetriever as any).subscribeNotifications(notificationKey, { format: RetrievalFormat.Cube });
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
    let id = identityStore.getIdentity(keyString);
    if (id === undefined) {
      // We don't yet have an object for this Identity.
      // Create one, then yield it.
      id = new Identity(cubeStoreOrRetriever, idRoot as Cube, {
        identityStore,
      });
    }
    yield id;
  }
}
