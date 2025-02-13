import { CubeCreateOptions } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cube.definitions";
import { ArrayFromAsync } from "../core/helpers/misc";
import { VerityNodeIf } from "./verityNode";
import { cciCube } from "./cube/cciCube";
import { Identity } from "./identity/identity";
import { Veritum, VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum/veritum";

import { Buffer } from 'buffer';

export interface CockpitOptions {
  identity?: Identity | (() => Identity);
}

export interface PublishVeritumOptions extends VeritumCompileOptions {
  addAsPost?: boolean;
  identity?: Identity;
}

export interface GetVeritumOptions {
  /**
   * Automatically attempt to decrypt the Veritum if decrypted
   * @default true
   */
  autoDecrypt?: boolean,
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
      veritum = param1;
      options = param2;
    } else {
      veritum = this.prepareVeritum(param1);
      options = param1;
    }

    // Set default options
    options.addAsPost ??= true;
    // Use this cockpit's identity by default.
    // Besides allowing overrides, this assignment also ensures the Identity
    // cannot change while this call is in progress (Cockpit supports Identity changes).
    options.identity = this.identity;

    // Compile the Veritum
    return veritum.compile({
      ...options,
      senderPrivateKey: options?.senderPrivateKey ?? options.identity?.encryptionPrivateKey,
      senderPubkey: options?.senderPubkey ?? options.identity?.encryptionPublicKey,
    }).then(() => {
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

  async getVeritum(
      key: CubeKey,
      options: GetVeritumOptions = {},
  ): Promise<Veritum> {
    // set default options
    options = { ...options };  // copy options to avoid tainting passed object
    options.autoDecrypt ??= true;
    // retrieve chunks
    const chunkGen: AsyncGenerator<cciCube> =
      this.node.veritumRetriever.getContinuationChunks(key);
    // maybe TODO: get rid of ugly Array conversion?
    const chunks: Iterable<cciCube> = await ArrayFromAsync(chunkGen);
    // If auto-decryption was requested, prepare the necessary params
    // for decryption
    let fromChunksOptions: VeritumFromChunksOptions;
    if (options.autoDecrypt) {
      fromChunksOptions = {
        recipientPrivateKey: this.identity?.encryptionPrivateKey,
      };
    } else {
      fromChunksOptions = undefined;
    }
    // Decompile the Veritum
    const veritum = Veritum.FromChunks(chunks, fromChunksOptions);
    return veritum;
  }
}
