import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { ApiMisuseError, Settings, VerityError } from "../../core/settings";
import { cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields } from "../cube/cciFields";
import { Continuation, CryptoError } from "./continuation";

import { Identity } from "../identity/identity";

import { logger } from "../../core/logger";

import sodium from 'libsodium-wrappers-sumo'
import { isIterableButNotBuffer } from "../../core/helpers/misc";

export type EncryptionRecipients = Identity|Iterable<Identity>|Buffer|Iterable<Buffer>;
export interface CciEncryptionOptions {
  excludeFromEncryption?: number[],
  includeSenderPubkey?: Buffer,
}

//###
// "Public" functions
//###

/**
 * Encrypts a CCI field set
 * Note: Encryption should take place before splitting
 * (as encryption adds a header and therefore slightly increases total size)
 * and before Cube compilation (as this may introduce padding fields which
 * no longer make sense after data length has increased due to encryption).
 * Note: Caller must await sodium.ready before calling.
 */
// Maybe TODO: use linked list instead of Array to avoid unnecessary copies?
export function Encrypt(
    fields: cciFields,
    privateKey: Buffer,
    recipients: EncryptionRecipients,
    options: CciEncryptionOptions = {},
): cciFields {
  // Also prepare the output field set. We will copy all fields not to be
  // encrypted directly to output and add the encrypted content later.
  const output: cciFields = new cciFields(undefined, fields.fieldDefinition);

  const toEncrypt: cciFields = EncryptionPrepareFields(fields, output, options);
  const nonce: Buffer = EncryptionGenerateNonce(output);
  const symmetricPayloadKey: Uint8Array = EncryptionDeriveKey(
    privateKey, recipients, nonce, output, options);
  const plaintext: Buffer = EncryptionCompileFields(toEncrypt);
  const encryptedField: cciField = EncryptionSymmetricEncrypt(plaintext, nonce, symmetricPayloadKey);
  // Add the encrypted content to the output field set
  output.insertFieldAfterFrontPositionals(encryptedField);

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
  try {
    // Retrieve crypto fields (this also validates them)
    const nonce: Buffer = DecryptionRetrieveNonce(fields);
    const ciphertext: Buffer = DecryptionRetrieveCiphertext(fields);
    const encryptedKeyFields: cciField[] = fields.get(cciFieldType.CRYPTO_KEY);
    // Only try to fetch the sender's public key from the field set if it wasn't
    // supplied by the caller.
    senderPublicKey ??= fields.getFirst(cciFieldType.CRYPTO_PUBKEY)?.value;

    // Derive the symmetric key
    const symmetricKey: Uint8Array = DecryptionDeriveKey(
      privateKey, senderPublicKey, nonce, encryptedKeyFields);

    // Decrypt the ciphertext
    const plaintext: Buffer = DecryptionSymmetricDecrypt(
      ciphertext, nonce, symmetricKey);

    // Parse the decrypted plaintext back into fields
    const decryptedFields: cciFields = DecryptionDecompileFields(
      plaintext, fields.fieldDefinition);

    // Replace the ENCRYPTED field with the decrypted fields
    const output: cciFields = DecryptionReplaceEncryptedField(
      fields, decryptedFields);
    return output;
  } catch (err) {
    // A simple decryption failure will be silently ignored.
    // The rationale behind that is that encrypted messages come in through
    // the network and can be corrupt in all kinds of ways beyond our control.
    // All other failures are rethrown to the caller.
    if (err instanceof DecryptionFailed) return fields;
    else throw err;
  }
}





//###
// Encryption-related "private" functions
//###


