import { Cube, CubeCreateOptions, VeritableBaseImplementation } from "../../core/cube/cube";
import { HasSignature, type CubeKey, CubeType } from "../../core/cube/cube.definitions";
import { keyVariants } from "../../core/cube/cubeUtil";
import type { Veritable } from "../../core/cube/veritable.definition";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { ApiMisuseError } from "../../core/settings";
import { cciCube, cciFamily } from "../cube/cciCube";
import { cciFieldLength, cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields } from "../cube/cciFields";
import { Continuation, RecombineOptions, SplitOptions } from "./continuation";
import { CciEncryptionParams, Encrypt, EncryptionOverheadBytes, EncryptionRecipients } from "./encryption";
import { Decrypt } from "./decryption";

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo';
import { logger } from "../../core/logger";

export interface VeritumCompileOptions extends CubeCreateOptions, CciEncryptionParams {
  /**
   * To encrypt a Veritum on compilation, supply your encryption private key here.
   * Don't forget to also supply the recipient or list of recipients.
   */
  encryptionPrivateKey?: Buffer,

  /**
   * To automatically encrypt a Veritum only intended for a specific recipient
   * or list of recipients, supply their Identities or encryption public keys here.
   * Don't forget to also supply the encryptionPrivateKey.
   */
  encryptionRecipients?: EncryptionRecipients,
}

export interface VeritumFromChunksOptions extends RecombineOptions {
  encryptionPrivateKey?: Buffer,
}

export class Veritum extends VeritableBaseImplementation implements Veritable{
  protected _compiled: Array<cciCube>;
  get compiled(): Iterable<cciCube> { return this._compiled }

  declare protected _fields: cciFields;

  readonly publicKey: Buffer;
  readonly privateKey: Buffer;

  static FromChunks(chunks: Iterable<cciCube>, options?: VeritumFromChunksOptions): Veritum {
    let transformedChunks: Iterable<Cube>|Cube[] = chunks;
    if (options.encryptionPrivateKey) {
      transformedChunks = [];
      // attempt chunk decryption
      for (const chunk of chunks) {
        const decryptedFields = Decrypt(
          chunk.manipulateFields(),
          {recipientPrivateKey: options.encryptionPrivateKey},
        );
        if (decryptedFields) {
          const decryptedChunk = new chunk.family.cubeClass(
          chunk.cubeType, {
            family: chunk.family,
            fields: decryptedFields,
            requiredDifficulty: 0,  // not to be published
          });
          (transformedChunks as Cube[]).push(decryptedChunk);
        } else {
          logger.trace(`Veritum.FromChunks(): Failed to decrypt chunk ${chunk.getKeyStringIfAvailable()}`);
          (transformedChunks as Cube[]).push(chunk);
        }
      }
    }
    return Continuation.Recombine(transformedChunks, options);
  }

  constructor(cubeType: CubeType, options?: CubeCreateOptions);
  constructor(copyFrom: Veritum);

  constructor(param1: CubeType|Veritum, options: CubeCreateOptions = {}) {
    if (param1 instanceof Veritum) {
      // copy constructor
      const copyFrom: Veritum = param1;
      options = {
        family: copyFrom.family,
        fields: new cciFields(copyFrom._fields, copyFrom._fields.fieldDefinition),  // shallow copy
        privateKey: copyFrom.privateKey,
        publicKey: copyFrom.publicKey,
        requiredDifficulty: copyFrom.requiredDifficulty,
      }
      super(copyFrom.cubeType, options);
    } else if (Object.values(CubeType).includes(param1 as number)) {
      // creating new Veritum
      const cubeType = param1 as CubeType;
      options.family ??= cciFamily;
      super(cubeType, options);
      this.publicKey = options.publicKey;
      this.privateKey = options.privateKey;
    } else {
      throw new ApiMisuseError("Veritum constructor: unknown first parameter");
    }
  }

  getKeyIfAvailable(): CubeKey {
    if (HasSignature[this.cubeType]) return this.publicKey;
    else return this._compiled?.[0]?.getKeyIfAvailable();
  }
  getKeyStringIfAvailable(): string {
    if (HasSignature[this.cubeType]) return keyVariants(this.publicKey).keyString;
    else return this._compiled?.[0]?.getKeyStringIfAvailable();
  }

  async compile(options: VeritumCompileOptions = {}): Promise<Iterable<cciCube>> {
    // Did the user request encryption?
    // If so, we need to reserve some space for crypto overhead.
    const shallEncrypt: boolean =
      options.encryptionPrivateKey !== undefined && options.encryptionRecipients !== undefined;
    let encryptionOptions: CciEncryptionParams;
    let spacePerCube = NetConstants.CUBE_SIZE;
    if (shallEncrypt) {
      await sodium.ready;
      encryptionOptions = {
        senderPrivateKey: options.encryptionPrivateKey,
        recipients: options.encryptionRecipients,
        includeSenderPubkey: options.includeSenderPubkey,
        excludeFromEncryption: options.excludeFromEncryption,
      }
      // reserve some space for encryption overhead
      spacePerCube = spacePerCube - EncryptionOverheadBytes(encryptionOptions);
      // TODO: Reserve less space on Continuation chunks
    }
    // If encryption was requested, ask split to call us back after each
    // chunk Cube so we can encrypt it before it is finalised.
    // Let's prepare this callback.
    const encryptCallback = (chunk: cciCube) => {
      const encryptedFields: cciFields = Encrypt(
        chunk.manipulateFields(), encryptionOptions);
      chunk.setFields(encryptedFields);
    }
    // Feed this Veritum through the splitter -- this is the main operation
    // of compiling a Veritum.
    const splitOptions: SplitOptions = {
      maxChunkSize: spacePerCube,
      chunkTransformationCallback: shallEncrypt ? encryptCallback : undefined,
    }
    this._compiled = await Continuation.Split(this, splitOptions);
    return this._compiled;
  }

}
