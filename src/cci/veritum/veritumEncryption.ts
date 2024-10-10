import { Cube } from "../../core/cube/cube";
import { logger } from "../../core/logger";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { cciCube } from "../cube/cciCube";
import { cciFields } from "../cube/cciFields";
import { CciDecryptionParams, Decrypt } from "./chunkDecryption";
import { CciEncryptionParams, EncryptionPrepareParams, EncryptionOverheadBytes, EncryptionHashNonces, CryptStateOutput, EncryptPrePlanned, EncryptionHashNonce } from "./chunkEncryption";
import { SplitState } from "./continuation";
import { VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum";

export class ChunkEncryptionHelper {
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
