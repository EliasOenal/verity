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
    await sodium.ready;  // needed in case of encrypted Verita
    // Prepare an encryption helper in case encryption is requested
    // (it will not get in the way otherwise)
    const encryptionHelper = new ChunkEncryptionHelper(options);
    // Feed this Veritum through the splitter -- this is the main operation
    // of compiling a Veritum.
    const splitOptions: SplitOptions = {
      maxChunkSize: (chunkIndex: number) =>
        encryptionHelper.spacePerChunk(chunkIndex),
      chunkTransformationCallback: (chunk: cciCube, splitState: SplitState) =>
        encryptionHelper.transformChunk(chunk, splitState),
    }
    this._compiled = await Continuation.Split(this, splitOptions);
    return this._compiled;
  }

}


class ChunkEncryptionHelper {
  readonly shallEncrypt: boolean;

  private encryptionSchemeParams: CciEncryptionParams;
  private continuationEncryptionParams: CciEncryptionParams;
  private firstChunkSpace: number;
  private continuationChunkSpace: number;
  private nonceList: Buffer[] = [];

  constructor(readonly options: VeritumCompileOptions) {
    // First, let's find out if the user did even request encryption
    this.shallEncrypt = this.options.senderPrivateKey !== undefined &&
                        this.options.recipients !== undefined;
    if (this.shallEncrypt) {
      // Pre-plan the encryption scheme variant
      this.encryptionSchemeParams = { ...options };  // copy input opts
      this.encryptionSchemeParams =  // run scheme planner
        EncryptionPrepareParams(this.encryptionSchemeParams);
      this.continuationEncryptionParams = {  // prepare continuation variant
        ...this.encryptionSchemeParams,
        nonce: undefined,  // to be defined per chunk below
        pubkeyHeader: false,
        nonceHeader: false,
        keyslotHeader: false,
      }
      // reserve some space for encryption overhead
      this.firstChunkSpace = NetConstants.CUBE_SIZE -
        EncryptionOverheadBytes(this.encryptionSchemeParams);
      this.continuationChunkSpace = NetConstants.CUBE_SIZE -
        EncryptionOverheadBytes(this.continuationEncryptionParams);
      }
    }

  spacePerChunk(chunkIndex: number) {
    if (this.shallEncrypt) {
      if (chunkIndex === 0) {
        return this.firstChunkSpace;
      } else {
        return this.continuationChunkSpace;
      }
    }
    else return NetConstants.CUBE_SIZE;
  }

  transformChunk(chunk: cciCube, state: SplitState) {
    if (this.shallEncrypt) {  // only act if encryption requested
      // Lazy-initialise nonce list
      if (this.nonceList.length < state.chunkCount) {
        this.nonceList = EncryptionHashNonces(
          this.encryptionSchemeParams.nonce, state.chunkCount);
      }
      let chunkParams: CciEncryptionParams;
      // There are two possible states:
      // - If this the first chunk (which, not that it matters but just so you
      //   know, is handled *last*), key derivation meta data goes in here
      // - If this is any other chunk, we use the symmetric session established
      //   in the first chunk, but crucially supplying a unique nonce.
      if (state.chunkIndex === 0) {
        chunkParams = this.encryptionSchemeParams;
      } else {
        chunkParams = {
          ...this.continuationEncryptionParams,
          nonce: this.nonceList[state.chunkIndex],
        }
      }
      // Perform chunk encryption
      const encRes: CryptStateOutput = EncryptPrePlanned(
        chunk.manipulateFields(), chunkParams);
      const encryptedFields: cciFields = encRes.result;
      chunk.setFields(encryptedFields);
    }
  }
}
