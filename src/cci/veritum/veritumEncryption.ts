import { keyVariants } from "../../core/cube/keyUtil";
import { Veritable } from "../../core/cube/veritable.definition";
import { logger } from "../../core/logger";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { cciCube } from "../cube/cciCube";
import { FieldLength, FieldType } from "../cube/cciCube.definitions";
import { VerityField } from "../cube/verityField";
import { VerityFields } from "../cube/verityFields";

import { CciDecryptionParams, Decrypt } from "./chunkDecryption";
import { CciEncryptionParams, EncryptionPrepareParams, EncryptionOverheadBytes, EncryptionHashNonces, CryptStateOutput, EncryptPrePlanned, EncryptionHashNonce, EncryptionOverheadBytesCalc, CryptoError, EncryptionRandomNonce } from "./chunkEncryption";
import { ContinuationDefaultExclusions, Split, ChunkFinalisationState } from "./continuation";
import { VeritumCompileOptions, VeritumFromChunksOptions } from "./veritum";

import sodium from 'libsodium-wrappers-sumo'

/**
 * Compared to ContinuationDefaultExclusions, note the lack of PADDING.
 * This is because padding is used in continuation chains to indicate that
 * two adjacent variable-length fields of the same type should *not* be joined.
 * As Veritum encryption is split-then-encrypt, padding field must not be
 * dropped at the encryption stage.
 **/
const VeritumEncryptionExclusions: number[] = [
  // Cube positionals
  FieldType.TYPE, FieldType.NOTIFY, FieldType.PMUC_UPDATE_COUNT,
  FieldType.PUBLIC_KEY, FieldType.DATE, FieldType.SIGNATURE,
  FieldType.NONCE,
  // raw / non-CCI content fields
  FieldType.FROZEN_RAWCONTENT, FieldType.FROZEN_NOTIFY_RAWCONTENT,
  FieldType.PIC_RAWCONTENT, FieldType.PIC_NOTIFY_RAWCONTENT,
  FieldType.MUC_RAWCONTENT, FieldType.MUC_NOTIFY_RAWCONTENT,
  FieldType.PMUC_RAWCONTENT, FieldType.PMUC_NOTIFY_RAWCONTENT,
  // non-content bearing CCI fields
  FieldType.CCI_END,
  // virtual / pseudo fields
  FieldType.REMAINDER,
] as const;

/**
 * The ChunkEncryption helper is, as the name suggest, a helper that prepares
 * a (potentially multi-chunk and/or multi-recipient) Veritum for chunk-by-chunk
 * encryption. In case of multiple recipients it handles key distribution.
 * Note that actual input padding fields will still be stripped by default,
 * as, again, Veritum encryption is split-then-encrypt, and the splitter's
 * default exlusions to include PADDING.
 */
export class ChunkEncryptionHelper {
  readonly shallEncrypt: boolean;

  private encryptionSchemeParams: CciEncryptionParams;
  private nonceRedistributionParams: CciEncryptionParams;
  private continuationParams: CciEncryptionParams;

  private firstChunkSpace: number;
  private continuationChunkSpace: number;
  private nonceRedistSpace: number;

  private nonceList: Buffer[] = [];
  supplementaryKeyChunks: cciCube[] = [];
  recipientKeyChunkMap: Map<string, cciCube> = new Map();

  /** Number of key distribution chunks */
  keyChunkNo: number;
  private keySlotsPerChunk: number;

  constructor(
      veritable: Veritable,
      readonly options: VeritumCompileOptions,  // TODO veritable should be able to incorporate options
  ){
    // First, let's find out if the user did even request encryption
    this.shallEncrypt = this.options.recipients !== undefined;
    if (this.shallEncrypt) {
      // Figure out which variant of CCI encryption we will use
      this.planEncryptionScheme();
      // Reserve some space for encryption overhead.
      this.planChunks(veritable);
      }
    }

  /**
   * This is a callback method for the splitter, letting it know how much space
   * it is allowed to use per chunk.
   */
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

