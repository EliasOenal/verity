import sodium from 'libsodium-wrappers-sumo';
import { cciFields, cciFrozenFieldDefinition } from '../../../src/cci/cube/cciFields';
import { cciField } from '../../../src/cci/cube/cciField';
import { Continuation } from '../../../src/cci/cube/continuation';
import { cciFieldType } from '../../../src/cci/cube/cciCube.definitions';

describe('CCI encryption', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  describe('basic Encrypt() tests', () => {
    it('correctly encrypts a payload string', () => {
      const sender: sodium.KeyPair = sodium.crypto_box_keypair();
      const recipient: sodium.KeyPair = sodium.crypto_box_keypair();

      const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
      const fields: cciFields = cciFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        cciField.Payload(plaintext),
      ) as cciFields;

      // Call tested function
      const encrypted: cciFields = Continuation.Encrypt(
        fields,
        sender.privateKey,
        recipient.publicKey,
      );

      // Verify result by performing manual decryption:
      // extract cryptographic values
      const ciphertext: Buffer = encrypted.getFirst(cciFieldType.ENCRYPTED).value;
      const nonce: Buffer = encrypted.getFirst(cciFieldType.CRYPTO_NONCE).value;

      // manually derive key using the recipient's private key
      const key: Uint8Array = sodium.crypto_box_beforenm(sender.publicKey, recipient.privateKey);
      // for verification, also derive key using the sender's public key
      const keyAtSender: Uint8Array = sodium.crypto_box_beforenm(recipient.publicKey, sender.privateKey);
      expect(key).toEqual(keyAtSender);
      // manually decrypt
      const decrypted: Uint8Array = sodium.crypto_secretbox_open_easy(
        ciphertext, nonce, key);

      expect(Buffer.from(decrypted).toString()).toContain(plaintext);
    });
  });
});
