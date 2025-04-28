import { CubeCreateOptions } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cube.definitions";
import { ArrayFromAsync } from "../core/helpers/misc";
import { VerityNodeIf } from "./verityNode";
import { cciCube } from "./cube/cciCube";
import { Identity } from "./identity/identity";
import { Veritum, VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum/veritum";
import { GetVeritumOptions } from "./veritum/veritumRetriever";

import { Buffer } from 'buffer';
import { CubeRequestOptions } from "../core/networking/cubeRetrieval/requestScheduler";
import { MetadataEnhancedRetrieval, ResolveRelsOptions, ResolveRelsRecursiveOptions, ResolveRelsRecursiveResult, ResolveRelsResult } from "./veritum/veritumRetrievalUtil";

export interface CockpitOptions {
  identity?: Identity | (() => Identity);
}

export interface PublishVeritumOptions extends VeritumCompileOptions {
  addAsPost?: boolean;
  identity?: Identity;
}

export class Cockpit {
  constructor(
      public node: VerityNodeIf,
      readonly options: CockpitOptions = {},
  ) {
  }

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
      // TODO FIXME: use key derivation rather than overwriting the Identity MUC o.Ô
      // This must probably be implemented in Continuation
      options.publicKey ??= this.identity?.publicKey;
      options.privateKey ??= this.identity?.privateKey;
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
  publishVeritum(param1: Veritum|CubeCreateOptions, param2: PublishVeritumOptions = {}): Promise<Veritum> {
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
}
