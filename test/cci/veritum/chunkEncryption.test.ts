import { NetConstants } from '../../../src/core/networking/networkDefinitions';

import { VerityFields, cciFrozenFieldDefinition } from '../../../src/cci/cube/verityFields';
import { VerityField } from '../../../src/cci/cube/verityField';
import { FieldType, MediaTypes } from '../../../src/cci/cube/cube.definitions';
import { CryptStateOutput } from '../../../src/cci/veritum/encryption.definitions';
import { Encrypt } from '../../../src/cci/veritum/chunkEncryption';
import { KeyPair } from '../../../src/cci/helpers/cryptography';

import { Decrypt } from '../../../src/cci/veritum/chunkDecryption';
import { ApiMisuseError } from '../../../src/core/settings';
import { CubeFieldType } from '../../../src/core/cube/coreCube.definitions';

import sodium from 'libsodium-wrappers-sumo';
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('CCI chunk encryption', () => {
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

  describe('manual Encrypt() tests', () => {
    describe('encrypts a single payload field for each encrypted Cube type', () => {
      it('creates a Continuation Cube', () => {
        // A Continuation Cube only contains encrypted payload.
        // Both symmetric key and nonce are already known by the recipient.
        const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
        const fields: VerityFields = VerityFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          VerityField.Payload(plaintext),
        ) as VerityFields;

        const preSharedKey = Buffer.alloc(NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE, 1337);
        const predefinedNonce = Buffer.alloc(NetConstants.CRYPTO_NONCE_SIZE, 42);

        // Call tested function
        const encrypted: VerityFields = Encrypt(fields,
          { symmetricKey: preSharedKey, nonce: predefinedNonce });

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encrypted.length).toBe(4);
        expect(encrypted.all[0].type).toBe(FieldType.TYPE);
        expect(encrypted.all[1].type).toBe(FieldType.ENCRYPTED);
        expect(encrypted.all[2].type).toBe(FieldType.DATE);
        expect(encrypted.all[3].type).toBe(FieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encrypted.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encrypted.getFirst(FieldType.ENCRYPTED).valueString).
          not.toContain(plaintext);

        const ciphertext: Buffer = encrypted.getFirst(FieldType.ENCRYPTED).value;

        // Manually decrypt the ENCRYPTED field
        const restoredBinary = sodium.crypto_secretbox_open_easy(
          ciphertext, predefinedNonce, preSharedKey);
        const restoredStringified = Buffer.from(restoredBinary).toString('utf-8');
        expect(restoredStringified).toContain(plaintext);
      });

      it('creates a Start-of-Veritum w/ pre-shared key Cube', () => {
        // A Start-of-Veritum Cube w/ pre-shared key contains a nonce
        // alongside the encrypted payload.
        // Both parties are assumed to already have a shared key.
        const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
        const fields: VerityFields = VerityFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          VerityField.Payload(plaintext),
        ) as VerityFields;

        const preSharedKey = Buffer.alloc(NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE, 1337);

        // Call tested function
        const encryptedFieldset: VerityFields = Encrypt(fields, { symmetricKey: preSharedKey });
        const encryptedBinary: Buffer =
          encryptedFieldset.getFirst(FieldType.ENCRYPTED).value;

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encryptedFieldset.length).toBe(4);
        expect(encryptedFieldset.all[0].type).toBe(FieldType.TYPE);
        expect(encryptedFieldset.all[1].type).toBe(FieldType.ENCRYPTED);
        expect(encryptedFieldset.all[2].type).toBe(FieldType.DATE);
        expect(encryptedFieldset.all[3].type).toBe(FieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encryptedFieldset.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encryptedFieldset.getFirst(FieldType.ENCRYPTED).valueString).
          not.toContain(plaintext);

        // Prepare manual decryption:
        // Extract nonce and ciphertext
        const nonce: Buffer = encryptedBinary.subarray(
          0, sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext: Buffer = encryptedBinary.subarray(
          sodium.crypto_secretbox_NONCEBYTES, encryptedBinary.length);

        // Manually decrypt the ENCRYPTED field
        const restoredBinary = sodium.crypto_secretbox_open_easy(
          ciphertext, nonce, preSharedKey);
        const restoredStringified = Buffer.from(restoredBinary).toString('utf-8');
        expect(restoredStringified).toContain(plaintext);
      });


      it('creates a Start-of-Veritum Cube directed at a single recipient', () => {
        // A Start-of-Veritum Cube to a single recipient starts out with a
        // unique, single use public key for the sender, allowing the recipient
        // to derive a new shared secret.
        // Using this derived key and the nonce following next in the blob
        // the recipient can decrypt the payload.
        const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
        const fields: VerityFields = VerityFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          VerityField.Payload(plaintext),
        ) as VerityFields;

        // Call tested function
        const encryptedFieldset: VerityFields = Encrypt(fields, {
          recipients: recipient.publicKey,
          senderPrivateKey: sender.privateKey,
          senderPubkey: sender.publicKey,
        });
        const encryptedBinary: Buffer =
          encryptedFieldset.getFirst(FieldType.ENCRYPTED).value;

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encryptedFieldset.length).toBe(4);
        expect(encryptedFieldset.all[0].type).toBe(FieldType.TYPE);
        expect(encryptedFieldset.all[1].type).toBe(FieldType.ENCRYPTED);
        expect(encryptedFieldset.all[2].type).toBe(FieldType.DATE);
        expect(encryptedFieldset.all[3].type).toBe(FieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encryptedFieldset.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encryptedFieldset.getFirst(FieldType.ENCRYPTED).valueString).
          not.toContain(plaintext);

        // Prepare manual decryption:
        // Extract sender's pubkey, nonce and ciphertext
        const senderPubkey: Buffer = encryptedBinary.subarray(
          0,  // start
          sodium.crypto_box_PUBLICKEYBYTES);  // end
        const nonce: Buffer = encryptedBinary.subarray(
          sodium.crypto_box_PUBLICKEYBYTES,  // start
          sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_secretbox_NONCEBYTES);  // end
        const ciphertext: Buffer = encryptedBinary.subarray(
          sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_secretbox_NONCEBYTES,  // start
          encryptedBinary.length);  // end

        // Manually decrypt the ENCRYPTED field
        const symmetricKey: Uint8Array = sodium.crypto_box_beforenm(
          senderPubkey, recipient.privateKey);
        const restoredBinary: Uint8Array = sodium.crypto_secretbox_open_easy(
          ciphertext, nonce, symmetricKey);
        const restoredStringified = Buffer.from(restoredBinary).toString('utf-8');
        expect(restoredStringified).toContain(plaintext);
      });

      it('creates a Start-of-Veritum Cube directed at two recipients', () => {
        // A Start-of-Veritum Cube to a single recipient starts out with a
        // unique, single use public key for the sender, allowing the recipient
        // to derive a new shared secret.
        // Using this derived key and the nonce following next in the blob
        // the recipient can decrypt the payload.
        const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
        const fields: VerityFields = VerityFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          VerityField.Payload(plaintext),
        ) as VerityFields;

        // Call tested function
        const encryptedFieldset: VerityFields = Encrypt(fields, {
          recipients: [recipient.publicKey, recipient2.publicKey],
          senderPrivateKey: sender.privateKey,
          senderPubkey: sender.publicKey,
        });
        const encryptedBinary: Buffer =
          encryptedFieldset.getFirst(FieldType.ENCRYPTED).value;

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encryptedFieldset.length).toBe(4);
        expect(encryptedFieldset.all[0].type).toBe(FieldType.TYPE);
        expect(encryptedFieldset.all[1].type).toBe(FieldType.ENCRYPTED);
        expect(encryptedFieldset.all[2].type).toBe(FieldType.DATE);
        expect(encryptedFieldset.all[3].type).toBe(FieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encryptedFieldset.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encryptedFieldset.getFirst(FieldType.ENCRYPTED).valueString).
          not.toContain(plaintext);

        // Prepare manual decryption:
        // Extract sender's pubkey, nonce, both keyslots, and ciphertext
        const senderPubkey: Buffer = encryptedBinary.subarray(
          0,  // start
          sodium.crypto_box_PUBLICKEYBYTES);  // end
        const nonce: Buffer = encryptedBinary.subarray(
          sodium.crypto_box_PUBLICKEYBYTES,  // start
          // end:
          sodium.crypto_box_PUBLICKEYBYTES +
          sodium.crypto_secretbox_NONCEBYTES);
        const keyslot1: Buffer = encryptedBinary.subarray(
          // start:
          sodium.crypto_box_PUBLICKEYBYTES +
          sodium.crypto_secretbox_NONCEBYTES,
          // end:
          sodium.crypto_box_PUBLICKEYBYTES +
          sodium.crypto_secretbox_NONCEBYTES +
          sodium.crypto_secretbox_KEYBYTES);
        const keyslot2: Buffer = encryptedBinary.subarray(
          // start:
          sodium.crypto_box_PUBLICKEYBYTES +
          sodium.crypto_secretbox_NONCEBYTES +
          sodium.crypto_secretbox_KEYBYTES,
          // end:
          sodium.crypto_box_PUBLICKEYBYTES +
          sodium.crypto_secretbox_NONCEBYTES +
          2*sodium.crypto_secretbox_KEYBYTES);
        const ciphertext: Buffer = encryptedBinary.subarray(
          // start:
          sodium.crypto_box_PUBLICKEYBYTES +
          sodium.crypto_secretbox_NONCEBYTES +
          2*sodium.crypto_secretbox_KEYBYTES,
          // end:
          encryptedBinary.length);

        // Manually decrypt the ENCRYPTED field as recipient 1
        const slotKey1: Uint8Array = sodium.crypto_box_beforenm(
          senderPubkey, recipient.privateKey);
        const symmetricKeyRecipient1: Uint8Array = sodium.crypto_stream_xchacha20_xor(
          keyslot1, nonce, slotKey1);
        const restoredBinaryRecipient1: Uint8Array = sodium.crypto_secretbox_open_easy(
          ciphertext, nonce, symmetricKeyRecipient1);
        const restoredStringifiedRecipient1 = Buffer.from(restoredBinaryRecipient1).toString('utf-8');
        expect(restoredStringifiedRecipient1).toContain(plaintext);
        // verify recipient1 cannot use keyslot2 for decryption
        const symmetricKeyRecipient1WrongSlot: Uint8Array = sodium.crypto_stream_xchacha20_xor(
          keyslot2, nonce, slotKey1);
        expect(() => sodium.crypto_secretbox_open_easy(
          ciphertext, nonce, symmetricKeyRecipient1WrongSlot)).toThrow();

        // Manually decrypt the ENCRYPTED field as recipient 2
        const slotKey2: Uint8Array = sodium.crypto_box_beforenm(
          senderPubkey, recipient2.privateKey);
        const symmetricKeyRecipient2: Uint8Array = sodium.crypto_stream_xchacha20_xor(
          keyslot2, nonce, slotKey2);
        const restoredBinaryRecipient2: Uint8Array = sodium.crypto_secretbox_open_easy(
          ciphertext, nonce, symmetricKeyRecipient2);
        const restoredStringifiedRecipient2 = Buffer.from(restoredBinaryRecipient2).toString('utf-8');
        expect(restoredStringifiedRecipient2).toContain(plaintext);
        // verify recipient1 cannot use keyslot2 for decryption
        const symmetricKeyRecipient2WrongSlot: Uint8Array = sodium.crypto_stream_xchacha20_xor(
          keyslot1, nonce, slotKey2);
        expect(() => sodium.crypto_secretbox_open_easy(
          ciphertext, nonce, symmetricKeyRecipient2WrongSlot)).toThrow();
      });

      // move to edge cases
      it.todo('throws an error if the amount of recipients does not fit a Cube');
    });  // encrypts a single payload field for each encrypted Cube type

      it.todo('outputs a minimal field set with a single ENCRYPTION field, ' +
             'having high entropy even on short inputs');
  });  // manual Encrypt() tests



  describe('Encrypt()-Decrypt() round-trip tests', () => {
    let encrypted: VerityFields;
    const secretMessage = 'Nuntius cryptatus secretus est, ne intercipiatur';

    describe('Testing a single payload field for each encryption variant', () => {
      describe('Continuation Cube', () => {
        let preSharedKey: Buffer;
        let predefinedNonce: Buffer;
        beforeAll(() => {
          const fields: VerityFields = VerityFields.DefaultPositionals(
            cciFrozenFieldDefinition,
            VerityField.Payload(secretMessage),
          ) as VerityFields;

          preSharedKey = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES, 1337);
          predefinedNonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES, 42);

          encrypted = Encrypt(fields, { symmetricKey: preSharedKey, nonce: predefinedNonce });
        });

        it('decrypts a Continuation Cube', () => {
          const decrypted: VerityFields = Decrypt(encrypted,
            { preSharedKey, predefinedNonce });
          const payload = decrypted.getFirst(FieldType.PAYLOAD);
          expect(payload).toBeDefined();
          expect(payload.valueString).toEqual(secretMessage);
        });
      });  // Continuation Cube

      describe('Start-of-Veritum w/ pre-shared key', () => {
        let preSharedKey: Buffer;
        beforeAll(() => {
          const fields: VerityFields = VerityFields.DefaultPositionals(
            cciFrozenFieldDefinition,
            VerityField.Payload(secretMessage),
          ) as VerityFields;

          preSharedKey = Buffer.alloc(NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE, 1337);

          encrypted = Encrypt(fields, { symmetricKey: preSharedKey });
        });

        it('decrypts a Start-of-Veritum w/ pre-shared key', () => {
          const decrypted: VerityFields = Decrypt(encrypted, { preSharedKey });
          const payload = decrypted.getFirst(FieldType.PAYLOAD);
          expect(payload).toBeDefined();
          expect(payload.valueString).toEqual(secretMessage);
        });
      });  // Start-of-Veritum w/ pre-shared key

      describe('Start-of-Veritum for single recipient', () => {
        beforeAll(() => {
          const fields: VerityFields = VerityFields.DefaultPositionals(
            cciFrozenFieldDefinition,
            VerityField.Payload(secretMessage),
          ) as VerityFields;

          encrypted = Encrypt(fields, {
            recipients: recipient.publicKey,
            senderPrivateKey: sender.privateKey,
            senderPubkey: sender.publicKey,
          });
        });

        it('decrypts a Start-of-Veritum for single recipient', () => {
          const decrypted: VerityFields = Decrypt(encrypted,
            { recipientPrivateKey: recipient.privateKey });
          expect(decrypted).toBeDefined();
          const payload = decrypted.getFirst(FieldType.PAYLOAD);
          expect(payload).toBeDefined();
          expect(payload.valueString).toEqual(secretMessage);
        });

        it('cannot decrypt Start-of-Veritum for different recipient', () => {
          const decrypted: VerityFields = Decrypt(encrypted,
            { recipientPrivateKey: recipient2.privateKey });
          expect(decrypted).toBeUndefined();
        });
      });  // Start-of-Veritum for single recipient

      describe.each([2, 3, 10, 25])('Start-of-Veritum for %i recipients', (num) => {
        let recipients: KeyPair[];
        const secretMessage = "Nuntius ad multos destinatarios";

        beforeAll(() => {
          // create num keypairs
          recipients = [];
          for (let i = 0; i < num; i++) {
            const uint8Recipient = sodium.crypto_box_keypair();
            recipients.push({
              publicKey: Buffer.from(uint8Recipient.publicKey),
              privateKey: Buffer.from(uint8Recipient.privateKey),
            });
          }

          const fields: VerityFields = VerityFields.DefaultPositionals(
            cciFrozenFieldDefinition,
            VerityField.Payload(secretMessage),
          ) as VerityFields;

          encrypted = Encrypt(fields, {
            recipients: recipients.map((recipient) => recipient.publicKey),
            senderPrivateKey: sender.privateKey,
            senderPubkey: sender.publicKey,
          });
        });

        it('decrypts a Start-of-Veritum for multiple recipients for each recipient', () => {
          for (const rcpt of recipients) {
            const decrypted: VerityFields = Decrypt(encrypted,
              { recipientPrivateKey: rcpt.privateKey });
            expect(decrypted).toBeDefined();
            const payload = decrypted.getFirst(FieldType.PAYLOAD);
            expect(payload).toBeDefined();
            expect(payload.valueString).toEqual(secretMessage);
          }
        });
      });  // Start-of-Veritum for multiple recipient
    });  // Testing a single payload field for each encryption variant

    describe('handling multiple input fields', () => {
      it('correctly encrypts and decrypts multiple fields', () => {
        const plaintext = "Omnes campi mei secreti sunt";
        const plaintext2 = "Sinite me iterare: vere sunt secreta";
        const fields: VerityFields = new VerityFields(
          [
            VerityField.Application("cryptographia"),
            VerityField.ContentName("Nuntius secretus"),
            VerityField.Description("Nuntius cuius contenta non possunt divulgari"),
            VerityField.MediaType(MediaTypes.TEXT),
            VerityField.Payload(plaintext),
            VerityField.Payload(plaintext2),
          ],
          cciFrozenFieldDefinition
        );

        // Encrypt the fields
        const encrypted: VerityFields = Encrypt(fields, {
          senderPrivateKey: sender.privateKey,
          recipients: recipient.publicKey,
          senderPubkey: sender.publicKey,
        });

        // Verify that the encrypted fields contain an encypted content field,
        // but no content field
        expect(encrypted.getFirst(FieldType.ENCRYPTED)).toBeTruthy();
        expect(encrypted.getFirst(FieldType.APPLICATION)).toBeFalsy();
        expect(encrypted.getFirst(FieldType.CONTENTNAME)).toBeFalsy();
        expect(encrypted.getFirst(FieldType.DESCRIPTION)).toBeFalsy();
        expect(encrypted.getFirst(FieldType.MEDIA_TYPE)).toBeFalsy();
        expect(encrypted.getFirst(FieldType.PAYLOAD)).toBeFalsy();
        // Verify that no field contains the plaintext
        for (const field of encrypted.all) {
          expect(field.valueString).not.toContain(plaintext);
        }

        // Decrypt the fields
        const decrypted: VerityFields = Decrypt(encrypted, {
          recipientPrivateKey: recipient.privateKey,
        });
        // Remove encryption-induced padding
        decrypted.removeField(decrypted.getFirst(FieldType.PADDING));

        // Verify that the decrypted fields match the original fields
        expect(decrypted).toEqual(fields);
      });

      it('leaves core fields intact and unencrypted', () => {
        const plaintext = "Campi fundamentales non possunt cryptari";
        const fields: VerityFields = VerityFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          VerityField.Payload(plaintext),
        ) as VerityFields;

        // Verify that we have a complete set of core fields
        expect(fields.getFirst(CubeFieldType.TYPE)).toBeTruthy();
        expect(fields.getFirst(CubeFieldType.DATE)).toBeTruthy();
        expect(fields.getFirst(CubeFieldType.NONCE)).toBeTruthy();

        // Encrypt the fields
        const encrypted: VerityFields = Encrypt(fields, {
          senderPrivateKey: sender.privateKey,
          recipients: recipient.publicKey,
          senderPubkey: sender.publicKey,
        });

        // Verify that the encrypted fields contain an encypted content field
        expect(encrypted.getFirst(FieldType.ENCRYPTED)).toBeTruthy();
        // Verify that the encrypted fields still contain all the core fields
        expect(encrypted.getFirst(CubeFieldType.TYPE)).toBeTruthy();
        expect(encrypted.getFirst(CubeFieldType.DATE)).toBeTruthy();
        expect(encrypted.getFirst(CubeFieldType.NONCE)).toBeTruthy();

        // Decrypt the fields
        const decrypted: VerityFields = Decrypt(encrypted, {
          recipientPrivateKey: recipient.privateKey,
        });
        // Remove encryption-induced padding
        decrypted.removeField(decrypted.getFirst(FieldType.PADDING));

        // Verify that the decrypted fields match the original fields
        expect(decrypted).toEqual(fields);
      });
    });  //  handling multiple input fields

    describe('other Encrypt() features', () => {
      it.todo('randomised Cube timestamp by default');
    });
  });  // Encrypt()-Decrypt() round-trip tests

  describe('Encrypt() state output', () => {
    it('returns the symmetric key and nonce used', () => {
      // Make a Start-of-Veritum Cube to a single recipient
      const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
      const fields: VerityFields = VerityFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        VerityField.Payload(plaintext),
      ) as VerityFields;

      // Call tested function
      const encryptState: CryptStateOutput = Encrypt(fields, true, {
        recipients: recipient.publicKey,
        senderPrivateKey: sender.privateKey,
        senderPubkey: sender.publicKey,
      });
      const encryptedBinary: Buffer =
        encryptState.result.getFirst(FieldType.ENCRYPTED).value;

      // Perform a manual decryption using the key and nonce returned
      // Extract sender's pubkey, nonce and ciphertext
      const ciphertext: Buffer = encryptedBinary.subarray(
        sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_secretbox_NONCEBYTES,  // start
        encryptedBinary.length);  // end

      // Manually decrypt the ENCRYPTED field
      const restoredBinary: Uint8Array = sodium.crypto_secretbox_open_easy(
        ciphertext, encryptState.nonce, encryptState.symmetricKey);
      const restoredStringified = Buffer.from(restoredBinary).toString('utf-8');
      expect(restoredStringified).toContain(plaintext);
    });
  });

  describe('Encrypt() edge case tests', () => {
    it('encrypts a minimal PADDING field if no payload provided', () => {
      // This can be used to perform pure key distribution without sending
      // an actual message just yet
      const encrypted: VerityFields = Encrypt(
        new VerityFields([], cciFrozenFieldDefinition), {
        senderPrivateKey:sender.privateKey,
        recipients: recipient.publicKey,
        senderPubkey: sender.publicKey,
      });
      expect(encrypted.getFirst(FieldType.PADDING)).toBeUndefined();

      const decrypted: VerityFields = Decrypt(encrypted, {
        recipientPrivateKey: recipient.privateKey,
      });
      expect(decrypted.getFirst(FieldType.PADDING)).toBeDefined();
      expect(decrypted.getFirst(FieldType.PAYLOAD)).toBeUndefined();
    });

    it('will throw on missing sender pubkey', () => {
      expect(() => {
        Encrypt(new VerityFields([], cciFrozenFieldDefinition), {
          senderPrivateKey: sender.privateKey,
          recipients: recipient.publicKey,
        });
      }).toThrow(ApiMisuseError);
    });

    it('will throw on missing sender privkey', () => {
      expect(() => {
        Encrypt(new VerityFields([], cciFrozenFieldDefinition), {
          senderPubkey: sender.publicKey,
          recipients: recipient.publicKey,
        });
      }).toThrow(ApiMisuseError);
    });

    it.todo('will throw if number of recipients too large for a single Cube')
  });

  // describe('Decrypt() edge case tests', () => {
  // });  // Decrypt() edge case tests

});
