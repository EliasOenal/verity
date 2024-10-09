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
  senderPubkey?: Buffer,

  /**
   * If both sender and recipient already know which nonce to use, please
   * provide it here. It will not be included in the output.
   * Otherwise, a random nonce will be rolled and included in the output.
   */
  nonce?: Buffer,

  symmetricKey?: Buffer,

  /**
   * To encrypt a Veritum on compilation, supply your encryption private key here.
   * Don't forget to also supply the recipient or list of recipients.
   */
  senderPrivateKey?: Buffer,

  /**
   * To automatically encrypt a Veritum only intended for a specific recipient
   * or list of recipients, supply their Identities or encryption public keys here.
   * Don't forget to also supply the encryptionPrivateKey.
   */
  recipients?: EncryptionRecipients,

  // Header flags
  pubkeyHeader?: boolean;
  nonceHeader?: boolean;
  keyslotHeader?: boolean;
}

export interface CryptStateOutput {
  result: cciFields,
  symmetricKey: Buffer,
  nonce: Buffer,
}

//###
// "Public" functions
//###

/**
 * Encrypts a single CCI Cube's field set.
 * Do not use this unless you know what you're doing.
 * Applications will usually just use Veritum.compile() instead which can
 * automatically handle encryption for you.
 * Note: Caller must await sodium.ready before calling.
 * @param params - The encryption parameters, e.g. a pre-shared key, or your
 *   private key and some recipient's public key.
 *   Ensure the combination you supply conforms to the CCI Encryption spec,
 *   will throw ApiMisuseError otherwise.
 * @throws ApiMisuseError - In case the specified combination of params does
 *   not comply with the CCI Encryption spec
 */
export function Encrypt(
    fields: cciFields,
    params: CciEncryptionParams,
): cciFields;
export function Encrypt(
    fields: cciFields,
    outputState: true,
    params: CciEncryptionParams,
): CryptStateOutput;

export function Encrypt(
    fields: cciFields,
    param2: true|CciEncryptionParams,
    param3?: CciEncryptionParams,
): cciFields|CryptStateOutput {
  // determine function variant
  let params: CciEncryptionParams = param2===true? param3 : param2;
  const outputState: boolean = param2===true? true: false;

  // select CCI Encryption scheme variant
  params = EncryptionPrepareParams(params);

  const output: CryptStateOutput = EncryptPrePlanned(fields, params);

  if (outputState) return output;
  else return output.result;
}


/**
 * Decide and prepare encryption mode and associated parameters.
 * This function is not idempotent; unless you know exactly what you're doing,
 * only call this once per session.
 * In fact, don't call this at all unless you know what you're doint, just use
 * Encrypt().
 */
export function EncryptionPrepareParams(
  params: CciEncryptionParams,
): CciEncryptionParams {
  // normalise input
  params.recipients = Array.from(EncryptionNormaliseRecipients(params.recipients));
  // sanitise input
  EncryptionValidateParams(params);  // throws if invalid

  // If nonce is not supplied, generate it and flag it as to be included with message
  if (!params.nonce) {
    params.nonce = EncryptionRandomNonce();
    params.nonceHeader = true;
  }

  // Determine symmetric key. There's three cases:
  // 1) There's a pre-shared key, in which case there's nothing to do.
  // 2) If there's only a single recipient, we directly derive the key using the
  // recipient's public key and the sender's private key.
  // 3) However, if there are multiple recipients, we chose a random key and
  //   include an individual encrypted version of it for each recipient.
  if (!params.symmetricKey) {
    // sanitise input
    if (!(params.recipients as Array<Buffer>).length || !params.senderPrivateKey) {
      throw new ApiMisuseError("Encryption: Must either supply a pre-shared key, or sender's private key and at least one recipient's public key");
    }
    // Key agreement taking place -- flag sender's pubkey as required
    params.pubkeyHeader = true;
    if ((params.recipients as Array<Buffer>).length === 1) {  // single recipient case
      params.symmetricKey =
        EncryptionDeriveKey(params.senderPrivateKey, params.recipients[0]);
      // No key slots, so mark keyslot header as absent
      params.keyslotHeader = false;
    } else {  // multiple recipient case
      // Generate a random symmetric key
      params.symmetricKey = EncryptionRandomKey();
      // Mark key slots as required
      params.keyslotHeader = true;
    }
  }

  return params;
}


/**
 * Performs a CCI encryption according to the scheme variant as planned
 * in params.
 * Don't call this directly unless you know what you're doing, use Encrypt()
 * instead.
 */
