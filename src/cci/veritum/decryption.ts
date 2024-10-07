
import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { logger } from "../../core/logger";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { VerityError, Settings, ApiMisuseError } from "../../core/settings";
import { cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields } from "../cube/cciFields";

import sodium from 'libsodium-wrappers-sumo'


//###
// "Public" functions
//###


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
// Decryption-related "private" functions
//###

class DecryptionFailed extends VerityError { name = "Decryption failed" }

function DecryptionRetrieveNonce(fields: cciFields): Buffer {
  const nonce = fields.getFirst(cciFieldType.CRYPTO_NONCE)?.value;
  if (Settings.RUNTIME_ASSERTIONS && nonce?.length !== NetConstants.CRYPTO_NONCE_SIZE) {
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Nonce is missing or invalid"
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }
  return nonce;
}

function DecryptionRetrieveCiphertext(fields: cciFields): Buffer {
  const ciphertext: Buffer = fields.getFirst(cciFieldType.ENCRYPTED)?.value;
  if (Settings.RUNTIME_ASSERTIONS && !ciphertext?.length) {
    const errStr = "Decrypt(): Cannot decrypt supplied fields as Ciphertext is missing or invalid";
    logger.trace(errStr);
    throw new DecryptionFailed(errStr);
  }
  return ciphertext;
}

function DecryptionDeriveKey(
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


function DecryptionSymmetricDecrypt(
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
