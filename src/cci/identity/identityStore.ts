import type { CubeKey } from "../../core/cube/cube.definitions";
import { CubeRetrievalInterface } from "../../core/cube/cubeStore";
import { keyVariants } from "../../core/cube/cubeUtil";
import { Shuttable } from "../../core/helpers/coreInterfaces";
import { logger } from "../../core/logger";
import { cciCube } from "../cube/cciCube";
import { Identity, IdentityOptions } from "./identity";

export class IdentityStore implements Shuttable {
  private identityMap: Map<string, Identity> = new Map();
  private cubeRetriever: CubeRetrievalInterface;

  constructor(cubeRetriever: CubeRetrievalInterface) {
    this.cubeRetriever = cubeRetriever;
  }

  /**
   *
   * @param keyInput
   * @param id
   */
  addIdentity(id: Identity): void {
    if (!this.identityMap.has(id.keyString)) {
      this.identityMap.set(id.keyString, id);
    } else {
      logger.error(`IdentityStore: Cannot add ID ${id.keyString} as I already have it (identical: ${this.identityMap.get(id.keyString) === id})`);
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
    // Identity already in store?
    const stored: Identity = this.getIdentity(keyInput);
    if (stored !== undefined) return stored;

    // Identity retrievable?
    const key = keyVariants(keyInput);
    if (this.cubeRetriever) {
      // fetch Identity's root Cube from the network
      const muc: cciCube = await this.cubeRetriever.getCube(key.binaryKey);
      if (muc === undefined) {
        logger.trace(`IdentityStore.retrieveIdentity(): Cannot retrieve non-stored Identity ${key.keyString} because I could not retrieve its root Cube.`);
        return undefined;
      }
      // construct, store and return Identity object
      const id: Identity = new Identity(this.cubeRetriever, muc, options);
      this.addIdentity(id);
      return id;
    } else {
      logger.error(`IdentityStore.getOrCreateIdentity(): Cannot create non-stored Identity ${key.keyString} because I don't have a CubeRetriever.`);
      return undefined;
    }
  }

  // implement Shuttable
  private _shutdown: boolean = false;
  get shuttingDown(): boolean { return this._shutdown }
  private shutdownPromiseResolve: () => void;
  shutdownPromise: Promise<void> =
    new Promise(resolve => this.shutdownPromiseResolve = resolve);
  shutdown(): Promise<void> {
    this._shutdown = true;
    this.shutdownPromiseResolve();
    for (const id of this.identityMap.values()) {
      id.shutdown();
    }
    return this.shutdownPromise;
  }

}

