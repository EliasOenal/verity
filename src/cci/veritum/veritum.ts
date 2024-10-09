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
import { Continuation, RecombineOptions, SplitOptions, SplitState } from "./continuation";
import { CciEncryptionParams, Encrypt, EncryptionOverheadBytes, EncryptionRecipients, CryptStateOutput, EncryptionPrepareParams, EncryptionHashNonces, EncryptPrePlanned, EncryptionHashNonce } from "./encryption";
import { CciDecryptionParams, Decrypt } from "./decryption";

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo';
import { logger } from "../../core/logger";

export interface VeritumCompileOptions extends CubeCreateOptions, CciEncryptionParams {
}

export interface VeritumFromChunksOptions extends RecombineOptions, CciDecryptionParams {
}

export class Veritum extends VeritableBaseImplementation implements Veritable{
  protected _compiled: Array<cciCube>;
  get compiled(): Iterable<cciCube> { return this._compiled }

  declare protected _fields: cciFields;

  readonly publicKey: Buffer;
  readonly privateKey: Buffer;

  static FromChunks(chunks: Iterable<cciCube>, options?: VeritumFromChunksOptions): Veritum {
    let transformedChunks: Iterable<Cube>|Cube[] = chunks;
    // If encryption was requested, attempt chunk decryption
    if (options.preSharedKey || options.recipientPrivateKey) {
      transformedChunks = [];
      let decryptParams: CciDecryptionParams = { ... options };
      // attempt chunk decryption
      for (const chunk of chunks) {
        const decryptOutput: CryptStateOutput = Decrypt(
          chunk.manipulateFields(), true, decryptParams,
        );
        if (decryptOutput?.symmetricKey !== undefined) {
          // Key agreed on first chunk will be reused on subsequent chunks
          // and a derived nonce will be used as per the spec
          decryptParams.preSharedKey = decryptOutput.symmetricKey;
          decryptParams.predefinedNonce = EncryptionHashNonce(decryptOutput.nonce);
        }
        const decryptedFields: cciFields = decryptOutput?.result;
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
    // TODO clean up encryption code, split out or something
    const shallEncrypt: boolean =
      options.senderPrivateKey !== undefined && options.recipients !== undefined;
    let encryptionSchemeParams: CciEncryptionParams = undefined;
    let continuationEncryptionParams: CciEncryptionParams = undefined;
    let spacePerCube: (chunkIndex: number) => number =
      () => NetConstants.CUBE_SIZE;
    if (shallEncrypt) {
      await sodium.ready;
      // Pre-plan the encryption scheme variant
      encryptionSchemeParams = { ...options };
      encryptionSchemeParams = EncryptionPrepareParams(encryptionSchemeParams);
      continuationEncryptionParams = {
        ...encryptionSchemeParams,
        nonce: undefined,  // to be defined per chunk below
        pubkeyHeader: false,
        nonceHeader: false,
        keyslotHeader: false,
      }
      // reserve some space for encryption overhead
      const firstChunkSpace = NetConstants.CUBE_SIZE -
        EncryptionOverheadBytes(encryptionSchemeParams);
      const continuationChunkSpace = NetConstants.CUBE_SIZE -
        EncryptionOverheadBytes(continuationEncryptionParams);
      spacePerCube = (chunkIndex: number) => {
        if (chunkIndex === 0) {
          return firstChunkSpace;
        } else {
          return continuationChunkSpace;
        }
      }
      // TODO: Reserve less space on Continuation chunks
    }
    // If encryption was requested, ask split to call us back after each
    // chunk Cube so we can encrypt it before it is finalised.
    // Let's prepare this callback.
    let nonceList: Buffer[] = [];
    const encryptCallback = (chunk: cciCube, state: SplitState) => {
      // Lazy-initialise nonce list
      if (nonceList.length < state.chunkCount) {
        nonceList = EncryptionHashNonces(
          encryptionSchemeParams.nonce, state.chunkCount);
      }
      let chunkParams: CciEncryptionParams;
      // There are two possible states:
      // - If this the first chunk (which, not that it matters but just so you
      //   know, is handled *last*), key derivation meta data goes in here
      // - If this is any other chunk, we use the symmetric session established
      //   in the first chunk, but crucially supplying a unique nonce.
      if (state.chunkIndex === 0) {
        chunkParams = encryptionSchemeParams;
      } else {
        chunkParams = {
          ...continuationEncryptionParams,
          nonce: nonceList[state.chunkIndex],
        }
      }
      // Perform chunk encryption
      const encRes: CryptStateOutput = EncryptPrePlanned(
        chunk.manipulateFields(), chunkParams);
      const encryptedFields: cciFields = encRes.result;
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
