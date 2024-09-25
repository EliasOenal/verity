import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { ApiMisuseError, Settings } from "../../core/settings";
import { cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields } from "../cube/cciFields";
import { Continuation, CryptoError } from "./continuation";

import { logger } from "../../core/logger";

import sodium from 'libsodium-wrappers-sumo'

export interface CciEncryptionOptions {
  exclude?: number[],
  includeSenderPubkey?: Buffer,
}

/**
 * Encrypts a CCI field set
 * Note: Encryption should take place before splitting
 * (as encryption adds a header and therefore slightly increases total size)
 * and before Cube compilation (as this may introduce padding fields which
 * no longer make sense after data length has increased due to encryption).
 * Note: Caller must await sodium.ready before calling.
 */
// Note: Implementing this here as I'm planning to morph Continuation into a general
// content-representing class that will be usually be used by CCI applications
// rather than dealing with Cubes directly.
// Let's call this a Veritum maybe... a unit of Verity :)
// Maybe TODO: use linked list instead of Array to avoid unnecessary copies?
export function Encrypt(
    fields: cciFields,
    privateKey: Buffer,
    recipientPublicKey: Buffer,
    options: CciEncryptionOptions = {},
): cciFields {
  // sanity-check input
  if (recipientPublicKey?.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new ApiMisuseError(`Encrypt(): recipientPublicKey must be ${sodium.crypto_box_PUBLICKEYBYTES} bytes, got ${recipientPublicKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
  }
  if (privateKey?.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new ApiMisuseError(`Encrypt(): privateKey must be ${sodium.crypto_box_SECRETKEYBYTES} bytes, got ${privateKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
  }

  // set default options
  options.exclude ??= Continuation.ContinuationDefaultExclusions;

  // Prepare list of fields to encrypt. This is basically all CCI fields,
  // but not core Cube fields.
  const toEncrypt: cciFields = new cciFields(undefined, fields.fieldDefinition);
  // Also prepare the output field set. We will copy all fields not to be
  // encrypted directly to output and add the encrypted content later.
  const output: cciFields = new cciFields(undefined, fields.fieldDefinition);
  for (const field of fields.all) {
    if (!options.exclude.includes(field.type)) {
      toEncrypt.appendField(field);
    } else {
      // Make a verbatim copy, except for garbage fields PADDING and CCI_END
      if (field.type !== cciFieldType.PADDING &&
          field.type !== cciFieldType.CCI_END
      ){
        output.appendField(field);
      }
    }
  }

  // Create a random nonce and add it to the front of the output field set
  const nonce: Buffer = Buffer.from(
    sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES));
  if (Settings.RUNTIME_ASSERTIONS && nonce.length !== NetConstants.CRYPTO_NONCE_SIZE) {
    throw new CryptoError(`Libsodium's generated nonce size of ${nonce.length} does not match NetConstants.CRYPTO_NONCE_SIZE === ${NetConstants.CRYPTO_NONCE_SIZE}. This should never happen. Using an incompatible version of libsodium maybe?`);
  }
  output.insertFieldAfterFrontPositionals(cciField.CryptoNonce(nonce));

  // If requested, include the public key with the encrypted message
  if (options.includeSenderPubkey) {
    output.insertFieldAfterFrontPositionals(
      cciField.CryptoPubkey(options.includeSenderPubkey));
  }

  // Compile the fields to encrypt.
  // This gives us the binary plaintext that we'll later encrypt.
  // Note that this intermediate compilation never includes any positional
  // fields; we therefore construct a new FieldDefinition without
  // positionals and a corresponding FieldParser.
  const intermediateFieldDef: FieldDefinition = Object.assign({}, fields.fieldDefinition);
  intermediateFieldDef.positionalFront = {};
  intermediateFieldDef.positionalBack = {};
  const compiler: FieldParser = new FieldParser(intermediateFieldDef);
  const plaintext: Buffer = compiler.compileFields(toEncrypt);

  // Derive symmetric key
  const key: Uint8Array = sodium.crypto_box_beforenm(
    recipientPublicKey, privateKey);
  if (Settings.RUNTIME_ASSERTIONS &&
      key.length !== NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE
  ){
    throw new CryptoError(`Libsodium's generated symmetric key size of ${key.length} does not match NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE === ${NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE}. This should never happen. Using an incompatible version of libsodium maybe?`);
  }

  // Perform encryption
  // TODO: Support encryption to multiple parties
  const encryption: Uint8Array = sodium.crypto_secretbox_easy(
    plaintext, nonce, key);

  // Add the encrypted content to the output field set
  output.insertFieldAfterFrontPositionals(
    cciField.Encrypted(Buffer.from(encryption)));

  return output;
}


/**
 * Decrypts a CCI field set
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
    fields: cciFields,
    privateKey: Buffer,
    senderPublicKey?: Buffer,
): cciFields {
  // sanity-check input
  if (privateKey?.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new ApiMisuseError(`Encrypt(): privateKey must be ${sodium.crypto_box_SECRETKEYBYTES} bytes, got ${privateKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
  }
  if (senderPublicKey === undefined) {
    senderPublicKey = fields.getFirst(cciFieldType.CRYPTO_PUBKEY)?.value;
  }
  if (senderPublicKey?.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    logger.trace("Decrypt(): Cannot decrypt supplied fields as Public key is missing or invalid");
    return fields;  // fail gently on any potential outside-world errors
  }

  // Retrieve crypto fields and validate them
  const nonce: Buffer = fields.getFirst(cciFieldType.CRYPTO_NONCE)?.value;
  if (Settings.RUNTIME_ASSERTIONS && nonce?.length !== NetConstants.CRYPTO_NONCE_SIZE) {
    logger.trace("Decrypt(): Cannot decrypt supplied fields as Nonce is missing or invalid");
    return fields;
  }
  const ciphertext: Buffer = fields.getFirst(cciFieldType.ENCRYPTED)?.value;
  if (Settings.RUNTIME_ASSERTIONS && !ciphertext?.length) {
    logger.trace("Decrypt(): Cannot decrypt supplied fields as Ciphertext is missing or invalid");
    return fields;
  }

  // Derive symmetric key
  const key: Uint8Array = sodium.crypto_box_beforenm(
    senderPublicKey, privateKey);
  if (Settings.RUNTIME_ASSERTIONS &&
      key.length !== NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE
  ){
    logger.trace("Decrypt(): Cannot decrypt supplied fields as Symmetric key is missing or invalid");
    return fields;
  }

  // Decrypt the ciphertext

  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  } catch (err) {
    logger.trace("Decrypt(): Decryption failed: " + err);
    return fields;
  }
  if (!plaintext) {
    logger.trace("Decrypt(): Decryption failed for unknown reason");
    return fields;
  }

  // Parse the decrypted plaintext back into fields
  const intermediateFieldDef: FieldDefinition = Object.assign({}, fields.fieldDefinition);
  intermediateFieldDef.positionalFront = {};
  intermediateFieldDef.positionalBack = {};
  const parser: FieldParser = new FieldParser(intermediateFieldDef);
  const decryptedFields: cciFields =
    parser.decompileFields(Buffer.from(plaintext)) as cciFields;

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
    if (field.type !== cciFieldType.ENCRYPTED &&
        field.type !== cciFieldType.CRYPTO_NONCE &&
        field.type !== cciFieldType.CRYPTO_MAC &&
        field.type !== cciFieldType.CRYPTO_KEY &&
        field.type !== cciFieldType.CRYPTO_PUBKEY
    ){
      output.appendField(field);
    }
  }

  return output;
}
