import type { CubeKey } from "../../core/cube/coreCube.definitions";
import type { CubeRetrievalInterface } from "../../core/cube/cubeRetrieval.definitions";
import type { Shuttable } from "../../core/helpers/coreInterfaces";
import type { Cube } from "../cube/cube";

import type { IdentityOptions } from "./identity.definitions";

import { CancellableTask } from "../../core/helpers/promises";
import { keyVariants } from "../../core/cube/keyUtil";
import { logger } from "../../core/logger";

import { Veritable } from "../cube/veritable.definition";
import { Relationship, RelationshipType } from "../cube/relationship";
import { Identity } from "./identity";
import { verifyAuthorship } from "./identityUtil";

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
      //   call to retrieve and store the same Identity we're trying to fetch;
      //   thus we'll re-check if the Identity in question has already been
      //   created in the meantime.
      const muc: Cube = await this.cubeRetriever.getCube(key.binaryKey as CubeKey);
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

  /**
   * Retrieves the Identity object of the author of the given notification.
   * Note:
   * - Notification here meaning any Veritable containing an AUTHORHINT rel
   *   pointing to the author's Identity root -- this is commonly used in
   *   notification Cubes, but there is no requirement that the argument is
   *   in fact a notification Cube.
   * - Authorship is verified by checking if the author's Identity actually
   *   refers to the notification containing the AUTHORHINT.
   *   This is necessary as AUTHORHINT relationships are not authenticated;
   *   if we didn't check the actual signed Identity refers back to the
   *   notification, anybody could make up fake authorship attributions.
   * @param notification {Veritable} The notification of which you'd like to
   *   retrieve the author.
   * @returns {CancellableTask<Identity>} The author's Identity, or undefined if either the
   *   Identity object could not be retrieved or the authorship could not be
   *   verified.
   */
  findAuthor(notification: Veritable): CancellableTask<Identity> {
    // Which post key?
    const postKey: CubeKey = notification?.getKeyIfAvailable?.();
    if (postKey === undefined) {
      logger.warn(`NotificationStore.findAuthor(): Cannot find author for notification with unknown key; aborting.`);
      return new CancellableTask(Promise.resolve(undefined));
    }

    // Which author is claimed?
    const authorHint: Relationship =
      notification.getFirstRelationship(RelationshipType.AUTHORHINT);
    if (authorHint === undefined) {
      logger.debug(`NotificationStore.findAuthor(): No AUTHORHINT found in notification ${notification.getKeyStringIfAvailable()}`);
      return new CancellableTask(Promise.resolve(undefined));
    }
    const authorKey: CubeKey = authorHint.remoteKey;

    // Let's retrieve the author
    const authorPromise: Promise<Identity> = this.retrieveIdentity(authorKey);

    // Once the author is retrieved, verify authorship
    const task: CancellableTask<Identity> = new CancellableTask(
      authorPromise.then(author => {
        if (author === undefined) {
          logger.debug(`NotificationStore.findAuthor(): Author ${keyVariants(authorKey).keyString} for notification ${notification.getKeyStringIfAvailable()} could not be retrieved; aborting.`);
          return undefined;
        }

        // Spawn the verification task
        const verifyTask: CancellableTask<boolean> =
          verifyAuthorship(postKey, author);
        // Just in case the user cancels on us, forward the cancellation.
        // Note that although the following line ostensible cancels on every
        // kind of resolution this indeed only handles the cancellation case,
        // as in the positive case the verifyTask will actually resolve first.
        task.promise.then(() => verifyTask.cancel());

        // Wait for verification
        return verifyTask.promise.then(confirmation => {
          if (confirmation) {
            return author;
          } else {
            logger.debug(`NotificationStore.findAuthor(): Author ${keyVariants(authorKey).keyString} for notification ${notification.getKeyStringIfAvailable()} could not be verified.`);
            return undefined;
          }
        });
      })
    );

    return task;
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

