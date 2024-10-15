
import { Settings } from "../../core/settings";
import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { cciFieldType } from "../cube/cciCube.definitions";
import { cciFields } from "../cube/cciFields";
import { CryptStateOutput } from "./chunkEncryption";

import { logger } from "../../core/logger";

import { Buffer } from 'buffer'
import sodium from 'libsodium-wrappers-sumo'

export interface CciDecryptionParams {
  predefinedNonce?: Buffer,
  preSharedKey?: Buffer,
  recipientPrivateKey?: Buffer,
}


//###
// "Public" functions
//###

/**
 * Decrypts a CCI field set
 * Do not use this unless you know what you're doing.
 * Applications will usually just use Veritum.FromChunks() instead which can
 * automatically handle decryption for you.
 * @param fields - The CCI field set to decrypt
 * @param privateKey - The recipient's private key.
 *   Note this must be the *encryption* pubkey, not the "regular" signing one.
 * @param senderPublicKey - The sender's public key.
 *   Note this must be the *encryption* pubkey, not the "regular" signing one,
 *   i.e. this is *not* the sender's Identity key.
 *   If not supplied, we will attempt to retrieve it from the field set.
 *   If we can't find it, no decryption will be performed.
 * @returns The supplied field set with the encrypted content replaced by
 *   the plaintext fields, or the unchanged field set if decryption fails.
 */
export function Decrypt(
    input: cciFields,
    params: CciDecryptionParams,
): cciFields;
export function Decrypt(
    input: cciFields,
    outputState: boolean,
    params: CciDecryptionParams,
): CryptStateOutput;

export function Decrypt(
  input: cciFields,
  param2: boolean|CciDecryptionParams,
  param3?: CciDecryptionParams,
): cciFields|CryptStateOutput {
  // determine function variant
  const params: CciDecryptionParams = param2===true? param3 : param2 as CciDecryptionParams;
  const outputState: boolean = param2===true? true : false;

  let result: CryptStateOutput = undefined;

  // If we suspect we might have a pre-shared key, let's try that first
  if (params.preSharedKey !== undefined) {
    result = DecryptWithPresharedKey(
      input, params.preSharedKey, params.predefinedNonce);
  }
  if (result === undefined) {
    // Otherwise, try to decrypt with key derivation
    result = DecryptWithKeyDerivation(input, params.recipientPrivateKey);
  }

  if (result === undefined) return undefined;
  if (outputState) return result;
  else return result.result;
}



//###
// Decryption-related "private" functions
//###
function DecryptWithPresharedKey(
    input: cciFields,
    symmetricKey: Buffer,
    nonce: Buffer,
): CryptStateOutput {
  // Retrieve ENCRYPTED blob
  const encryptedBlob: Buffer = DecryptionRetrieveEncryptedBlob(input);
  if (encryptedBlob === undefined) return undefined;

  // Try to decrypt as Continuation Cube (= nonce already known)
  if (nonce) {
    const plaintext: Buffer = DecryptionSymmetricDecrypt(
      encryptedBlob, nonce, symmetricKey);
    if (plaintext) return { nonce, symmetricKey,
      result: PostprocessPlaintext(plaintext, input),
    };
  }

  // Try to decrypt as Start-of-Veritum with Preshared Key
  // (= nonce included in encrypted blob)
  let offset = 0;
  // Slice out the nonce
  nonce = encryptedBlob.subarray(offset,
    offset += sodium.crypto_box_NONCEBYTES);
  // Slice out the ciphertext
  const ciphertext: Buffer = encryptedBlob.subarray(offset, encryptedBlob.length);

  const plaintext: Buffer = DecryptionSymmetricDecrypt(
    ciphertext, nonce, symmetricKey);
  if (plaintext !== undefined) return { nonce, symmetricKey,
    result:PostprocessPlaintext(plaintext, input),
  };
  else return undefined;
}


function DecryptWithKeyDerivation(
  input: cciFields,
  privateKey: Buffer,
): CryptStateOutput {
  // Retrieve ENCRYPTED blob
  const encryptedBlob: Buffer = DecryptionRetrieveEncryptedBlob(input);
  if (encryptedBlob === undefined) return undefined;

  let offset = 0;
  // Slice out sender's public key
  const senderPublicKey: Buffer = encryptedBlob.subarray(offset,
    offset += sodium.crypto_box_PUBLICKEYBYTES);
  // Slice out the nonce
  const nonce: Buffer = encryptedBlob.subarray(offset,
    offset += sodium.crypto_box_NONCEBYTES);

  // Step 1: Try to decrypt this as a Start-of-Veritum directed exclusively
  // at us, i.e. directly derive payload symmetric key
  const derivedKey = Buffer.from(DecryptionDeriveKey(privateKey, senderPublicKey));
  if (derivedKey === undefined) return undefined;
  const ciphertext: Buffer = encryptedBlob.subarray(offset, encryptedBlob.length);
  const plaintext: Buffer = DecryptionSymmetricDecrypt(
    ciphertext, nonce, derivedKey);
  if (plaintext !== undefined) return { symmetricKey: derivedKey, nonce,
    result:PostprocessPlaintext(plaintext, input)
  };

  // Step 2: Try to decrypt as multi-recipient, i.e. try to find a key slot
  // directed at us
  while (plaintext === undefined &&
         encryptedBlob.length - offset > sodium.crypto_secretbox_KEYBYTES
  ){
    const keyslot: Buffer = encryptedBlob.subarray(offset,
      offset += sodium.crypto_secretbox_KEYBYTES);
    const symmetricKey: Buffer =
      DecryptionDecryptKeyslot(keyslot, nonce, derivedKey);
    let ciphertextOffset = offset;
    let plaintext: Buffer = undefined;
    while (plaintext === undefined &&
           encryptedBlob.length - ciphertextOffset >
             sodium.crypto_secretbox_KEYBYTES
    ) {
      // skip potential further keyslots
      const ciphertext: Buffer =
        encryptedBlob.subarray(ciphertextOffset, encryptedBlob.length);
      ciphertextOffset += sodium.crypto_secretbox_KEYBYTES;
      plaintext = DecryptionSymmetricDecrypt(
        ciphertext, nonce, symmetricKey);
      if (plaintext !== undefined) return { symmetricKey, nonce,
        result: PostprocessPlaintext(plaintext, input)
      };
    }
  }

  // This Veritum is undecryptable (i.e. intended for us)
  return undefined;
}