  /**
   * This is the main method doing the actual encryption.
   * Note that CCI encryption is implemented as a pluggable callback; this is this
   * pluggable callback.
   * You will never need to call this method manually, it should always only be
   * used as a callback to the chunk splitter.
   * @param chunk The chunk to encrypt
   * @param state The splitter's internal state, notably letting us know which
   *   chunk this is (i.e. the chunk index).
   */
  transformChunk(chunk: cciCube, state: ChunkFinalisationState): void {
    if (this.shallEncrypt) {  // only act if encryption requested
      // Lazy-initialise nonce list
      if (this.nonceList.length < state.chunkCount) {
        this.makeNonceList(state.chunkCount);
      }
      let chunkParams: CciEncryptionParams;
      // There are two possible states:
      // - If this the first chunk (which, not that it matters but just so you
      //   know, is handled *last*), key derivation meta data goes in here
      // - If this is any other chunk, we use the symmetric session established
      //   in the first chunk, but crucially supplying a unique nonce.
      if (state.chunkIndex === 0) {
        // Handling the key distribution chunks:
        chunkParams = { ... this.encryptionSchemeParams };
        if (this.keyChunkNo > 1) {
          // If we need more than one key distribution chunk, we need to split
          // the recipients list. The "original" key distribution chunk gets the
          // first recipients, while the other chunks get the rest.
          // TODO randomise
          chunkParams.recipients = (chunkParams.recipients as Array<Buffer>).
            slice(0, this.keySlotsPerChunk);
          // Map out which recipient need to get which first chunk
          this.mapRecipientKeyChunk(chunkParams.recipients, chunk);
          // Create as many supplementary key distribution chunks as needed
          this.makeSupplementaryKeyDistributionChunks(chunk);
        } else {
          // Nothing to do here really, just take note of the fact that there's
          // no difference in first chunks between recipients.
          // It's the simple case :)
          this.mapRecipientKeyChunk(
            this.encryptionSchemeParams.recipients as Buffer[], chunk);
        }
      } else if (state.chunkIndex === 1 && this.needNonceRedist === true) {
        // Handling the nonce redistribution chunk, if this is one of
        // the rare cases in which we need one.
        chunkParams = this.nonceRedistributionParams;
      } else {
        // This is a boring old continuation chunks.
        // Just supply the unique derived nonce and that's it.
        chunkParams = {
          ...this.continuationParams,
          nonce: this.nonceList[state.chunkIndex],
        }
      }
      // All prep done, perform chunk encryption.
      const encRes: CryptStateOutput = EncryptPrePlanned(
        chunk.manipulateFields(), chunkParams);
      const encryptedFields: VerityFields = encRes.result;
      chunk.setFields(encryptedFields);
    }
  }

