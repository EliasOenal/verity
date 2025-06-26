import type { CubeKey } from "../../core/cube/cube.definitions";
import type { CubeRetrievalInterface } from "../../core/cube/cubeStore";
import type { Shuttable } from "../../core/helpers/coreInterfaces";
import type { cciCube } from "../cube/cciCube";

import type { IdentityOptions } from "./identity.definitions";

import { keyVariants } from "../../core/cube/keyUtil";
import { logger } from "../../core/logger";
import { Identity } from "./identity";

export class IdentityStore implements Shuttable {
  private identityMap: Map<string, Identity> = new Map();
  private cubeRetriever: CubeRetrievalInterface<any>;

  constructor(cubeRetriever: CubeRetrievalInterface<any>) {
    this.cubeRetriever = cubeRetriever;
  }

  /**
   *
   * @param keyInput
   * @param id
   * @returns true if Identity was added, false if it was not
   */
  addIdentity(id: Identity): boolean {
    if (!this.identityMap.has(id.keyString)) {
      this.identityMap.set(id.keyString, id);
      return true;
    } else {
      logger.debug(`IdentityStore: Cannot add ID ${id.keyString} as I already have it (identical: ${this.identityMap.get(id.keyString) === id})`);
      return false;
    }
  }

  getIdentity(
      keyInput: CubeKey|string,
  ): Identity {
    // Fetch stored Identity
    const existing: Identity = this.identityMap.get(keyVariants(keyInput).keyString);
    if (existing) return existing;
    else return undefined;
  }

  /**
   * Note that the returned Identity is no necessarily fully ready yet;
   * caller should await the returned Identity's ready promise if required.
   */
  async retrieveIdentity(
      keyInput: CubeKey|string,
      options: IdentityOptions = {},
  ): Promise<Identity> {
    // Input sanitation: Ensure the options object refers to this IdentityStore
    options.identityStore = this;
    // Identity already in store?
    const stored: Identity = this.getIdentity(keyInput);
    if (stored !== undefined) return stored;

    // Identity retrievable?
    const key = keyVariants(keyInput);
    if (this.cubeRetriever) {
      // Fetch Identity's root Cube from the network
      // Note: This interrupts the current call, making it possible for a concurrent
      // call to retrieve and store the same Identity we're trying to fetch.
      const muc: cciCube = await this.cubeRetriever.getCube(key.binaryKey as CubeKey);
      const stored: Identity = this.getIdentity(keyInput);
      if (stored !== undefined) return stored;
      if (muc === undefined) {
        logger.trace(`IdentityStore.retrieveIdentity(): Cannot retrieve non-stored Identity ${key.keyString} because I could not retrieve its root Cube.`);
        return undefined;
      }
      // construct, store and return Identity object
      try {
        const id: Identity = new Identity(this.cubeRetriever, muc, options);
        // note: id will self-add itself to this IdentityStore
        return id;
      } catch (e) {
        logger.error(`IdentityStore.retrieveIdentity(): Cannot retrieve non-stored Identity ${key.keyString}: ${e}`);
        return undefined;
      }
    } else {
      logger.error(`IdentityStore.getOrCreateIdentity(): Cannot create non-stored Identity ${key.keyString} because I don't have a CubeRetriever.`);
      return undefined;
    }
  }

  deleteIdentity(input: Identity|CubeKey|string): void {
    this.identityMap.delete(Identity.KeyStringOf(input));
  }

  // implement Shuttable
  private _shutdown: boolean = false;
  get shuttingDown(): boolean { return this._shutdown }
  private shutdownPromiseResolve: () => void;
  shutdownPromise: Promise<void> =
    new Promise(resolve => this.shutdownPromiseResolve = resolve);

  shutdown(): Promise<void> {
    this._shutdown = true;  // mark myself as shutting down
    for (const id of this.identityMap.values()) {
      id.shutdown();  // shut down all my IDs
      this.deleteIdentity(id);  // delete all my ID references
    }
    this.shutdownPromiseResolve();
    return this.shutdownPromise;
  }

}

