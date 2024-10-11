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
import { CciEncryptionParams, EncryptionPrepareParams, EncryptionOverheadBytes, EncryptionHashNonces, CryptStateOutput, EncryptPrePlanned, EncryptionHashNonce, EncryptionOverheadBytesCalc, CryptoError } from "./chunkEncryption";
import { SplitState } from "./continuation";
import { VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum";

export class ChunkEncryptionHelper {
  readonly shallEncrypt: boolean;

  private encryptionSchemeParams: CciEncryptionParams;
  private continuationEncryptionParams: CciEncryptionParams;
  private firstChunkSpace: number;
  private continuationChunkSpace: number;
  private nonceList: Buffer[] = [];

  /** Number of key distribution chunks */
  private keyDistributionChunkNo: number;

  // TODO simplify
  private nonceRedistChunkNo: number;

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
      this.planKeyDistributionChunks(veritable);
      this.continuationChunkSpace = NetConstants.CUBE_SIZE -
        EncryptionOverheadBytes(this.continuationEncryptionParams);
      }
    }

  spacePerChunk(chunkIndex: number): number {
    if (this.shallEncrypt) {
      if (chunkIndex === 0) {
        return this.firstChunkSpace;
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
      // TODO allow for multiple key distribution chunks, i.e. transform
      // a single chunkIndex===0 chunk to multiple chunks
      if (state.chunkIndex === 0) {
        chunkParams = this.encryptionSchemeParams;  // TODO separate params for individual KDC
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

  /**
   * Plans out which variant of the CCI Encryption scheme to use, i.e.
   * how to determine the key and nonce used and which encryption meta data
   * to include with the ciphertext.
   */
  private planEncryptionScheme(): void {
    this.encryptionSchemeParams = { ...this.options };  // copy input opts
    this.encryptionSchemeParams =  // run scheme planner
      EncryptionPrepareParams(this.encryptionSchemeParams);
    this.continuationEncryptionParams = {  // prepare continuation variant
      ...this.encryptionSchemeParams,
      nonce: undefined,  // to be defined per chunk below
      pubkeyHeader: false,
      nonceHeader: false,
      keyslotHeader: false,
    }
  }

  // TODO: Allow for optional non-encrypted auxiliary data, e.g. key hints
  private planKeyDistributionChunks(veritable: Veritable): void {
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
    let keyDistributionBytesRequired: number =
      EncryptionOverheadBytesCalc(
        veritable.family.parsers[veritable.cubeType].fieldDef,  // TODO Veritable should directly provide fieldDef
        this.encryptionSchemeParams.pubkeyHeader,
        this.encryptionSchemeParams.nonceHeader,
        keySlotCount
      );
    // Will we need more than one key distribution chunk?
    this.keyDistributionChunkNo = 1;
    // If there's not enough space, split the key distribution chunk in
    // two and check again.
    while (keyDistributionBytesRequired > maxDistBytesPerKeyChunk && keySlotCount > 1) {
      this.keyDistributionChunkNo++;
      keySlotCount = Math.ceil(keySlotCount / 2);
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
