import { CubeCreateOptions } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cube.definitions";
import { ArrayFromAsync, isIterableButNotBuffer } from "../core/helpers/misc";
import { VerityNodeIf } from "../core/verityNode";
import { cciCube } from "./cube/cciCube";
import { Identity } from "./identity/identity";
import { Continuation } from "./veritum/continuation";
import { Veritum, VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum/veritum";

import { Buffer } from 'buffer';

export interface GetVeritumOptions {
  /**
   * Automatically attempt to decrypt the Veritum if decrypted
   * @default true
   */
  autoDecrypt?: boolean,
}

export class cciCockpit {
  constructor(
      public node: VerityNodeIf,
      public identity: Identity,
  ) {
  }

  // maybe TODO: set a default CubeType? PIC maybe?
  makeVeritum(cubeType: CubeType, options: CubeCreateOptions = {}): Veritum {
    options = { ...options };  // copy options to avoid tainting passed object
    if (this.identity) {
      options.publicKey ??= this.identity.publicKey;
      options.privateKey ??= this.identity.privateKey;
    }
    const veritum = new Veritum(cubeType, options);
    return veritum;
  }

  // maybe TODO: Ensure Cubes have actually been synced to the network?
  publishVeritum(veritum: Veritum, options?: VeritumCompileOptions): Promise<void> {
    return new Promise<void>(resolve => {
      veritum.compile({
        ...options,
        encryptionPrivateKey: options?.encryptionPrivateKey ?? this.identity.encryptionPrivateKey,
        includeSenderPubkey: options?.includeSenderPubkey ?? this.identity.encryptionPublicKey,
      }).then(() => {
        const promises: Promise<any>[] = [];
        for (const cube of veritum.compiled) {
          promises.push(this.node.cubeStore.addCube(cube));
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
      this.node.cubeRetriever.getContinuationChunks(key);
    // maybe TODO: get rid of ugly Array conversion?
    const chunks: Iterable<cciCube> = await ArrayFromAsync(chunkGen);
    // If auto-decryption was requested, prepare the necessary params
    // for decryption
    let fromChunksOptions: VeritumFromChunksOptions;
    if (options.autoDecrypt) {
      fromChunksOptions = {
        encryptionPrivateKey: this.identity?.encryptionPrivateKey,
      };
    } else {
      fromChunksOptions = undefined;
    }
    // Decompile the Veritum
    const veritum = Veritum.FromChunks(chunks, fromChunksOptions);
    return veritum;
  }
}
