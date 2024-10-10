import type { Veritable } from "../../core/cube/veritable.definition";
import type { CciEncryptionParams, CryptStateOutput, EncryptionHashNonce } from "./chunkEncryption";

import { Cube, CubeCreateOptions, VeritableBaseImplementation } from "../../core/cube/cube";
import { HasSignature, type CubeKey, CubeType } from "../../core/cube/cube.definitions";
import { keyVariants } from "../../core/cube/cubeUtil";
import { ApiMisuseError } from "../../core/settings";

import { cciCube, cciFamily } from "../cube/cciCube";
import { cciFields } from "../cube/cciFields";
import { Continuation, RecombineOptions, SplitOptions, SplitState } from "./continuation";
import { CciDecryptionParams, Decrypt } from "./chunkDecryption";
import { ChunkDecrypt, ChunkEncryptionHelper } from "./veritumEncryption";

import { logger } from "../../core/logger";

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo';

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
    // If decryption was requested, let's decrypt the chunks before recombining.
    // Will not get in our way if decryption was not requested.
    let transformedChunks: Iterable<Cube>|Cube[] = ChunkDecrypt(chunks, options);
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
