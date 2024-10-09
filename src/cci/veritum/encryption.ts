import { FieldDefinition, FieldParser } from "../../core/fields/fieldParser";
import { NetConstants } from "../../core/networking/networkDefinitions";
import { ApiMisuseError, Settings, VerityError } from "../../core/settings";
import { cciFieldLength, cciFieldType } from "../cube/cciCube.definitions";
import { cciField } from "../cube/cciField";
import { cciFields, cciFrozenFieldDefinition } from "../cube/cciFields";
import { Continuation, CryptoError } from "./continuation";

import { Identity } from "../identity/identity";

import { isIterableButNotBuffer } from "../../core/helpers/misc";
import { cciCube } from "../cube/cciCube";
import { CubeKey, CubeRelationshipError, CubeType } from "../../core/cube/cube.definitions";
import { cciRelationship, cciRelationshipType } from "../cube/cciRelationship";
import { CubeCreateOptions } from "../../core/cube/cube";

import { logger } from "../../core/logger";

import sodium from 'libsodium-wrappers-sumo'

export type EncryptionRecipients = Identity|Iterable<Identity>|Buffer|Iterable<Buffer>;
export interface CciEncryptionParams {
  /**
   * Excludes the listed field types from encryption, instead keeping them as
   * plaintext together with the encrypted message.
   * This is NOT RECOMMENDED as it may cause information leaks.
   **/
  excludeFromEncryption?: number[],

  /**
   * Includes the sender's public key in the encrypted message.
   */
  includeSenderPubkey?: Buffer,

  /**
   * If both sender and recipient already know which nonce to use, please
   * provide it here. It will not be included in the output.
   * Otherwise, a random nonce will be rolled and included in the output.
   */
  predefinedNonce?: Buffer,

  preSharedKey?: Buffer,
  senderPrivateKey?: Buffer,
  recipients?: EncryptionRecipients,
}

//###
// "Public" functions
//###

/**
 * Encrypts a CCI field set
 * Note: Caller must await sodium.ready before calling.
 */
 // Maybe TODO: Check if supplied combination of option conforms to the CCI
 // Encryption spec, and either refuse or warn if it doesn't.
export function Encrypt(
    fields: cciFields,
    options: CciEncryptionParams = {},
): cciFields {
  // normalise input
  const recipientPubkeys = Array.from(EncryptionNormaliseRecipients(options.recipients));

  // Prepare the fields to encrypt, filtering out excluded fields and garbage
  const {toEncrypt, output} = EncryptionPrepareFields(fields, options);
  // Make ENCRYPTED field
  const encrypted: cciField = EncryptionAddEncryptedField(output);
  let offset = 0;

  // Include cryptographic metadata in output if requested:
  // Public key
  // TODO sanitise input
  if (options.includeSenderPubkey) {
    offset = EncryptionAddSubfield(encrypted, options.includeSenderPubkey, offset);
  }
  // Nonce
  let nonce: Buffer;
  if (options.predefinedNonce) nonce = options.predefinedNonce;
  else {
    nonce = EncryptionRandomNonce();
    offset = EncryptionAddSubfield(encrypted, nonce, offset);
  }
  // Determine symmetric key. There's three cases:
  // 1) There's a pre-shared key, in which case there's nothing to do.
  // 2) If there's only a single recipient, we directly derive the key using the
  // recipient's public key and the sender's private key.
  // 3) However, if there are multiple recipients, we chose a random key and
  //   include an individual encrypted version of it for each recipient.
  let symmetricPayloadKey: Buffer;
  if (options.preSharedKey) symmetricPayloadKey = options.preSharedKey;
  else {  // actual key derivation
    // sanitise input
    if (!recipientPubkeys.length || !options.senderPrivateKey) {
      throw new ApiMisuseError("Encryption: Must either supply a pre-shared key, or sender's private key and at least one recipient's public key");
    }
    if (recipientPubkeys.length === 1) {  // single recipient case
      symmetricPayloadKey = EncryptionDeriveKey(options.senderPrivateKey, recipientPubkeys[0]);
    } else {  // multiple recipient case
      // Generate a random symmetric key
      symmetricPayloadKey = EncryptionRandomKey();
      // Make key distribution fields and include them with the encrypted message
      const keyDistributionSlots: Buffer = EncryptionKeyDistributionSlots(
        symmetricPayloadKey, options.senderPrivateKey, recipientPubkeys, nonce);
      offset = EncryptionAddSubfield(encrypted, keyDistributionSlots, offset);
    }
  }

  // Pad up the plaintext if necessary to fill the whole remaining ENCRYPTED space
  const spaceAvailable = encrypted.length  // ENCRYPTED field site
    - offset  // less space already used
    - toEncrypt.getByteLength() // less plaintext size
    - sodium.crypto_secretbox_MACBYTES // less MAC size
  if (spaceAvailable > 0) {
    const padding: cciField = cciField.Padding(spaceAvailable);  // TODO BUGBUG this may use a CCI end marker which may propagate through and clash with application logic
    toEncrypt.insertFieldBeforeBackPositionals(padding);
  }

  // Compile the plaintext fields to a nice flat binary blob that we can encrypt
  const plaintext: Buffer = EncryptionCompileFields(toEncrypt);

  // Finally, perform encryption the encryption
  const ciphertext: Buffer = EncryptionSymmetricEncrypt(plaintext, nonce, symmetricPayloadKey);
  // Verify sizes work out
  if(ciphertext.length != (encrypted.length - offset)) {
    throw new CryptoError(`Encrypt(): I messed up my calculations, ending up with ${ciphertext.length} bytes of ciphertext but only ${encrypted.length-offset} bytes left for it. This should never happen.`);
  }
  offset = EncryptionAddSubfield(encrypted, ciphertext, offset);

  // TODO randomise timestamp
  // TODO ensure hashcash "nonce" is randomised, e.g. not always larger than the
  // plaintext one

  return output;
}


