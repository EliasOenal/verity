import { CubeCreateOptions } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cube.definitions";
import { ArrayFromAsync } from "../core/helpers/misc";
import { cciNodeIf } from "./cciNode";
import { cciCube } from "./cube/cciCube";
import { Identity } from "./identity/identity";
import { Veritum, VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum/veritum";

import { Buffer } from 'buffer';

export interface cciCockpitOptions {
  identity?: Identity;
}

export interface GetVeritumOptions {
  /**
   * Automatically attempt to decrypt the Veritum if decrypted
   * @default true
   */
  autoDecrypt?: boolean,
}

export class cciCockpit {
  constructor(
      public node: cciNodeIf,
      readonly options: cciCockpitOptions = {},
  ) {
  }

  get identity(): Identity { return this.options.identity }

  // maybe TODO: set a default CubeType? PIC maybe?
  makeVeritum(options: CubeCreateOptions = {}): Veritum {
    options = { ...options };  // copy options to avoid tainting passed object
    if (this.identity) {
      options.publicKey ??= this.identity?.publicKey;
      options.privateKey ??= this.identity?.privateKey;
    }
    const veritum = new Veritum(options);
    return veritum;
  }

  // maybe TODO: Ensure Cubes have actually been synced to the network?
  publishVeritum(veritum: Veritum, options?: VeritumCompileOptions): Promise<void> {
    return new Promise<void>(resolve => {
      veritum.compile({
        ...options,
        senderPrivateKey: options?.senderPrivateKey ?? this.identity?.encryptionPrivateKey,
        senderPubkey: options?.senderPubkey ?? this.identity?.encryptionPublicKey,
      }).then(() => {
        const promises: Promise<any>[] = [];
        for (const chunk of veritum.chunks) {
          promises.push(this.node.cubeStore.addCube(chunk));
        }
        Promise.all(promises).then(() => resolve());
      });
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
