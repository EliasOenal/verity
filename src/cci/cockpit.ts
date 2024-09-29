import { CubeCreateOptions } from "../core/cube/cube";
import { CubeKey, CubeType } from "../core/cube/cube.definitions";
import { ArrayFromAsync, isIterableButNotBuffer } from "../core/helpers/misc";
import { VerityNodeIf } from "../core/verityNode";
import { cciCube } from "./cube/cciCube";
import { Identity } from "./identity/identity";
import { Continuation } from "./veritum/continuation";
import { Veritum } from "./veritum/veritum";

import { Buffer } from 'buffer';

export interface MakeVeritumOptions extends CubeCreateOptions {
  /**
   * To automatically encrypt a Veritum only intended for a specific recipient
   * or list of recipients, supply their Identities or encryption public keys here.
   */
  recipient?: Identity|Iterable<Identity>|Buffer|Iterable<Buffer>,
}

export interface GetVeritumOptions {
  /**
   * Automatically attempt to decrypt the Veritum if decrypted
   * @default true
   */
  autoDecrypt?: boolean,

  /**
   * For decryption, the sender's public key must either be included in the
   * encrypted Veritum or be supplied here.
   * In case of conflict the key supplied here takes precedence.
   */
  senderPublicKey?: Buffer,
}

export class cciCockpit {
  constructor(
      public node: VerityNodeIf,
      public identity: Identity,
  ) {
  }

  // maybe TODO: set a default CubeType? PIC maybe?
  makeVeritum(cubeType: CubeType, options: MakeVeritumOptions = {}): Veritum {
    options = { ...options };  // copy options to avoid tainting passed object
    if (this.identity) {
      options.publicKey ??= this.identity.publicKey;
      options.privateKey ??= this.identity.privateKey;
    }
    const veritum = new Veritum(cubeType, options);
    if (options.recipient) {
      veritum.encrypt(this.identity.encryptionPrivateKey, options.recipient);
    }
    return veritum;
  }

  // maybe TODO: Ensure Cubes have actually been synced to the network?
  publishVeritum(veritum: Veritum): Promise<void> {
    return new Promise<void>(resolve => {
      veritum.compile().then(() => {
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
    // recombine Veritum
    const veritum = Continuation.Recombine(chunks);
    // attempt decryption if requested
    if (this.identity && options.autoDecrypt) {
      veritum.decrypt(this.identity.encryptionPrivateKey, options.senderPublicKey);
    }
    return veritum;
  }
}
