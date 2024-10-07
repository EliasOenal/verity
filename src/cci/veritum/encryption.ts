import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { ApiMisuseError, Settings, VerityError } from "../../core/settings";
import { cciFieldLength, cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields } from "../cube/cciFields";
import { Continuation, CryptoError } from "./continuation";

import { Identity } from "../identity/identity";

import { logger } from "../../core/logger";

import sodium from 'libsodium-wrappers-sumo'
import { isIterableButNotBuffer } from "../../core/helpers/misc";
import { cciCube } from "../cube/cciCube";
import { CubeKey, CubeRelationshipError, CubeType } from "../../core/cube/cube.definitions";
import { cciRelationship, cciRelationshipType } from "../cube/cciRelationship";
import { CubeCreateOptions } from "../../core/cube/cube";

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
export function Encrypt(
    fields: cciFields,
    privateKey: Buffer,
    recipients: EncryptionRecipients,
    options: CciEncryptionOptions = {},
): cciFields {
  // normalise input
  const recipientPubkeys = Array.from(EncryptionNormaliseRecipients(recipients));

  // Prepare the fields to encrypt, filtering out excluded fields and garbage
  const {toEncrypt, output} = EncryptionPrepareFields(fields, options);

  // If requested, include the public key with the encrypted message
  if (options.includeSenderPubkey) output.insertFieldBeforeBackPositionals(
    cciField.CryptoPubkey(options.includeSenderPubkey));

  // Roll a random nonce and include it with the encrypted message
  const nonce: Buffer = EncryptionRandomNonce();
  EncryptionIncludeNonce(output, nonce);

  // Determine symmetric key. There's two cases:
  // - If there's only a single recipient, we directly derive the key using the
  // recipient's public key and the sender's private key.
  // - However, if there are multiple recipients, we chose a random key and
  //   include an individual encrypted version of it for each recipient.
  let symmetricPayloadKey: Buffer;
  if (recipientPubkeys.length === 1) {
    symmetricPayloadKey = EncryptionDeriveKey(privateKey, recipientPubkeys[0]);
  } else {
    // Generate a random symmetric key
    symmetricPayloadKey = EncryptionRandomKey();
    // Make key distribution fields and include them with the encrypted message
    const keyDistributionFields = EncryptionKeyDistributionFields(
      symmetricPayloadKey, privateKey, recipientPubkeys, nonce);
    output.insertFieldBeforeBackPositionals(...keyDistributionFields);
  }

  // Compile the plaintext fields to a nice flat binary blob that we can encrypt
  const plaintext: Buffer = EncryptionCompileFields(toEncrypt);

  // Finally, perform encryption the encryption
  const encryptedField: cciField = EncryptionSymmetricEncrypt(plaintext, nonce, symmetricPayloadKey);
  // Add the encrypted content to the output field set
  output.insertFieldBeforeBackPositionals(encryptedField);

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

//
// Encryption: Data normalisation helpers
//

function *EncryptionNormaliseRecipients(recipients: EncryptionRecipients): Generator<Buffer> {
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


//
// Encryption: Field helpers
//

function EncryptionPrepareFields(
    fields: cciFields,
    options: CciEncryptionOptions
): {toEncrypt: cciFields, output: cciFields} {
  // set default options
  options.excludeFromEncryption ??= Continuation.ContinuationDefaultExclusions;

  // Prepare list of fields to encrypt. This is basically all CCI fields,
  // but not core Cube fields.
  const toEncrypt: cciFields = new cciFields([], fields.fieldDefinition);
  const output: cciFields = new cciFields([], fields.fieldDefinition);
  for (const field of fields.all) {
    if (!options.excludeFromEncryption.includes(field.type)) {
      // Add the field to the list of fields to encrypt
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

  // Handle special case:
  // It is allowed to send an encrypted message just for the purpose of
  // exchanging keys; in that case there is no message to encrypt.
  // In this case, encrypt an empty PADDING field.
  if (toEncrypt.all.length === 0) {
    const padding: cciField = new cciField(cciFieldType.PADDING, Buffer.alloc(0));
    toEncrypt.appendField(padding);
  }
  return {toEncrypt, output};
}


function EncryptionCompileFields(toEncrypt: cciFields): Buffer {
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


function EncryptionKeyDistributionFields(
  symmetricPayloadKey: Buffer,
  privateKey: Uint8Array,
  recipientPubkeys: Iterable<Uint8Array>,
  nonce: Uint8Array,
): cciField[] {
const ret: cciField[] = [];
// Encrypt the symmetric key for each recipient
for (const recipientPubKey of recipientPubkeys) {
  const encryptedKey = sodium.crypto_box_easy(symmetricPayloadKey, nonce, recipientPubKey, privateKey);
  const field = cciField.CryptoKey(Buffer.from(encryptedKey));
  ret.push(field);
}
return ret;
}


function EncryptionMakeKeyDistributionCubes(
  nonce: Buffer,
  keyDistributionFields: cciField[],
  refersTo: CubeKey,
  senderPublicKey?: Buffer,
  cubeType: CubeType = CubeType.FROZEN,
  options: CubeCreateOptions = {},
): cciCube[] {
// sanitity-check input if enabled
if (Settings.RUNTIME_ASSERTIONS) {
  if (refersTo.length !== NetConstants.CUBE_KEY_SIZE) {
    throw new CubeRelationshipError(`Invalid refersTo length: ${refersTo.length} != ${NetConstants.CUBE_KEY_SIZE}`);
  }
  if (senderPublicKey?.length !== NetConstants.PUBLIC_KEY_SIZE) {
    throw new CubeRelationshipError(`Invalid senderPublicKey length: ${senderPublicKey?.length} != ${NetConstants.PUBLIC_KEY_SIZE}`);
  }
}

// prepare fields to be present in every key distribution Cube
const pubkeyField = (senderPublicKey !== undefined) ?
  cciField.CryptoPubkey(senderPublicKey) : undefined;
const nonceField = cciField.CryptoNonce(nonce);
const relObj = new cciRelationship(cciRelationshipType.INTERPRETS, refersTo);
const relField = cciField.RelatesTo(relObj);

// Calculate the amount of key distribution Cubes needed:
// First, let's find out how many bytes are available for CRYPTO_KEY fields
// by creating a test Cube containing all fields that are required in each
// key distribution Cube except the CRYPTO_KEY fields.
const sizeTester = cciCube.Create(cubeType, {
  ...options,
  fields: [
    ...(pubkeyField? [pubkeyField] : []),
    nonceField,
    relField
  ],
});
const bytesPerCube = sizeTester.bytesRemaining();

// Calculate the number of key distribution Cubes needed
const keyFieldsSize = cciFieldLength[cciFieldType.CRYPTO_KEY] +
  sizeTester.fieldParser.getFieldHeaderLength(cciFieldType.CRYPTO_KEY);
const keyFieldsPerCube = Math.floor(bytesPerCube / keyFieldsSize);
const cubesRequired = Math.ceil(keyDistributionFields.length / keyFieldsPerCube);

// If the amount of key distribution fields does not devide the number of
// key distribution Cubes evenly, which it usually won't, add extra fake
// fields for padding.
// This is to ensure uniformity and avoid leaking the amount of recipients.
const fieldsProvisioned = keyFieldsPerCube * cubesRequired;
let paddingRequired = fieldsProvisioned - keyDistributionFields.length;
while (paddingRequired > 0) {
  // create a random fake field
  const randomData = Buffer.from(sodium.randombytes_buf(
    cciFieldLength[cciFieldType.CRYPTO_KEY]));
  const paddingField = cciField.CryptoKey(randomData);
  // insert it at a random location
  const randomLocation = Math.floor(Math.random() * keyDistributionFields.length);
  keyDistributionFields.splice(randomLocation, 0, paddingField);
  paddingRequired--;
}
if (Settings.RUNTIME_ASSERTIONS &&
    keyDistributionFields.length !== fieldsProvisioned) {
  throw new VerityError("I can't do math");  // TODO remove
}

// All prepraration done, sculpt the Cubes
const cubes: cciCube[] = [];
for (let i = 0; i < cubesRequired; i++) {
  const cube = cciCube.Create(cubeType, {
    ...options,
    fields: keyDistributionFields.slice(i * keyFieldsPerCube, (i + 1) * keyFieldsPerCube),
  });
  cubes.push(cube);
}
return cubes;
}


function EncryptionIncludePubkey(output: cciFields, pubkey: Buffer): void {
  output.insertFieldBeforeBackPositionals(cciField.CryptoPubkey(pubkey));
}

function EncryptionIncludeNonce(output: cciFields, nonce: Buffer): void {
  output.insertFieldBeforeBackPositionals(cciField.CryptoNonce(nonce));
}

// End of encryption field helpers


//
// Encryption: Cryptographic primitive helpers
//

function EncryptionDeriveKey(
    privateKey: Buffer,
    recipientPubkey: Buffer,
): Buffer {
  // sanity-check input
  if (privateKey?.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new ApiMisuseError(`Encrypt(): privateKey must be ${sodium.crypto_box_SECRETKEYBYTES} bytes, got ${privateKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
  }

  const symmetricPayloadKey: Uint8Array = sodium.crypto_box_beforenm(
    recipientPubkey, privateKey);
  if (Settings.RUNTIME_ASSERTIONS &&
      symmetricPayloadKey.length !== NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE
  ){
    throw new CryptoError(`Libsodium's generated symmetric key size of ${symmetricPayloadKey.length} does not match NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE === ${NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE}. This should never happen. Using an incompatible version of libsodium maybe?`);
  }

  return Buffer.from(symmetricPayloadKey);
}

function EncryptionRandomKey(): Buffer {
  return Buffer.from(sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES));
}

function EncryptionRandomNonce(): Buffer {
  // Create a random nonce
  const nonce: Buffer = Buffer.from(
    sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES));
  if (Settings.RUNTIME_ASSERTIONS && nonce.length !== NetConstants.CRYPTO_NONCE_SIZE) {
    throw new CryptoError(`Libsodium's generated nonce size of ${nonce.length} does not match NetConstants.CRYPTO_NONCE_SIZE === ${NetConstants.CRYPTO_NONCE_SIZE}. This should never happen. Using an incompatible version of libsodium maybe?`);
  }
  return nonce;
}


function EncryptionSymmetricEncrypt(
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

// End of encryption cryptographic primitive helpers


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