export function EncryptPrePlanned(
  fields: cciFields,
  params: CciEncryptionParams,
): CryptStateOutput {
  // Prepare the fields to encrypt, filtering out excluded fields and garbage
  const {toEncrypt, output} = EncryptionPrepareFields(fields, params);
  // Make ENCRYPTED field
  const encryptedField: cciField = EncryptionAddEncryptedField(output);
  // Write meta information to the encrypted blob as required by the selected
  // CCI encryption scheme variant4
  let offset: number = EncryptionWriteMeta(encryptedField.value, params);

  // Pad up the plaintext if necessary to fill the whole remaining ENCRYPTED space
  const spaceAvailable = encryptedField.length  // ENCRYPTED field site
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
  const ciphertext: Buffer = EncryptionSymmetricEncrypt(
    plaintext, params.nonce, params.symmetricKey);
  // Verify sizes work out
  if(ciphertext.length !== (encryptedField.length - offset)) {
    throw new CryptoError(`Encrypt(): I messed up my calculations, ending up with ${ciphertext.length} bytes of ciphertext but only ${encryptedField.length-offset} bytes left for it. This should never happen.`);
  }
  offset = EncryptionAddSubfield(encryptedField.value, ciphertext, offset);

  // TODO randomise timestamp
  // TODO ensure hashcash "nonce" is randomised, e.g. not always larger than the
  // plaintext one

  return {
    result: output,
    symmetricKey: params.symmetricKey,
    nonce: params.nonce,
  }
}


export function EncryptionOverheadBytes(
  options: CciEncryptionParams = {},
  fieldDefinition: FieldDefinition = cciFrozenFieldDefinition,
): number {
  // sanity-check: all header must have been planned
  if (options.pubkeyHeader === undefined ||
      options.nonceHeader === undefined ||
      options.keyslotHeader === undefined) {
    throw new ApiMisuseError("EncryptionOverheadBytes() may only be called after the scheme variant has been defined by EncryptionPrepareParams()");
  }
  // minimal overhead is the ENCRYPTED field header and the payload MAC
   let overhead: number =
    FieldParser.getFieldHeaderLength(cciFieldType.ENCRYPTED, fieldDefinition) +
    sodium.crypto_secretbox_MACBYTES;
  // account for additional metadata as planned in params
  if (options.pubkeyHeader) overhead += sodium.crypto_box_PUBLICKEYBYTES;
  if (options.nonceHeader) overhead += sodium.crypto_secretbox_NONCEBYTES;
  if (options.keyslotHeader) {
    // account for key slots if there are multiple recipients
    overhead +=
      (options.recipients as Buffer[]).length *  // recipients already normalised
      sodium.crypto_secretbox_KEYBYTES;
  }
  return overhead;
}


/**
 * Derived <count> nonces from a seed nonce by repeatedly hashing them.
 * The seed nonce is kept as the first nonce.
 */
export function EncryptionHashNonces(seed: Buffer, count: number): Buffer[] {
  const ret: Buffer[] = [seed];
  let last: Buffer = seed;
  for (let i=0; i<count; i++) {
    last = EncryptionHashNonce(last);
    ret.push(last);
  }
  return ret;
}

export function EncryptionHashNonce(nonce: Buffer): Buffer {
  return Buffer.from(sodium.crypto_generichash(
    sodium.crypto_secretbox_NONCEBYTES, nonce));

}



//###
// Encryption-related "private" functions
//###


//
// Encryption: Data sanitation normalisation helpers
//

/**
 * Validates the combination of params.
 * This is a soft validation, any workable combination will be excepted
 * and superfluous params will be silently ignored.
 */
function EncryptionValidateParams(params: CciEncryptionParams): true {
  // allow pre-shared keys, with or without implicit nonce
  if (params.symmetricKey?.length === sodium.crypto_secretbox_KEYBYTES &&
       (params.nonce === undefined ||
        params.nonce.length === sodium.crypto_secretbox_NONCEBYTES)
  ) {
    return true;
  }
  // allow any variant of key agreement
  else if (
    params.senderPubkey?.length === sodium.crypto_box_PUBLICKEYBYTES &&
    params.senderPrivateKey?.length === sodium.crypto_box_SECRETKEYBYTES &&
    params.recipients !== undefined
  ) {
    // note: params.recipients will be validated later in EncryptionNormaliseRecipients
    return true;
  }
  else throw new ApiMisuseError(`Encrypt: Invalid combination of parameters`);
}

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
// Encrypted sub-field functions
//

function EncryptionWriteMeta(cryptoBlob: Buffer, params: CciEncryptionParams): number {
  let offset = 0;

  // Include cryptographic metadata in output if requested
  // Public key
  if (params.senderPubkey && params.pubkeyHeader) {
    offset = EncryptionAddSubfield(cryptoBlob, params.senderPubkey, offset);
  }
  // Nonce
  if (params.nonce && params.nonceHeader) {
    offset = EncryptionAddSubfield(cryptoBlob, params.nonce, offset);
  }
  // Key slots
  if (params.keyslotHeader) {
    const keyDistributionSlots: Buffer = EncryptionKeyDistributionSlots(
      params.symmetricKey, params.senderPrivateKey,
      params.recipients as Array<Buffer>, params.nonce,
    );
    offset = EncryptionAddSubfield(cryptoBlob, keyDistributionSlots, offset);
  }
  return offset;
}

/**
 * Adds a headerless encrypted subfield,
 * i.e. just copies data to the target's given offset and return the new offset.
 */
function EncryptionAddSubfield(
    cryptoBlob: Buffer,
    data: Buffer,
    offset: number,
): number {
  const written: number = data.copy(cryptoBlob, offset);
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