export function EncryptionPrepareFields(
    fields: cciFields,
    output: cciFields,
    options: CciEncryptionOptions
): cciFields {
  // set default options
  options.excludeFromEncryption ??= Continuation.ContinuationDefaultExclusions;

  // Prepare list of fields to encrypt. This is basically all CCI fields,
  // but not core Cube fields.
  const toEncrypt: cciFields = new cciFields(undefined, fields.fieldDefinition);
  for (const field of fields.all) {
    if (!options.excludeFromEncryption.includes(field.type)) {
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
  return toEncrypt;
}

export function EncryptionDeriveKey(
    privateKey: Buffer,
    recipients: EncryptionRecipients,
    nonce: Uint8Array,
    output: cciFields,
    options: CciEncryptionOptions,
) {
  // sanity-check input
  if (privateKey?.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new ApiMisuseError(`Encrypt(): privateKey must be ${sodium.crypto_box_SECRETKEYBYTES} bytes, got ${privateKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
  }

  // If requested, include the public key with the encrypted message
  if (options.includeSenderPubkey) {
    output.insertFieldAfterFrontPositionals(
      cciField.CryptoPubkey(options.includeSenderPubkey));
  }

  // Determine symmetric key. There's two cases:
  // - If there's only a single recipient, we directly derive the key using the
  // recipient's public key and the sender's private key.
  // - However, if there are multiple recipients, we chose a random key and
  //   include an individual encrypted version of it for each recipient.
  const recipientPubkeys = Array.from(EncryptionNormaliseRecipients(recipients));
  let symmetricPayloadKey: Uint8Array;
  if (recipientPubkeys.length === 1) {
    symmetricPayloadKey = sodium.crypto_box_beforenm(
      recipientPubkeys[0], privateKey);
  } else {
    // Generate a random symmetric key
    symmetricPayloadKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
    // Encrypt the symmetric key for each recipient
    for (const recipientPubKey of recipientPubkeys) {
      const encryptedKey = sodium.crypto_box_easy(symmetricPayloadKey, nonce, recipientPubKey, privateKey);
      output.insertFieldAfterFrontPositionals(cciField.CryptoKey(Buffer.from(encryptedKey)));
    }
  }
  if (Settings.RUNTIME_ASSERTIONS &&
      symmetricPayloadKey.length !== NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE
  ){
    throw new CryptoError(`Libsodium's generated symmetric key size of ${symmetricPayloadKey.length} does not match NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE === ${NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE}. This should never happen. Using an incompatible version of libsodium maybe?`);
  }

  return symmetricPayloadKey;
}

/**
 *
 * @param output If specified, write a NONCE field to the output fieldset
 */
export function EncryptionGenerateNonce(output?: cciFields): Buffer {
  // Create a random nonce
  const nonce: Buffer = Buffer.from(
    sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES));
  if (Settings.RUNTIME_ASSERTIONS && nonce.length !== NetConstants.CRYPTO_NONCE_SIZE) {
    throw new CryptoError(`Libsodium's generated nonce size of ${nonce.length} does not match NetConstants.CRYPTO_NONCE_SIZE === ${NetConstants.CRYPTO_NONCE_SIZE}. This should never happen. Using an incompatible version of libsodium maybe?`);
  }
  // add nonce to the front of the output field set if requested
  output?.insertFieldAfterFrontPositionals(cciField.CryptoNonce(nonce));
  return nonce;
}

export function EncryptionCompileFields(toEncrypt: cciFields): Buffer {
  // Compile the fields to encrypt.
  // This gives us the binary plaintext that we'll later encrypt.
  // Note that this intermediate compilation never includes any positional
  // fields; we therefore construct a new FieldDefinition without
  // positionals and a corresponding FieldParser.
  const intermediateFieldDef: FieldDefinition = Object.assign({}, toEncrypt.fieldDefinition);
  intermediateFieldDef.positionalFront = {};
  intermediateFieldDef.positionalBack = {};
  const compiler: FieldParser = new FieldParser(intermediateFieldDef);
  const plaintext: Buffer = compiler.compileFields(toEncrypt);
  return plaintext;
}

export function EncryptionSymmetricEncrypt(
    plaintext: Uint8Array,
    nonce: Uint8Array,
    symmetricPayloadKey: Uint8Array,
): cciField {
  // Perform encryption
  const ciphertext: Uint8Array = sodium.crypto_secretbox_easy(
    plaintext, nonce, symmetricPayloadKey);
  const encryptedField: cciField = cciField.Encrypted(Buffer.from(ciphertext));
  return encryptedField;
}

export function *EncryptionNormaliseRecipients(recipients: EncryptionRecipients): Generator<Buffer> {
  // normalize input
  if (!isIterableButNotBuffer(recipients)) {
    recipients = [recipients as Identity];
  }
  for (let recipient of recipients as Iterable<Identity|Buffer>) {
    // further normalize input
    if (recipient instanceof Identity) recipient = recipient.encryptionPublicKey;
    // sanity check key
    if (recipient?.length !== sodium.crypto_box_PUBLICKEYBYTES) {
      throw new ApiMisuseError(`Encrypt(): recipientPublicKey must be ${sodium.crypto_box_PUBLICKEYBYTES} bytes, got ${recipient?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
    }
    yield recipient;
  }
}



//###
// Decryption-related "private" functions
//###

class DecryptionFailed extends VerityError { name = "Decryption failed" }

export function DecryptionRetrieveNonce(fields: cciFields): Buffer {
  const nonce = fields.getFirst(cciFieldType.CRYPTO_NONCE)?.value;
  if (Settings.RUNTIME_ASSERTIONS && nonce?.length !== NetConstants.CRYPTO_NONCE_SIZE) {
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Nonce is missing or invalid"
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }
  return nonce;
}

export function DecryptionRetrieveCiphertext(fields: cciFields): Buffer {
  const ciphertext: Buffer = fields.getFirst(cciFieldType.ENCRYPTED)?.value;
  if (Settings.RUNTIME_ASSERTIONS && !ciphertext?.length) {
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Ciphertext is missing or invalid";
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }
  return ciphertext;
}

export function DecryptionDeriveKey(
    privateKey: Buffer,
    senderPublicKey: Buffer,
    nonce: Buffer,
    encryptedKeyFields?: cciField[],
): Uint8Array {
  // sanity-check input
  if (privateKey?.length !== sodium.crypto_box_SECRETKEYBYTES) {
    // This is a hard fail -- ApiMisuseError will not be caught by Decrypt()
    // and will propagate through to the caller
    throw new ApiMisuseError(`Encrypt(): privateKey must be ${sodium.crypto_box_SECRETKEYBYTES} bytes, got ${privateKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
  }
  if (senderPublicKey?.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    // This is a soft fail as it could be caused by an invalid message coming
    // in through the network. Decrypt() will catch this and just pass the
    // raw unencrypted fieldset back to the caller.
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Public key is missing or invalid";
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }

  // There are two possible cases:
  // - There's only a single recipient:
  //   In this case, the payload is encrypted directly with the key
  //   derived from the sender's private key and the recipient's public key.
  // - There are multiple recipients:
  //   In this case, the payload is encrypted with the a random key, which
  //   is supplied in encrypted form.
  //   The key asymmetrically derived from the sender's private key and
  //   the recipient's public key is used to decrypt this random key,
  //   which in turn is used to decrypt the payload.
  let symmetricKey: Uint8Array;
  if (encryptedKeyFields?.length > 0) {
    // Multiple recipients!
    // From all encrypted key fields provided, find the one that's addressed
    // to us and decrypt the symmetric key.
    for (const encryptedKeyField of encryptedKeyFields) {
      try {
        symmetricKey = sodium.crypto_box_open_easy(
          encryptedKeyField.value, nonce, senderPublicKey, privateKey);
      } catch (err) { continue }
    }
  } else {
    // Single recipient!
    // Just derive the key and be done with it.
    symmetricKey = sodium.crypto_box_beforenm(senderPublicKey, privateKey);
  }
  if (Settings.RUNTIME_ASSERTIONS &&
      symmetricKey?.length !== NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE
  ){
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Symmetric key is missing or invalid"
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }
  return symmetricKey;
}


export function DecryptionSymmetricDecrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    symmetricKey: Uint8Array,
): Buffer {
  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, symmetricKey);
  } catch (err) {
    const errStr = "Decrypt(): Decryption failed: " + err
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }
  if (!plaintext) {
    const errStr = "Decrypt(): Decryption failed for unknown reason"
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }
  return Buffer.from(plaintext);
}

export function DecryptionDecompileFields(
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

export function DecryptionReplaceEncryptedField(
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
