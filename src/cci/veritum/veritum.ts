import type { Veritable } from "../../core/cube/veritable.definition";
import type { CciEncryptionParams, CryptStateOutput, EncryptionHashNonce } from "./chunkEncryption";

import { Cube, CubeCreateOptions, VeritableBaseImplementation } from "../../core/cube/cube";
import { HasSignature, type CubeKey, CubeType, DEFAULT_CUBE_TYPE } from "../../core/cube/cube.definitions";
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

  private _keyChunkNo: number = 0;
  get keyChunkNo(): number { return this._keyChunkNo }
  private recipientKeyChunkMap: Map<string, cciCube> = new Map();

  static FromChunks(chunks: Iterable<cciCube>, options?: VeritumFromChunksOptions): Veritum {
    // If decryption was requested, let's decrypt the chunks before recombining.
    // Will not get in our way if decryption was not requested.
    let transformedChunks: Iterable<Cube>|Cube[] = ChunkDecrypt(chunks, options);
    return Continuation.Recombine(transformedChunks, options);
  }

  /**
   * Static Create method is currently just a wrapper around the Constructor
   * to provide a Cube-compatible API.
   **/
  static Create(options?: CubeCreateOptions): Veritum;
  static Create(copyFrom: Veritum): Veritum;
  static Create(param1: CubeCreateOptions|Veritum = {}): Veritum {
    return new Veritum(param1);
  }

  constructor(options?: CubeCreateOptions);
  constructor(copyFrom: Veritum);

  constructor(param1: CubeCreateOptions|Veritum = {}) {
    if (param1 instanceof Veritum) {
      // copy constructor
      const copyFrom: Veritum = param1;
      const options = {
        family: copyFrom.family,
        fields: new cciFields(copyFrom._fields, copyFrom._fields.fieldDefinition),  // shallow copy
        privateKey: copyFrom.privateKey,
        publicKey: copyFrom.publicKey,
        requiredDifficulty: copyFrom.requiredDifficulty,
      }
      super(copyFrom.cubeType, options);
    } else {
      // creating new Veritum
      const options: CubeCreateOptions = param1;
      options.family ??= cciFamily;
      options.cubeType ??= DEFAULT_CUBE_TYPE;
      super(options.cubeType, options);
      this.publicKey = options.publicKey;
      this.privateKey = options.privateKey;
    }
  }

  /**
   * Note: If this is an encrypted Veritum to a large number of recipients,
   * this Veritum will have different keys for different groups of recipients.
   * This method will always just return the first chunk key, which is not
   * appropriate for all recipients.
   */
  getKeyIfAvailable(): CubeKey {
    if (HasSignature[this.cubeType]) return this.publicKey;
    else return this._compiled?.[0]?.getKeyIfAvailable();
  }
  getKeyStringIfAvailable(): string {
    if (HasSignature[this.cubeType]) return keyVariants(this.publicKey)?.keyString;
    else return this._compiled?.[0]?.getKeyStringIfAvailable();
  }
  async getKey(): Promise<CubeKey> {
    if (this.getKeyIfAvailable()) return this.getKeyIfAvailable();
    if (this._compiled?.[0] === undefined) await this.compile();
    return this.getKeyIfAvailable();
  }
  async getKeyString(): Promise<string> {
    if (this.getKeyStringIfAvailable()) return this.getKeyStringIfAvailable();
    if (this._compiled?.[0] === undefined) await this.compile();
    return this.getKeyStringIfAvailable();
  }

  /**
   * A Veritum usually has a single key. There's however one special case where
   * it can have multiple keys: if it's encrypted to many recipients.
   * In that case, different groups of recipients will know this Veritum
   * using different keys.
   * This method will return all of this Veritum's keys.
   * Note that this is not the same as "all chunk's keys" -- there are usually
   * still more Chunk keys than Veritum keys even in this special case.
   * Also note that even though this method does not feature "IfAvailable" in
   * it's name, it will still only return available keys, which usually means
   * the Veritum need to be compile()d first.
   */
  *getAllKeys(): Generator<CubeKey> {
    for (let i=0; i<this.keyChunkNo; i++) {
      if (this._compiled[i] === undefined) {
        logger.trace(`Veritum.getAllKeys: chunk key ${i} not available, aborting.`);
        return;
      }
      yield this._compiled?.[i]?.getKeyIfAvailable();
    }
  }
  /** String based variant of getAllKeys(), see there. */
  *getAllKeyString(): Generator<string> {
    for (const key of this.getAllKeys()) {
      yield keyVariants(key).keyString;
    }
  }
  getRecipientKeyChunk(recipientInput: Buffer|string): cciCube {
    const recipient: string = keyVariants(recipientInput).keyString;
    return this.recipientKeyChunkMap.get(recipient);
  };
  /**
   * Returns the list of chunks in this Veritum for the given recipient,
   * i.e. only including the key chunk intended for this recipient.
   * This is only needed in the special case of an encrypted Veritum directed
   * to a very large number of recipient; in all other cases it will simply
   * return all chunks.
   * Note that this the Veritum must be compile()d prior to calling this method.
   */
  *getRecipientChunks(recipient: Buffer|string): Generator<cciCube> {
    const keyChunk: cciCube = this.getRecipientKeyChunk(recipient);
    if (keyChunk === undefined) return undefined;
    yield keyChunk;
    for (let i=this.keyChunkNo; i<this._compiled.length; i++) {
      yield this._compiled[i];
    }
  }

  async compile(options: VeritumCompileOptions = {}): Promise<Iterable<cciCube>> {
    await sodium.ready;  // needed in case of encrypted Verita
    // Prepare an encryption helper in case encryption is requested
    // (it will not get in the way otherwise)
    const encryptionHelper = new ChunkEncryptionHelper(this, options);

    // Feed this Veritum through the splitter -- this is the main operation
    // of compiling a Veritum.
    const splitOptions: SplitOptions = {
      maxChunkSize: (chunkIndex: number) =>
        encryptionHelper.spacePerChunk(chunkIndex),
      chunkTransformationCallback: (chunk: cciCube, splitState: SplitState) =>
        encryptionHelper.transformChunk(chunk, splitState),
    }
    this._compiled = await Continuation.Split(this, splitOptions);

    // In case of encryption, adopt some metadata from the encryption helper
    this._keyChunkNo = encryptionHelper.keyChunkNo;
    this.recipientKeyChunkMap = encryptionHelper.recipientKeyChunkMap;

    // If this was encrypted to many recipients we may need to add some
    // supplementary key distribution chunks at the beginning
    if (encryptionHelper.supplementaryKeyChunks.length > 0) {
      this._compiled.splice(1, 0,
        ...encryptionHelper.supplementaryKeyChunks);
      // Compile all supplementary key distribution chunks so that we're
      // guaranteed to know their keys.
      for (const chunk of encryptionHelper.supplementaryKeyChunks) {
        await chunk.compile();  // TODO: parallelise
      }
    }
    return this._compiled;
  }

}
