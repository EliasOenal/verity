import { VerityError } from '../../core/settings';

import { Buffer } from 'buffer'
import sodium from 'libsodium-wrappers-sumo'

export interface KeyPair {
  privateKey: Buffer;
  publicKey: Buffer;
}

/** Prepare a KDF context string exactly sodium.crypto_kdf_CONTEXTBYTES long.
 *  This replicates the previous libsodium-wrappers behaviour:
 *  - encode the JS string as UTF-8 bytes (Buffer.from(context, 'utf8'))
 *  - copy up to crypto_kdf_CONTEXTBYTES bytes (truncate if longer)
 *  - zero-pad if shorter
 *  - return a JS string where each character corresponds to one byte (latin1 / binary)
 *
 *  Must be called only after sodium.ready.
 */
function prepareKdfContextString(context: string): string {
  const ctxLen = sodium.crypto_kdf_CONTEXTBYTES;
  const buf = Buffer.alloc(ctxLen); // zero-filled

  if (context && context.length > 0) {
    const inBuf = Buffer.from(context, 'utf8'); // same default encoding as Buffer.from(context)
    // copy up to ctxLen bytes (truncate if longer)
    inBuf.copy(buf, 0, 0, Math.min(inBuf.length, ctxLen));
  }

  // Return a string where each character represents a single byte from buf.
  // 'latin1' (alias 'binary') maps bytes 0..255 to characters 0..255 one-to-one.
  return buf.toString('latin1');
}

/** !!! May only be called after awaiting sodium.ready !!! */
export function deriveSigningKeypair(
    masterKey: Uint8Array,
    subkeyIndex: number,
    context: string,
): KeyPair {
  // prepare fixed-size context string;
  // this exactly matches the behaviour of previous libsodium versions
  const ctxString = prepareKdfContextString(context);

  // derive seed
  const derivedSeed = sodium.crypto_kdf_derive_from_key(
    sodium.crypto_sign_SEEDBYTES, subkeyIndex, ctxString,
    masterKey, "uint8array");
  // create key pair
  const rawKeyPair = sodium.crypto_sign_seed_keypair(derivedSeed, "uint8array");
  // upgrade keys to Buffers
  return {
    privateKey: Buffer.from(rawKeyPair.privateKey),
    publicKey: Buffer.from(rawKeyPair.publicKey),
  }
}

/** !!! May only be called after awaiting sodium.ready !!! */
export function deriveEncryptionKeypair(
    masterKey: Buffer,
    subkeyIndex: number,
    context: string,
): KeyPair {
  // prepare fixed-size context string (UTF-8 bytes truncated/padded -> latin1 string)
  const ctxString = prepareKdfContextString(context);

  // derive seed
  const derivedSeed = sodium.crypto_kdf_derive_from_key(
    sodium.crypto_sign_SEEDBYTES, subkeyIndex, ctxString,
    masterKey, "uint8array");
  // create key pair
  const rawKeyPair = sodium.crypto_box_seed_keypair(derivedSeed, "uint8array");
  // upgrade keys to Buffers
  return {
    privateKey: Buffer.from(rawKeyPair.privateKey),
    publicKey: Buffer.from(rawKeyPair.publicKey),
  }
}

export class CrpytographyError extends VerityError { name = "EncryptionError" }
export class KeyMismatchError extends CrpytographyError { name = "KeyMismatchError" }