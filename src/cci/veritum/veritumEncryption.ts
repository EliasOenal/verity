import { Cube } from "../../core/cube/cube";
import { CubeType } from "../../core/cube/cube.definitions";
import { Veritable } from "../../core/cube/veritable.definition";
import { logger } from "../../core/logger";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { cciCube } from "../cube/cciCube";
import { cciFieldLength, cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields } from "../cube/cciFields";
import { CciDecryptionParams, Decrypt } from "./chunkDecryption";
import { CciEncryptionParams, EncryptionPrepareParams, EncryptionOverheadBytes, EncryptionHashNonces, CryptStateOutput, EncryptPrePlanned, EncryptionHashNonce, EncryptionOverheadBytesCalc, CryptoError, EncryptionRandomNonce } from "./chunkEncryption";
import { SplitState } from "./continuation";
import { VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum";

export class ChunkEncryptionHelper {
  readonly shallEncrypt: boolean;

  private encryptionSchemeParams: CciEncryptionParams;
  private nonceRedistributionParams: CciEncryptionParams;
  private continuationParams: CciEncryptionParams;

  private firstChunkSpace: number;
  private continuationChunkSpace: number;
  private nonceRedistSpace: number;

  private nonceList: Buffer[] = [];
  extraKeyDistributionChunks: cciCube[] = [];

  /** Number of key distribution chunks */
  private keyDistributionChunkNo: number;

  constructor(
      veritable: Veritable,
      readonly options: VeritumCompileOptions,  // TODO veritable should be able to incorporate options
  ){
    // First, let's find out if the user did even request encryption
    this.shallEncrypt = this.options.senderPrivateKey !== undefined &&
                        this.options.recipients !== undefined;
    if (this.shallEncrypt) {
      // Figure out which variant of CCI encryption we will use
      this.planEncryptionScheme();
      // Reserve some space for encryption overhead.
      this.planChunks(veritable);
      }
    }

  spacePerChunk(chunkIndex: number): number {
    if (this.shallEncrypt) {
      if (chunkIndex === 0) {
        return this.firstChunkSpace;
      } else if (chunkIndex === 1 && this.needNonceRedist === true ) {
        return this.nonceRedistSpace;
      } else {
        return this.continuationChunkSpace;
      }
    }
    else return NetConstants.CUBE_SIZE;
  }

  transformChunk(chunk: cciCube, state: SplitState): void {
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
        // TODO allow for multiple key distribution chunks, i.e. transform
        // a single chunkIndex===0 chunk to multiple chunks
      } else if (state.chunkIndex === 1 && this.needNonceRedist === true) {
        chunkParams = this.nonceRedistributionParams;
      } else {
        chunkParams = {
          ...this.continuationParams,
          nonce: this.nonceList[state.chunkIndex],
        }
      }
      // Perform chunk encryption.
      // If this is the first (key distribution) chunk, we may need to split it
      // into several chunks in case there are too many recipients.
      // TODO
      const encRes: CryptStateOutput = EncryptPrePlanned(
        chunk.manipulateFields(), chunkParams);
      const encryptedFields: cciFields = encRes.result;
      chunk.setFields(encryptedFields);
    }
  }

  /**
   * Plans out which variant of the CCI Encryption scheme to use, i.e.
   * how to determine the key and nonce used and which encryption meta data
   * to include with the ciphertext.
   */
  private planEncryptionScheme(): void {
    this.encryptionSchemeParams = { ...this.options };  // copy input opts
    this.encryptionSchemeParams =  // run scheme planner
      EncryptionPrepareParams(this.encryptionSchemeParams);
    this.continuationParams = {  // prepare continuation variant
      ...this.encryptionSchemeParams,
      nonce: undefined,  // to be defined per chunk below
      pubkeyHeader: false,
      nonceHeader: false,
      keyslotHeader: false,
    }
    this.nonceRedistributionParams = {  // prepare nonce redistribution variant
      ...this.encryptionSchemeParams,
      nonce: EncryptionRandomNonce(),
      nonceHeader: true,
      pubkeyHeader: false,
      keyslotHeader: false,
    }
  }

  // TODO: Allow for optional non-encrypted auxiliary data, e.g. key hints
  /**
   * Determines the amount of key distribution chunks needed and the amount
   * of space available for payload per chunk.
   * Must be called after planEncryptionScheme().
   */
  private planChunks(veritable: Veritable): void {
    // First, figure out how much space we have in our key distribution
    // chunk versus how much space we need.
    // TODO plan multiple first chunks if need be
    // Calculate available space for first chunk
    // TODO: Offer this calculation deeper in the library and without
    // actually instatiating demo Cubes
    const demoChunk = cciCube.Create(veritable.cubeType, {
      ...this.options,
      fields: cciField.Encrypted(Buffer.alloc(0)),
      requiredDifficulty: 0,  // just a demo Cube
    });

    const bytesPerKeyChunk: number = demoChunk.bytesRemaining();
    // Besides key distribution information, the chunk must at least be able to
    // fit a reference to the next chunk
    const maxDistBytesPerKeyChunk: number = bytesPerKeyChunk -
      cciFieldLength[cciFieldType.RELATES_TO] -
      veritable.family.parsers[veritable.cubeType].getFieldHeaderLength(
        cciFieldType.RELATES_TO
      );
    // Will we need any key slots, and if so, how many?
    let keySlotCount: number = this.encryptionSchemeParams.keyslotHeader?
      (this.encryptionSchemeParams.recipients as Array<Buffer>).length : 0;
    let keyDistributionBytesRequired: number = undefined;
    // Let's find out how many key distribution chunks we'll need.
    this.keyDistributionChunkNo = 0;  // at least 1, will be incremented below
    while ( this.keyDistributionChunkNo === 0 ||  // always run once
      keyDistributionBytesRequired > maxDistBytesPerKeyChunk && keySlotCount > 1
    ){
      this.keyDistributionChunkNo++;
      keySlotCount = Math.ceil(keySlotCount / this.keyDistributionChunkNo);
      keyDistributionBytesRequired =
        EncryptionOverheadBytesCalc(
          veritable.family.parsers[veritable.cubeType].fieldDef,  // TODO Veritable should directly provide fieldDef
          this.encryptionSchemeParams.pubkeyHeader,
          this.encryptionSchemeParams.nonceHeader,
          keySlotCount
        );
    }
    if (keyDistributionBytesRequired > maxDistBytesPerKeyChunk) {
      throw new CryptoError("Not enough space for key distribution chunk, not even if I try to split it up");
    }
    // Determine the amount of space available for non-encryption data in the
    // key distribution chunk.
    // Note that while we needed to determine the space necessary for mandatory
    // positional fields as well as the next chunk reference, this is *not*
    // deducted here. firstChunkSpace only deducts the actual crypto overhead.
    this.firstChunkSpace = NetConstants.CUBE_SIZE - keyDistributionBytesRequired;

    // Determin the amount of space in Continuation chunks
    this.continuationChunkSpace = NetConstants.CUBE_SIZE -
      EncryptionOverheadBytes(this.continuationParams);

    // Determine the amount of space in nonce redistribution chunks
    this.nonceRedistSpace;
  }

  private get needNonceRedist(): boolean {
    return this.keyDistributionChunkNo > 1;
  }

}


