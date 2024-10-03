import { cciFields, cciFrozenFieldDefinition } from '../../../src/cci/cube/cciFields';
import { cciField } from '../../../src/cci/cube/cciField';
import { MediaTypes, cciFieldType } from '../../../src/cci/cube/cciCube.definitions';
import { CubeFieldType } from '../../../src/core/cube/cube.definitions';
import { Decrypt, Encrypt } from '../../../src/cci/veritum/encryption';
import { KeyPair } from '../../../src/cci/helpers/cryptography';

import sodium from 'libsodium-wrappers-sumo';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

describe('CCI encryption', () => {
  let sender: KeyPair;
  let recipient: KeyPair;
  let recipient2: KeyPair;
  let recipient3: KeyPair;
  let nonRecipient: KeyPair;

  beforeAll(async () => {
    await sodium.ready;
    const uint8Sender = sodium.crypto_box_keypair();
    sender = {
      publicKey: Buffer.from(uint8Sender.publicKey),
      privateKey: Buffer.from(uint8Sender.privateKey),
    };
    const uint8Recipient = sodium.crypto_box_keypair();
    recipient = {
      publicKey: Buffer.from(uint8Recipient.publicKey),
      privateKey: Buffer.from(uint8Recipient.privateKey),
    };
    const uint8Recipient2 = sodium.crypto_box_keypair();
    recipient2 = {
      publicKey: Buffer.from(uint8Recipient2.publicKey),
      privateKey: Buffer.from(uint8Recipient2.privateKey),
    };
    const uint8Recipient3 = sodium.crypto_box_keypair();
    recipient3 = {
      publicKey: Buffer.from(uint8Recipient3.publicKey),
      privateKey: Buffer.from(uint8Recipient3.privateKey),
    };
    const uint8NonRecipient = sodium.crypto_box_keypair();
    nonRecipient = {
      publicKey: Buffer.from(uint8NonRecipient.publicKey),
      privateKey: Buffer.from(uint8NonRecipient.privateKey),
    }
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
        fields, sender.privateKey, recipient.publicKey);

      // Verify result by performing manual decryption:
      // extract cryptographic values
      const ciphertext: Buffer = encrypted.getFirst(cciFieldType.ENCRYPTED).value;
      const nonce: Buffer = encrypted.getFirst(cciFieldType.CRYPTO_NONCE).value;

      // manually derive key using the recipient's private key
      const key: Uint8Array = sodium.crypto_box_beforenm(
        sender.publicKey, recipient.privateKey);
      // for verification, also derive key using the sender's public key
      const keyAtSender: Uint8Array = sodium.crypto_box_beforenm(
        Buffer.from(recipient.publicKey), sender.privateKey);
      expect(key).toEqual(keyAtSender);
      // manually decrypt
      const decrypted: Uint8Array = sodium.crypto_secretbox_open_easy(
        ciphertext, nonce, key);

      // verify that the ciphertext is not decryptable by a non-recipient
      const wrongKey: Uint8Array = sodium.crypto_box_beforenm(
        sender.publicKey, nonRecipient.privateKey);
      expect(wrongKey).not.toEqual(key);
      expect(() => sodium.crypto_secretbox_open_easy(
        ciphertext, nonce, wrongKey)).toThrow();

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
        fields, sender.privateKey, recipient.publicKey);

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
        encrypted, recipient.privateKey, sender.publicKey);

      // Verify that the decrypted fields match the original fields
      expect(decrypted.getFirst(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
      expect(decrypted).toEqual(fields);
    });


    it.each([2, 3, 10, 100])('correctly encrypts and decrypts for %i recipients', (num) => {
      // create num keypairs
      const recipients: KeyPair[] = [];
      for (let i = 0; i < num; i++) {
        const uint8Recipient = sodium.crypto_box_keypair();
        recipients.push({
          publicKey: Buffer.from(uint8Recipient.publicKey),
          privateKey: Buffer.from(uint8Recipient.privateKey),
        });
      }

      // prepare a message
      const plaintext = 'Nuntius ad multos destinatarios';
      const fields: cciFields = new cciFields(
        cciField.Payload(plaintext),
        cciFrozenFieldDefinition,
      );

      // encrypt the message
      const encrypted: cciFields = Encrypt(fields, sender.privateKey,
        recipients.map((recipient) => recipient.publicKey),
      );

      // Verify that the encrypted fields contain an encypted content field,
      // but no payload field
      expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
      expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();

      // decrypt the message for each recipient
      for (const recipient of recipients) {
        // Decrypt the fields
        const decrypted: cciFields = Decrypt(
          encrypted, recipient.privateKey, sender.publicKey);

        // verify that the ENCRYPTED field was replaced by a PAYLOAD field
        expect(decrypted.getFirst(cciFieldType.ENCRYPTED)).toBeFalsy();
        expect(decrypted.getFirst(cciFieldType.PAYLOAD)).toBeTruthy();

        // Verify that the decrypted fields match the original fields
        expect(decrypted.getFirst(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
        expect(decrypted).toEqual(fields);
      }
      // verify that the message is not decryptable by a non-recipient
      const cannotDecrypt: cciFields = Decrypt(
        encrypted, nonRecipient.privateKey, sender.publicKey);
      expect(cannotDecrypt.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
      expect(cannotDecrypt.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
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
        Buffer.from(sender.privateKey),
        Buffer.from(recipient.publicKey),
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
        Buffer.from(recipient.privateKey),
        Buffer.from(sender.publicKey),
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
        Buffer.from(sender.privateKey),
        Buffer.from(recipient.publicKey),
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
        Buffer.from(recipient.privateKey),
        Buffer.from(sender.publicKey),
      );

      // Verify that the decrypted fields match the original fields
      expect(decrypted).toEqual(fields);
    });


    it('includes the public key with the encrypted payload if supplied', () => {
      const plaintext = 'Decodificare facile est, nam clavis publica inclusa est';
      const fields: cciFields = new cciFields(
        cciField.Payload(plaintext),
        cciFrozenFieldDefinition,
      );

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        Buffer.from(sender.privateKey),
        Buffer.from(recipient.publicKey),
        { includeSenderPubkey: Buffer.from(sender.publicKey) },
      );

      // Verify that the encrypted fields contain an encypted content field,
      // a crypto nonce field as well as a public key field, but no payload field
      expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
      expect(encrypted.getFirst(cciFieldType.CRYPTO_PUBKEY)).toBeTruthy();
      expect(encrypted.getFirst(cciFieldType.CRYPTO_NONCE)).toBeTruthy();
      expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
      // Verify that no field contains the plaintext
      for (const field of encrypted.all) {
        expect(field.valueString).not.toContain(plaintext);
      }

      // Decrypt the fields
      const decrypted: cciFields = Decrypt(encrypted, Buffer.from(recipient.privateKey));

      // Verify that the decrypted fields match the original fields
      expect(decrypted.getFirst(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
      expect(decrypted).toEqual(fields);
    });
  });  // Encrypt()-Decrypt() round-trip tests


  describe('Decrypt() edge case tests', () => {
    it('fails gently if no pubkey provided on decryption', () => {
      const plaintext = "Cryptographia clavi publicae sine clave publica decriptari nequit"
      const fields: cciFields = new cciFields(
        cciField.Payload(plaintext),
        cciFrozenFieldDefinition,
      );

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        Buffer.from(sender.privateKey),
        Buffer.from(recipient.publicKey),
      );

      // Attempt decryption
      const decrypted: cciFields = Decrypt(
        encrypted,
        Buffer.from(recipient.privateKey),
      );

      // Expect fields unchanged, i.e. no decryption performed
      expect(decrypted).toEqual(encrypted);
    });


    it('fails gently if pubkey is invalid on decryption', () => {
      const plaintext = "Si clavis publica invalida est, decryptio deficiet"
      const fields: cciFields = new cciFields(
        cciField.Payload(plaintext),
        cciFrozenFieldDefinition,
      );

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        Buffer.from(sender.privateKey),
        Buffer.from(recipient.publicKey),
      );

      // Fake an invalid pubkey
      const invalidPubkey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 0xff);
      // Attempt decryption
      const decrypted: cciFields = Decrypt(
        encrypted,
        Buffer.from(recipient.privateKey),
        invalidPubkey
      );

      // Expect fields unchanged, i.e. no decryption performed
      expect(decrypted).toEqual(encrypted);
    });


    it('fails gently if no nonce provided on decryption', () => {
      const plaintext = "Decryptio impossibilis est sine numere unico"
      const fields: cciFields = new cciFields(
        cciField.Payload(plaintext),
        cciFrozenFieldDefinition,
      );

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        Buffer.from(sender.privateKey),
        Buffer.from(recipient.publicKey),
      );

      // Remove the nonce
      const nonce = encrypted.getFirst(cciFieldType.CRYPTO_NONCE);
      encrypted.removeField(nonce);

      // Attempt decryption
      const decrypted: cciFields = Decrypt(encrypted, Buffer.from(recipient.privateKey));

      // Expect fields unchanged, i.e. no decryption performed
      expect(decrypted).toEqual(encrypted);
    });


    it('fails gently if nonce is invalid on decryption', () => {
      const plaintext = "Si numere unico non sit validus, decryptio deficiet"
      const fields: cciFields = new cciFields(
        cciField.Payload(plaintext),
        cciFrozenFieldDefinition,
      );

      // Encrypt the fields
      const encrypted: cciFields = Encrypt(
        fields,
        Buffer.from(sender.privateKey),
        Buffer.from(recipient.publicKey),
      );

      // Temper with nonce
      const nonce = encrypted.getFirst(cciFieldType.CRYPTO_NONCE);
      nonce.value.writeUint16BE(31337);

      // Attempt decryption
      const decrypted: cciFields = Decrypt(encrypted, Buffer.from(recipient.privateKey));

      // Expect fields unchanged, i.e. no decryption performed
      expect(decrypted).toEqual(encrypted);
    });
  });  // Decrypt() edge case tests

});
