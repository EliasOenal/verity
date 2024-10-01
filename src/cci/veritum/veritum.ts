import { CubeCreateOptions, VeritableBaseImplementation } from "../../core/cube/cube";
import { HasSignature, type CubeKey, CubeType } from "../../core/cube/cube.definitions";
import { keyVariants } from "../../core/cube/cubeUtil";
import type { Veritable } from "../../core/cube/veritable.definition";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { ApiMisuseError } from "../../core/settings";
import { cciCube, cciFamily } from "../cube/cciCube";
import { cciFieldLength, cciFieldType } from "../cube/cciCube.definitions";
import { cciFields } from "../cube/cciFields";
import { Continuation, RecombineOptions, SplitOptions } from "./continuation";
import { CciEncryptionOptions, Decrypt, Encrypt, EncryptionRecipients } from "./encryption";

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo';

export interface VeritumCompileOptions extends CubeCreateOptions, CciEncryptionOptions {
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

export class Veritum extends VeritableBaseImplementation implements Veritable{
  protected _compiled: Array<cciCube>;
  get compiled(): Iterable<cciCube> { return this._compiled }

  declare protected _fields: cciFields;

  readonly publicKey: Buffer;
  readonly privateKey: Buffer;

  static FromChunks(chunks: Iterable<cciCube>, options?: RecombineOptions): Veritum {
    return Continuation.Recombine(chunks, options);
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

  decrypt(privateKey: Buffer, senderPublicKey?: Buffer): void {
    this._fields = Decrypt(this._fields, privateKey, senderPublicKey);
  }

  async compile(options: VeritumCompileOptions = {}): Promise<Iterable<cciCube>> {
    // Did the user request encryption?
    // If so, we need to reserve some space for crypto overhead.
    const shallEncrypt: boolean =
      options.encryptionPrivateKey !== undefined && options.encryptionRecipients !== undefined;
    let spacePerCube = NetConstants.CUBE_SIZE;
    if (shallEncrypt) {
      await sodium.ready;
      // reserve some space for additional headers, the MAC as well as the nonce
      const encryptedHeaderSize = this.fieldParser.getFieldHeaderLength(cciFieldType.ENCRYPTED);
      const nonceHeaderSize = this.fieldParser.getFieldHeaderLength(cciFieldType.CRYPTO_NONCE);
      const nonceSize = cciFieldLength[cciFieldType.CRYPTO_NONCE];
      const macSize = sodium.crypto_secretbox_MACBYTES;
      spacePerCube = spacePerCube - encryptedHeaderSize - nonceHeaderSize - nonceSize - macSize;
      // obviously, more reserved space is needed if we want to include
      // the sender's public key
      if (options.includeSenderPubkey !== undefined) {
        const pubkeyHeaderSize = this.fieldParser.getFieldHeaderLength(cciFieldType.CRYPTO_PUBKEY);
        const pubkeySize = cciFieldLength[cciFieldType.CRYPTO_PUBKEY];
        spacePerCube = spacePerCube - pubkeyHeaderSize - pubkeySize;
      }
    }
    // If encryption was requested, ask split to call us back after each
    // chunk Cube so we can encrypt it before it is finalised.
    // Let's prepare this callback.
    const encryptCallback = (chunk: cciCube) => {
      const encryptedFields = Encrypt(chunk.manipulateFields(),
        options.encryptionPrivateKey, options.encryptionRecipients, options);
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