export function ChunkDecrypt(
    chunks: Iterable<cciCube>,
    options: VeritumFromChunksOptions = {},
): Iterable<cciCube> {
  if (options.preSharedKey || options.recipientPrivateKey) {
    // If decryption was requested, attempt chunk decryption
    const transformedChunks = [];
    let decryptParams: CciDecryptionParams = { ... options };
    // Attempt to decrypt each chunk, first to last
    for (const chunk of chunks) {
      // Attempt to decrypt this chunk
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
      if (decryptedFields) {  // if decryption successful
        const decryptedChunk = new chunk.family.cubeClass(
        chunk.cubeType, {
          family: chunk.family,
          fields: decryptedFields,
          requiredDifficulty: 0,  // not to be published
        });
        transformedChunks.push(decryptedChunk);
      } else {  // if decryption failed
        // There's nothing we can do here, so we just pass through the original
        // chunk and let calling code handle it.
        // (The caller will attempt to recombine the Veritum, which will
        // fail like on any other corrupt input, no matter encrypted or not.)
        logger.trace(`Veritum.FromChunks(): Failed to decrypt chunk ${chunk.getKeyStringIfAvailable()}`);
        transformedChunks.push(chunk);
      }
    }
    return transformedChunks;
  } else {
    // If no decryption was requested, do nothing
    return chunks;
  }
}