function PostprocessPlaintext(
  plaintext: Buffer,
  input: cciFields,
): cciFields {
  // Parse the decrypted plaintext back into fields
  const decryptedFields: cciFields = DecryptionDecompileFields(
    plaintext, input.fieldDefinition);

  // Replace the ENCRYPTED field with the decrypted fields
  const output: cciFields = DecryptionReplaceEncryptedField(
    input, decryptedFields);
  return output;
}

function DecryptionRetrieveEncryptedBlob(fields: cciFields): Buffer {
  const ciphertext: Buffer = fields.getFirst(cciFieldType.ENCRYPTED)?.value;
  if (Settings.RUNTIME_ASSERTIONS && !ciphertext?.length) {
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Ciphertext is missing or invalid";
    logger.trace(errStr);
    return undefined;
  }
  return ciphertext;
}

function DecryptionDeriveKey(
    privateKey: Buffer,
    senderPublicKey: Buffer,
): Uint8Array {
  // Sanity-check input
  if (privateKey?.length !== sodium.crypto_box_SECRETKEYBYTES) {
    // This is a hard fail -- ApiMisuseError will not be caught by Decrypt()
    // and will propagate through to the caller
    logger.warn(`Encrypt(): privateKey must be ${sodium.crypto_box_SECRETKEYBYTES} bytes, got ${privateKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
    return undefined;
  }
  if (senderPublicKey?.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    // This is a soft fail as it could be caused by an invalid message coming
    // in through the network. Decrypt() will catch this and just pass the
    // raw unencrypted fieldset back to the caller.
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Public key is missing or invalid";
    logger.trace(errStr);
    return undefined;
  }

  // Perform derivation
  const symmetricKey = sodium.crypto_box_beforenm(senderPublicKey, privateKey);

  // Sanity-check result
  if (Settings.RUNTIME_ASSERTIONS &&
      symmetricKey?.length !== sodium.crypto_secretbox_KEYBYTES
  ){
    const errStr = "Decrypt(): Cannot decrypt supplied fields as we just derived a symmetric key of invalid length";
    logger.warn(errStr);
    return undefined;
  }

  return symmetricKey;
}

function DecryptionDecryptKeyslot(
    keyslot: Uint8Array,
    nonce: Uint8Array,
    slotKey: Uint8Array,
): Buffer {
  const symmetricKey: Buffer = Buffer.from(sodium.crypto_stream_xchacha20_xor(
    keyslot, nonce, slotKey));
  // Sanity-check result
  if (Settings.RUNTIME_ASSERTIONS &&
    symmetricKey?.length !== sodium.crypto_secretbox_KEYBYTES
  ){
    const errStr = "Decrypt(): Cannot decrypt supplied fields as keyslot decryption result is missing or invalid";
    logger.trace(errStr);
    return undefined;
  }
  return symmetricKey;
}


function DecryptionSymmetricDecrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    symmetricKey: Uint8Array,
): Buffer {
  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, symmetricKey);
  } catch (err) {
    return undefined;
  }
  return Buffer.from(plaintext);
}

function DecryptionDecompileFields(
    plaintext: Buffer,
    fieldDefinition: FieldDefinition,
): cciFields {
  const intermediateFieldDef: FieldDefinition = Object.assign({}, fieldDefinition);
  intermediateFieldDef.positionalFront = {};
  intermediateFieldDef.positionalBack = {};
  const parser: FieldParser = new FieldParser(intermediateFieldDef);
  const decryptedFields: cciFields =
    parser.decompileFields(Buffer.from(plaintext)) as cciFields;
  return decryptedFields;
}

function DecryptionReplaceEncryptedField(
    fields: cciFields,
    decryptedFields: cciFields,
): cciFields {
  // Find the index of the ENCRYPTED field
  const encryptedFieldIndex = fields.all.findIndex(field => field.type === cciFieldType.ENCRYPTED);
  if (encryptedFieldIndex === -1) {
    logger.trace("Decrypt(): ENCRYPTED field not found");
    return fields;
  }

  // Insert the decrypted fields at the found index
  const output: cciFields = new cciFields(undefined, fields.fieldDefinition);
  for (let i = 0; i < fields.length; i++) {
    if (i === encryptedFieldIndex) {
      for (const decryptedField of decryptedFields.all) {
        output.appendField(decryptedField);
      }
    }
    const field = fields.all[i];
    if (field.type !== cciFieldType.ENCRYPTED){
      output.appendField(field);
    }
  }

  return output;
}