  /**
   * Plans out which variant of the CCI Encryption scheme to use, i.e.
   * how to determine the key and nonce used and which encryption meta data
   * to include with the ciphertext.
   */
  private planEncryptionScheme(): void {
    // copy input opts
    this.encryptionSchemeParams = { ...this.options };
    // Set default exclusions
    this.encryptionSchemeParams.excludeFromEncryption ??= VeritumEncryptionExclusions;

    // Make a new random sender key pair.
    // This is an ephemeral key only intended to encrypt a single chunk.
    // No replies to this pubkey are expected; thus we can discard the
    // keys right after encryption.
    if (this.encryptionSchemeParams.senderPrivateKey == undefined &&
        this.encryptionSchemeParams.senderPubkey == undefined
    ){
      const keyPair = sodium.crypto_box_keypair();
      this.encryptionSchemeParams.senderPrivateKey = Buffer.from(keyPair.privateKey);
      this.encryptionSchemeParams.senderPubkey = Buffer.from(keyPair.publicKey);
    } else {
      logger.warn(`veritumEncryption: Caution, using supplied sender keypair. This is discouraged as it can lead to public key reuse, which can allow non-recipients to infer message metadata.`);
    }
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
    const demoChunk = cciCube.Create({
      ...this.options,
      cubeType: veritable.cubeType,
      fields: VerityField.Encrypted(Buffer.alloc(0)),
      requiredDifficulty: 0,  // just a demo Cube
    });

    const bytesPerKeyChunk: number = demoChunk.bytesRemaining();
    // Besides key distribution information, the chunk must at least be able to
    // fit a reference to the next chunk
    const maxDistBytesPerKeyChunk: number = bytesPerKeyChunk -
      FieldLength[FieldType.RELATES_TO] -
      veritable.family.parsers[veritable.cubeType].getFieldHeaderLength(
        FieldType.RELATES_TO
      );
    // Will we need any key slots, and if so, how many?
    this.keySlotsPerChunk = this.encryptionSchemeParams.keyslotHeader?
      (this.encryptionSchemeParams.recipients as Array<Buffer>).length : 0;
    let keyDistributionBytesRequired: number = undefined;
    // Let's find out how many key distribution chunks we'll need.
    this.keyChunkNo = 0;  // at least 1, will be incremented below
    while ( this.keyChunkNo === 0 ||  // always run once
      keyDistributionBytesRequired > maxDistBytesPerKeyChunk && this.keySlotsPerChunk > 1
    ){
      this.keyChunkNo++;
      this.keySlotsPerChunk = Math.ceil(this.keySlotsPerChunk / this.keyChunkNo);
      keyDistributionBytesRequired =
        EncryptionOverheadBytesCalc(
          veritable.family.parsers[veritable.cubeType].fieldDef,  // TODO Veritable should directly provide fieldDef
          this.encryptionSchemeParams.pubkeyHeader,
          this.encryptionSchemeParams.nonceHeader,
          this.keySlotsPerChunk
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
    this.nonceRedistSpace = NetConstants.CUBE_SIZE -
      EncryptionOverheadBytes(this.nonceRedistributionParams);
  }

  /**
   * @returns Whether a special chunk is required after the key distribution
   *   chunks, setting a new random nonce.
   *   This is only relevant if there is more than one key distribution chunk;
   *   in that case, the new random nonce on "chunk 2" allows us to use different
   *   nonces for each key distribution chunk, thereby prevents non-recipients
   *   from correlating a Veritum's key distribution chunks by a common nonce.
   */
  private get needNonceRedist(): boolean {
    return this.keyChunkNo > 1;
  }

  private makeSupplementaryKeyDistributionChunks(chunk: cciCube): void {
    for (let i = 1; i < this.keyChunkNo; i++) {
      // prepare params
      const chunkParams: CciEncryptionParams = { ... this.encryptionSchemeParams };
      // get this supplementary chunk's own unique pubkey
      const keyPair = sodium.crypto_box_keypair();
      chunkParams.senderPrivateKey = Buffer.from(keyPair.privateKey);
      chunkParams.senderPubkey = Buffer.from(keyPair.publicKey);
      // get this supplementary chunk its own unique nonce
      chunkParams.nonce = EncryptionRandomNonce();
      // This chunk gets the i-th slice of recipients
      chunkParams.recipients = (chunkParams.recipients as Array<Buffer>).
        slice(i*this.keySlotsPerChunk, (i+1)*this.keySlotsPerChunk);
      // Pad up the recipient list if necessary
      while ((chunkParams.recipients as Array<Buffer>).length < this.keySlotsPerChunk) {
        (chunkParams.recipients as Array<Buffer>).push(Buffer.from(
          sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)));
      }
      // Run the supplementary chunk field set through the encrypter
      const encRes: CryptStateOutput = EncryptPrePlanned(
        chunk.manipulateFields(), chunkParams);
      // Sculpt the supplementary chunk
      const supplementaryChunk = cciCube.Create({
        ...this.options,
        cubeType: chunk.cubeType,
        fields: encRes.result,
      });
      this.supplementaryKeyChunks.push(supplementaryChunk);
      // Map out which recipient needs to get which chunk
      this.mapRecipientKeyChunk(chunkParams.recipients, supplementaryChunk);
    }
  }

  private mapRecipientKeyChunk(recipients: Iterable<Buffer>, chunk: cciCube): void {
    for (const recipient of recipients) {
      this.recipientKeyChunkMap.set(keyVariants(recipient).keyString, chunk);
    }
  }

  private makeNonceList(chunkCount: number): void {
    if (!this.needNonceRedist) {
      this.nonceList = EncryptionHashNonces(
        this.encryptionSchemeParams.nonce, chunkCount);
    } else {
      this.nonceList = [
        this.encryptionSchemeParams.nonce,
        ...EncryptionHashNonces(this.nonceRedistributionParams.nonce, chunkCount),
      ];
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
        chunk.fields, true, decryptParams,
      );
      if (decryptOutput?.symmetricKey !== undefined) {
        // Key agreed on first chunk will be reused on subsequent chunks
        // and a derived nonce will be used as per the spec
        decryptParams.preSharedKey = decryptOutput.symmetricKey;
        decryptParams.predefinedNonce = EncryptionHashNonce(decryptOutput.nonce);
      }
      const decryptedFields: VerityFields = decryptOutput?.result;
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
    // In case of encrypted chunks, we should tell Recombine() to ignore
    // any remaining ENCRYPTED fields. That can happen if some parts of this
    // Veritum are not intended for this recipient, i.e. supplementary
    // key distribution chunks intended for other recipients.
    // This also means that if decryption fails, the application gets served
    // an empty Veritum rather than a bunch of useless ciphertext.
    options.excludeField = [
      ...(options.excludeField ?? ContinuationDefaultExclusions),
      FieldType.ENCRYPTED,
    ]
    return transformedChunks;
  } else {
    // If no decryption was requested, do nothing
    return chunks;
  }
}
