import { cciFields, cciFrozenFieldDefinition } from '../../../src/cci/cube/cciFields';
import { cciField } from '../../../src/cci/cube/cciField';
import { MediaTypes, cciFieldType } from '../../../src/cci/cube/cciCube.definitions';
import { CubeFieldType } from '../../../src/core/cube/cube.definitions';
import { Decrypt, Encrypt } from '../../../src/cci/veritum/encryption';

import sodium from 'libsodium-wrappers-sumo';

describe('CCI encryption', () => {
  let sender: sodium.KeyPair;
  let recipient: sodium.KeyPair;

  beforeAll(async () => {
    await sodium.ready;
    sender = sodium.crypto_box_keypair();
    recipient = sodium.crypto_box_keypair();
  });

  describe('basic Encrypt() tests', () => {
    it('correctly encrypts a payload string', () => {
      const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
      const fields: cciFields = cciFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        cciField.Payload(plaintext),
      ) as cciFields;

      // Call tested function
      const encrypted: cciFields = Encrypt(
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

  describe('Encrypt()-Decrypt() round-trip tests', () => {
    it('correctly encrypts and decrypts a single payload field', () => {
      const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
      const fields: cciFields = new cciFields(
        cciField.Payload(plaintext),
        cciFrozenFieldDefinition,
      );

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        sender.privateKey,
        recipient.publicKey,
      );

      // Verify that the encrypted fields contain an encypted content field,
      // but no payload field
      expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
      expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
      // Verify that no field contains the plaintext
      for (const field of encrypted.all) {
        expect(field.valueString).not.toContain(plaintext);
      }

      // Decrypt the fields
      const decrypted: cciFields = Decrypt(
        encrypted,
        recipient.privateKey,
        sender.publicKey,
      );

      // Verify that the decrypted fields match the original fields
      expect(decrypted.getFirst(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
      expect(decrypted).toEqual(fields);
    });

    it('correctly encrypts and decrypts multiple fields', () => {
      const plaintext = "Omnes campi mei secreti sunt";
      const fields: cciFields = new cciFields(
        [
          cciField.Application("cryptographia"),
          cciField.ContentName("Nuntius secretus"),
          cciField.Description("Nuntius cuius contenta non possunt divulgari"),
          cciField.MediaType(MediaTypes.TEXT),
          cciField.Payload(plaintext),
          cciField.Payload("Sinite me iterare: vere sunt secreta"),
        ],
        cciFrozenFieldDefinition
      );

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        sender.privateKey,
        recipient.publicKey,
      );

      // Verify that the encrypted fields contain an encypted content field,
      // but no content field
      expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
      expect(encrypted.getFirst(cciFieldType.APPLICATION)).toBeFalsy();
      expect(encrypted.getFirst(cciFieldType.CONTENTNAME)).toBeFalsy();
      expect(encrypted.getFirst(cciFieldType.DESCRIPTION)).toBeFalsy();
      expect(encrypted.getFirst(cciFieldType.MEDIA_TYPE)).toBeFalsy();
      expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
      // Verify that no field contains the plaintext
      for (const field of encrypted.all) {
        expect(field.valueString).not.toContain(plaintext);
      }

      // Decrypt the fields
      const decrypted: cciFields = Decrypt(
        encrypted,
        recipient.privateKey,
        sender.publicKey,
      );

      // Verify that the decrypted fields match the original fields
      expect(decrypted).toEqual(fields);
    });

    it('leaves core fields intact and unencrypted', () => {
      const plaintext = "Campi fundamentales non possunt cryptari";
      const fields: cciFields = cciFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        cciField.Payload(plaintext),
      ) as cciFields;

      // Verify that we have a complete set of core fields
      expect(fields.getFirst(CubeFieldType.TYPE)).toBeTruthy();
      expect(fields.getFirst(CubeFieldType.DATE)).toBeTruthy();
      expect(fields.getFirst(CubeFieldType.NONCE)).toBeTruthy();

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        sender.privateKey,
        recipient.publicKey,
      );

      // Verify that the encrypted fields contain an encypted content field
      expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
      // Verify that the encrypted fields still contain all the core fields
      expect(encrypted.getFirst(CubeFieldType.TYPE)).toBeTruthy();
      expect(encrypted.getFirst(CubeFieldType.DATE)).toBeTruthy();
      expect(encrypted.getFirst(CubeFieldType.NONCE)).toBeTruthy();

      // Decrypt the fields
      const decrypted: cciFields = Decrypt(
        encrypted,
        recipient.privateKey,
        sender.publicKey,
      );

      // Verify that the decrypted fields match the original fields
      expect(decrypted).toEqual(fields);
    });
  });

});
