import sodium from 'libsodium-wrappers-sumo'
import { VerityError } from '../../core/settings';

export interface KeyPair {
  privateKey: Buffer;
  publicKey: Buffer;
}

/** !!! May only be called after awaiting sodium.ready !!! */
export function deriveSigningKeypair(
    masterKey: Buffer,
    subkeyIndex: number,
    context: string,
): KeyPair {
  // derive seed
  const derivedSeed = sodium.crypto_kdf_derive_from_key(
    sodium.crypto_sign_SEEDBYTES, subkeyIndex, context,
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
  // derive seed
  const derivedSeed = sodium.crypto_kdf_derive_from_key(
    sodium.crypto_sign_SEEDBYTES, subkeyIndex, context,
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