export function EncryptionOverheadBytes(
    options: CciEncryptionParams = {},
    fieldDefinition: FieldDefinition = cciFrozenFieldDefinition,
): number {
  // minimal overhead is the ENCRYPTED field header and the payload MAC
  let overhead: number =
    FieldParser.getFieldHeaderLength(cciFieldType.ENCRYPTED, fieldDefinition) +
    sodium.crypto_secretbox_MACBYTES;
  // account for nonce if not pre-shared
  if (options.predefinedNonce === undefined) {
    overhead += sodium.crypto_secretbox_NONCEBYTES;
  }
  // calculate key agreement overhead unless there's a pre-shared key
  if (options.preSharedKey === undefined) {
    // account for sender's public key if included
    if (options.includeSenderPubkey !== undefined) {
      overhead += sodium.crypto_box_PUBLICKEYBYTES;
    }
    // account for key slots if there are multiple recipients
    const recipientPubkeys =
      Array.from(EncryptionNormaliseRecipients(options.recipients));
    if (recipientPubkeys.length > 1) {
      overhead += recipientPubkeys.length * sodium.crypto_secretbox_KEYBYTES;
    }
  }
  return overhead;
}








//###
// Encryption-related "private" functions
//###

//
// Encryption: Data normalisation helpers
//

function *EncryptionNormaliseRecipients(recipients: EncryptionRecipients): Generator<Buffer> {
  if (!recipients) return;
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
// CCI Field helpers
//

function EncryptionPrepareFields(
    fields: cciFields,
    options: CciEncryptionParams
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
      // Make a verbatim copy, except for garbage fields PADDING and CCI_END.
      // Using the default exclusion list, this ensures all mandatory core fields
      // are adopted from the unencrypted input.
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


/** Add the ENCRYPTED field to the output message, using up all available space */
function EncryptionAddEncryptedField(output: cciFields): cciField {
  const size: number = output.bytesRemaining() -
    FieldParser.getFieldHeaderLength(
      cciFieldType.ENCRYPTED, output.fieldDefinition);
  const field: cciField = cciField.Encrypted(Buffer.alloc(size));
  output.insertFieldAfterFrontPositionals(field);
  return field;
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

// End of CCI Field helpers

//
// Encrypted sub-field helpers
//

/**
 * Adds a headerless encrypted subfield,
 * i.e. just copies data to the target's given offset and return the new offset.
 */
function EncryptionAddSubfield(
    output: cciField,
    data: Buffer,
    offset: number,
): number {
  const written: number = data.copy(output.value, offset);
  return offset + written;
}


function EncryptionKeyDistributionSlots(
  symmetricPayloadKey: Buffer,
  privateKey: Uint8Array,
  recipientPubkeys: Iterable<Uint8Array>,
  nonce: Uint8Array,
): Buffer {
  const slots: Uint8Array[] = [];
  // Encrypt the symmetric key for each recipient
  for (const recipientPubKey of recipientPubkeys) {
    // run x25519 to derive slot key
    const slotKey: Uint8Array =
      sodium.crypto_box_beforenm(recipientPubKey, privateKey);
    // encrypt the payload key with the slot key (w/o MAC)
    const encryptedKey: Uint8Array = sodium.crypto_stream_xchacha20_xor(
      symmetricPayloadKey, nonce, slotKey);
    // sanity check lengths
    if (Settings.RUNTIME_ASSERTIONS &&
        encryptedKey.length !== slotKey.length ||
        slotKey.length !== NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE
    ) {
      throw new CryptoError(`EncryptionKeyDistributionSlots(): Encrypted slot key size of ${encryptedKey.length}, plain slot key size of ${slotKey.length} and NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE of ${NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE} do not match. This should never happen.`);
    }
    // commit slot
    slots.push(encryptedKey);
  }
  // return all slots as a single binary blob
  const ret = Buffer.concat(slots);
  return ret;
}


// TODO update or get rid of
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

// End of encrypted sub-field helpers


//
// Encryption: Cryptographic primitive helpers
//

function EncryptionDeriveKey(
    privateKey: Buffer,
    publicKey: Buffer,
): Buffer {
  // sanity-check input
  if (privateKey?.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new ApiMisuseError(`Encrypt(): privateKey must be ${sodium.crypto_box_SECRETKEYBYTES} bytes, got ${privateKey?.length}. Check: Invalid Key supplied? Incompatible libsodium version?`);
  }

  const symmetricPayloadKey: Uint8Array = sodium.crypto_box_beforenm(
    publicKey, privateKey);
  if (Settings.RUNTIME_ASSERTIONS &&
      symmetricPayloadKey.length !== sodium.crypto_secretbox_KEYBYTES
  ){
    throw new CryptoError(`Libsodium's generated symmetric key size of ${symmetricPayloadKey.length} does not match sodium.crypto_secretbox_KEYBYTES === ${sodium.crypto_secretbox_KEYBYTES}. This should never happen.`);
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
): Buffer {
  // Perform encryption
  const ciphertext: Uint8Array = sodium.crypto_secretbox_easy(
    plaintext, nonce, symmetricPayloadKey);
  return Buffer.from(ciphertext);
}

// End of encryption cryptographic primitive helpers
