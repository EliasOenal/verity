import type { CubeKey, NotificationKey } from "../core/cube/cube.definitions";

import { Cube, CubeCreateOptions } from "../core/cube/cube";
import { CubeInfo } from "../core/cube/cubeInfo";
import { CubeStore } from "../core/cube/cubeStore";
import { Veritable } from "../core/cube/veritable.definition";
import { asCubeKey } from "../core/cube/keyUtil";

import { CubeRequestOptions } from "../core/networking/cubeRetrieval/requestScheduler";

import { dummyVerityNode, VerityNodeIf, VerityNodeOptions } from "./verityNode";
import { cciCube } from "./cube/cciCube";
import { Identity } from "./identity/identity";
import { Veritum, VeritumCompileOptions } from "./veritum/veritum";
import { GetVeritumOptions, VeritumRetrievalInterface } from "./veritum/veritumRetriever";
import { MetadataEnhancedRetrieval, ResolveRelsOptions, ResolveRelsRecursiveOptions, ResolveRelsRecursiveResult, ResolveRelsResult } from "./veritum/veritumRetrievalUtil";

export interface CockpitOptions {
  identity?: Identity | (() => Identity);
}

export interface PublishVeritumOptions extends VeritumCompileOptions {
  addAsPost?: boolean;
  identity?: Identity;
}

export class Cockpit implements VeritumRetrievalInterface {
  constructor(
      public node: VerityNodeIf,
      readonly options: CockpitOptions = {},
  ) {
  }

  get cubeStore(): CubeStore { return this.node.cubeStore }

  get identity(): Identity {
    if (typeof this.options.identity === 'function') return this.options.identity();
    else return this.options.identity;
  }

  /**
   * Creates a new Veritum without publishing it;
   * it can later be published by calling publishVeritum.
   * Note that you can alternatively create and publish a Veritum in one go
   * by calling publishVeritum directly.
   */
  prepareVeritum(options: CubeCreateOptions = {}): Veritum {
    options = { ...options };  // copy options to avoid tainting passed object
    if (this.identity) {
      // TODO: Provide automatic key derivation for signed Verita.
      //   We have not decided yet whether we even want to support multi-chunk
      //   signed Verita, Github#634.
    }
    const veritum = new Veritum(options);
    return veritum;
  }

  /**
   * Publish an existing Veritum.
   **/
  publishVeritum(veritum: Veritum, options?: PublishVeritumOptions): Promise<Veritum>;
  /**
   * Create and publish a new Veritum.
   */
  publishVeritum(options: PublishVeritumOptions): Promise<Veritum>;

  // maybe TODO: Ensure Cubes have actually been synced to the network?
  publishVeritum(param1: Veritum|PublishVeritumOptions, param2: PublishVeritumOptions = {}): Promise<Veritum> {
    let veritum: Veritum;
    let options: PublishVeritumOptions;
    if (param1 instanceof Veritum) {
      options = {...param2};
      veritum = param1;
    } else {
      options = {...param1};
      veritum = this.prepareVeritum(options);
    }

    // Set default options
    options.addAsPost ??= true;
    // Use this cockpit's identity by default.
    // Besides allowing overrides, this assignment also ensures the Identity
    // cannot change while this call is in progress (Cockpit supports Identity changes).
    options.identity = this.identity;

    // maybe TODO: When encryption is enabled, auto-add self as additional recipient
    //   by default? Sculpting Verita not readable by self seems like a trap.

    // Compile the Veritum
    // TODO BUGBUG should not recompile the Veritum if already compiled (may change key!)
    return veritum.compile(options).then(() => {
      const promises: Promise<any>[] = [];
      // If the user is logged in (and did not opt out), store this as a post
      if (options.identity && options.addAsPost) {
        promises.push(
          veritum.getKey().then((key): Promise<any> => {
            options.identity.addPost(key);
            return options.identity.store();
          })
        );
      }
      // Publish the Veritum by adding all Cubes to the CubeStore
      for (const chunk of veritum.chunks) {
        promises.push(this.node.cubeStore.addCube(chunk));
      }
      // Return resolved once all chunks have been published
      return Promise.all(promises).then(() => veritum);
    });
  }

  getVeritum(
      key: CubeKey | string,
      options: {resolveRels: true, metadata?: true} & CubeRequestOptions & GetVeritumOptions & ResolveRelsOptions,
  ): Promise<ResolveRelsResult>;
  getVeritum(
      key: CubeKey | string,
      options: {resolveRels: 'recursive', metadata?: true} & CubeRequestOptions & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<ResolveRelsRecursiveResult>;
  getVeritum(
      key: CubeKey | string,
      options: {metadata: true} & CubeRequestOptions & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<MetadataEnhancedRetrieval<Veritum>>;
  getVeritum(
      key: CubeKey | string,
      options?: CubeRequestOptions & GetVeritumOptions
  ): Promise<Veritum>;
  getVeritum(
      key: CubeKey,
      options: CubeRequestOptions & GetVeritumOptions = {},
  ): Promise<Veritum|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<Veritum>> {
    const ret: Promise<Veritum|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<Veritum>> =
      this.node.veritumRetriever.getVeritum(key,
        {
          ...options,
          recipient: this.identity,
        }
    );
    return ret;
  }


  // Pass-through method to implement CubeRetrievalInterface
  getCubeInfo(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.node.veritumRetriever.getCubeInfo(keyInput);
  }
  // Pass-through method to implement CubeRetrievalInterface --
  // TODO: implement enhancement features like auto-decrypt
  getCube<cubeClass extends Cube = cciCube>(
    key: CubeKey | string,
    options: {resolveRels: true, metadata?: true} & GetVeritumOptions & ResolveRelsOptions,
  ): Promise<ResolveRelsResult>;
  getCube<cubeClass extends Cube = cciCube>(
      key: CubeKey | string,
      options: {resolveRels: 'recursive', metadata?: true} & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<ResolveRelsRecursiveResult>;
  getCube<cubeClass extends Cube = cciCube>(
    key: CubeKey | string,
    options: {metadata: true} & GetVeritumOptions & ResolveRelsRecursiveOptions,
  ): Promise<MetadataEnhancedRetrieval<Cube>>;
  getCube<cubeClass extends Cube = cciCube>(
      key: CubeKey | string,
      options?: GetVeritumOptions
  ): Promise<cubeClass>;
  getCube<cubeClass extends Cube = cciCube>(
      key: CubeKey | string,
      options?: CubeRequestOptions,
  ): Promise<cubeClass|ResolveRelsResult|ResolveRelsRecursiveResult|MetadataEnhancedRetrieval<Cube>> {
    return this.node.veritumRetriever.getCube(key, options);
  }
  // Pass-through method to implement CubeRetrievalInterface
  expectCube(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.node.cubeStore.expectCube(asCubeKey(keyInput));
  }
  // Pass-through method to implement CubeRetrievalInterface --
  // TODO: implement enhancement features like auto-decrypt
  getNotifications(recipientKey: NotificationKey | string): AsyncGenerator<Veritable> {
    return this.node.veritumRetriever.getNotifications(recipientKey);
  }

}

/**
 * For testing only:
 * Assemble a dummy Cockpit, i.e. one based on a node with a DummyNetworkManager.
 */
export function dummyCockpit(options: CockpitOptions|VerityNodeOptions = {}): Cockpit {
  const node = dummyVerityNode(options as VerityNodeOptions);
  return new Cockpit(node, options as CockpitOptions);
}
