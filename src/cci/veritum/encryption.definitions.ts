import type { VerityFields } from "../cube/verityFields";
import type { Identity } from "../identity/identity";

import { FieldType } from "../cube/cciCube.definitions";

export type EncryptionRecipients = Identity|Iterable<Identity>|Buffer|Iterable<Buffer>;
export interface CciEncryptionParams {
  /**
   * Excludes the listed field types from encryption, instead keeping them as
   * plaintext together with the encrypted message.
   * May be used for example to split a single message into a private and public
   * part, or for custom key distribution schemes.
   * This is generally NOT RECOMMENDED as it may cause information leaks.
   * Only use this if you know what you're doing please.
   **/
  excludeFromEncryption?: number[],

  /**
   * @deprecated
   * If both sender and recipient already know which nonce to use, please
   * provide it here. It will not be included in the output.
   * Otherwise, a random nonce will be rolled and included in the output.
   * Marked as deprecated as it can very easily lead to insecure use.
   */
  nonce?: Buffer,

  /**
   * If you already have a shared secret with the recipient (and you're positive
   * that the recipient thinks so as well), you can supply it here to re-use
   * this shared secret rather than generating a new one. Saves some CPU load.
   * Only use this if you know what you're doing please.
   */
  symmetricKey?: Buffer,

  /**
   * @deprecated
   * If for some reason you want to encrypt your Veritum using a specific sender
   * key, please provide the public part here.
   * Marked as deprecated as we prefer using ephemeral sender keys which are
   * auto-generated one layer up at the VeritumEncryption stage.
   */
  senderPubkey?: Buffer,
  /**
   * @deprecated
   * If for some reason you want to encrypt your Veritum using a specific sender
   * key, please provide the private part here.
   * Marked as deprecated as we prefer using ephemeral sender keys which are
   * auto-generated one layer up at the VeritumEncryption stage.
   */
  senderPrivateKey?: Buffer,

  /**
   * To automatically encrypt a Veritum only intended for a specific recipient
   * or list of recipients, supply their Identities or encryption public keys here.
   * Don't forget to also supply the encryptionPrivateKey.
   */
  recipients?: EncryptionRecipients,

  /**
   * When true, include the public key of the sender in the header.
   * You don't want to set this manually.
   * By default, the sender's pubkey is included in the first chunk of each
   * encrypted Veritum.
   **/
  pubkeyHeader?: boolean;

  /**
   * When true, include the nonce in the header.
   * You don't want to set this manually.
   * By default, the nonce is included in the first chunk of each encrypted
   * Veritum.
   **/
  nonceHeader?: boolean;

  /**
   * When true, start the encrpyted chunk with a number of symmetric key slots,
   * used to bootstrap hybrid encryption for multiple recipients.
   * You don't want to set this manually.
   * By default, the first chunk of each encrypted Veritum starts with a
   * certain number of key slots.
   **/
  keyslotHeader?: boolean;
}

export interface CciDecryptionParams {
  predefinedNonce?: Buffer,
  preSharedKey?: Buffer,
  recipientPrivateKey?: Buffer,
}

/**
 * An extended output format for chunk encryption/decryption exposing
 * cryptographic metadata.
 * You probably don't need this.
 */
export interface CryptStateOutput {
  result: VerityFields,
  symmetricKey: Buffer,
  nonce: Buffer,
}

/**
 * Compared to ContinuationDefaultExclusions, note the lack of PADDING.
 * This is because padding is used in continuation chains to indicate that
 * two adjacent variable-length fields of the same type should *not* be joined.
 * As Veritum encryption is split-then-encrypt, padding field must not be
 * dropped at the encryption stage.
 **/
export const VeritumEncryptionExclusions: number[] = [
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
