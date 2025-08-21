import type { Veritable } from "../../core/cube/veritable.definition";

import { VeritableBaseImplementation } from "../../core/cube/cube";
import { HasSignature, type CubeKey, DEFAULT_CUBE_TYPE } from "../../core/cube/cube.definitions";
import { asCubeKey, keyVariants } from "../../core/cube/keyUtil";

import { cciCube, cciFamily } from "../cube/cciCube";
import { Relationship, RelationshipType } from "../cube/relationship";
import { VerityFields } from "../cube/verityFields";
import { Split, Recombine } from "./continuation";
import { SplitOptions, ChunkFinalisationState } from "./veritum.definitions";
import { ChunkDecrypt, ChunkEncryptionHelper } from "./veritumEncryption";

import { logger } from "../../core/logger";

import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo';
import { VeritumCreateOptions, VeritumFromChunksOptions, VeritumCompileOptions } from "./veritum.definitions";

// TODO: Provide an own configurable equals() method with sensible defaults
//   to allow semantic comparisons between Verita as well as between Verita
//   and Cubes.

export class Veritum extends VeritableBaseImplementation implements Veritable{
  private _chunks: cciCube[];
  get chunks(): Iterable<cciCube> { return this._chunks }

  declare options: VeritumCreateOptions;

  get publicKey(): Buffer { return this.options.publicKey }
  get privateKey(): Buffer { return this.options.privateKey }

  private _keyChunkNo: number = 0;
  /**
   * For encrypted Verita, this is the amount of encryption key chunks used.
   * You will probably not need this.
   **/
  get keyChunkNo(): number { return this._keyChunkNo }
  private recipientKeyChunkMap: Map<string, cciCube> = new Map();

  static FromChunks(chunks: Iterable<cciCube>, options?: VeritumFromChunksOptions): Veritum {
    // If decryption was requested, let's decrypt the chunks before recombining.
    // Will not get in our way if decryption was not requested.
    let transformedChunks: Iterable<cciCube> = ChunkDecrypt(chunks, options);
    const recombined: Veritum = Recombine(transformedChunks, options);
    // In case of an encrypted Veritum, the original chunks rather than the
    // transformed (decrypted) chunks should be retained. In case of non-signed
    // Verita, this defined the Veritum's key.
    if (recombined) {
      // note that recombined could be undefined if its chunks could not be recombined
      recombined._chunks = Array.from(chunks);
    }
    return recombined;
  }

  /**
   * Static Create method is currently just a wrapper around the Constructor
   * to provide a Cube-compatible API.
   **/
  static Create(options?: VeritumCreateOptions): Veritum;
  static Create(copyFrom: Veritum): Veritum;
  static Create(param1: VeritumCreateOptions|Veritum = {}): Veritum {
    return new Veritum(param1);
  }

  constructor(options?: VeritumCreateOptions);
  constructor(copyFrom: Veritum);
  constructor(param1: VeritumCreateOptions|Veritum);
  constructor(param1: VeritumCreateOptions|Veritum = {}) {
    if (param1 instanceof Veritum) {
      // copy constructor
      const copyFrom: Veritum = param1;
      const options = {
        // We'll keep the original's options
        ...copyFrom.options,
        // but we'll make a shallow copy of its fields object.
        fields: new VerityFields(copyFrom._fields, copyFrom._fields.fieldDefinition),
      }
      super({...options, cubeType: copyFrom.cubeType});
      this._chunks = copyFrom._chunks ?? [];
    } else {
      // creating new Veritum
      const options: VeritumCreateOptions = param1;
      options.family ??= cciFamily;
      options.cubeType ??= DEFAULT_CUBE_TYPE;
      super(options);
      this._chunks = this.options.chunks ?? [];
    }
  }

  /**
   * Note: If this is an encrypted Veritum to a large number of recipients,
   * this Veritum will have different keys for different groups of recipients.
   * This method will always just return the first chunk key, which is not
   * appropriate for all recipients.
   */
  getKeyIfAvailable(): CubeKey {
    if (HasSignature[this.cubeType]) return asCubeKey(this.publicKey);
    else return this._chunks[0]?.getKeyIfAvailable();
  }
  getKeyStringIfAvailable(): string {
    const key: CubeKey = this.getKeyIfAvailable();
    return keyVariants(key)?.keyString;
  }
  async getKey(): Promise<CubeKey> {
    if (this.getKeyIfAvailable()) return this.getKeyIfAvailable();
    if (this._chunks[0] === undefined) await this.compile();
    return this._chunks[0]?.getKey();
  }
  async getKeyString(): Promise<string> {
    const key: CubeKey = await this.getKey();
    return keyVariants(key)?.keyString;
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
      if (this._chunks[i] === undefined) {
        logger.trace(`Veritum.getAllKeys: chunk key ${i} not available, aborting.`);
        return;
      }
      yield this._chunks[i]?.getKeyIfAvailable();
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
    for (let i=this.keyChunkNo; i<this._chunks.length; i++) {
      yield this._chunks[i];
    }
  }

  async compile(optionsInput: VeritumCompileOptions = {}): Promise<Iterable<cciCube>> {
    await sodium.ready;  // needed in case of encrypted Verita
    const options: VeritumCompileOptions = {
      ...this.options,
      ...optionsInput,
    }
    // Prepare an encryption helper in case encryption is requested
    // (it will not get in the way otherwise)
    const encryptionHelper = new ChunkEncryptionHelper(this, options);

    // Feed this Veritum through the splitter -- this is the main operation
    // of compiling a Veritum.
    const splitOptions: SplitOptions = {
      cubeType: this.cubeType,
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      requiredDifficulty: this.requiredDifficulty,
      maxChunkSize: (chunkIndex: number) =>
        encryptionHelper.spacePerChunk(chunkIndex),
      chunkTransformationCallback: (chunk: cciCube, splitState: ChunkFinalisationState) =>
        encryptionHelper.transformChunk(chunk, splitState),
    }
    this._chunks = await Split(this, splitOptions);

    // In case of encryption, adopt some metadata from the encryption helper
    this._keyChunkNo = encryptionHelper.keyChunkNo;
    this.recipientKeyChunkMap = encryptionHelper.recipientKeyChunkMap;

    // If this was encrypted to many recipients we may need to add some
    // supplementary key distribution chunks at the beginning
    if (encryptionHelper.supplementaryKeyChunks.length > 0) {
      this._chunks.splice(1, 0,
        ...encryptionHelper.supplementaryKeyChunks);
      // Compile all supplementary key distribution chunks so that we're
      // guaranteed to know their keys.
      for (const chunk of encryptionHelper.supplementaryKeyChunks) {
        await chunk.compile();  // TODO: parallelise
      }
    }
    return this._chunks;
  }

  // Note: The following two methods have been copied from cciCube.
  //   That's not perfectly DRY, but come on, they're single line methods.
  getRelationships(type?: RelationshipType): Array<Relationship> {
    return this._fields.getRelationships(type);
  }
  public getFirstRelationship(type?: number): Relationship {
    return this._fields.getFirstRelationship(type);
  }


}
