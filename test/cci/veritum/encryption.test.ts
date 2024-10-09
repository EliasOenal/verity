import { cciFields, cciFrozenFieldDefinition } from '../../../src/cci/cube/cciFields';
import { cciField } from '../../../src/cci/cube/cciField';
import { cciFieldType } from '../../../src/cci/cube/cciCube.definitions';
import { Encrypt } from '../../../src/cci/veritum/encryption';
import { KeyPair } from '../../../src/cci/helpers/cryptography';

import sodium from 'libsodium-wrappers-sumo';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { Decrypt } from '../../../src/cci/veritum/decryption';
import { ApiMisuseError } from '../../../src/core/settings';

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

  describe('manual Encrypt() tests', () => {
    describe('encrypts a single payload field for each encrypted Cube type', () => {
      it('creates a Continuation Cube', () => {
        // A Continuation Cube only contains encrypted payload.
        // Both symmetric key and nonce are already known by the recipient.
        const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
        const fields: cciFields = cciFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          cciField.Payload(plaintext),
        ) as cciFields;

        const preSharedKey = Buffer.alloc(NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE, 1337);
        const predefinedNonce = Buffer.alloc(NetConstants.CRYPTO_NONCE_SIZE, 42);

        // Call tested function
        const encrypted: cciFields = Encrypt(fields,
          { preSharedKey, predefinedNonce });

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encrypted.length).toBe(4);
        expect(encrypted.all[0].type).toBe(cciFieldType.TYPE);
        expect(encrypted.all[1].type).toBe(cciFieldType.ENCRYPTED);
        expect(encrypted.all[2].type).toBe(cciFieldType.DATE);
        expect(encrypted.all[3].type).toBe(cciFieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encrypted.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encrypted.getFirst(cciFieldType.ENCRYPTED).valueString).
          not.toContain(plaintext);

        const ciphertext: Buffer = encrypted.getFirst(cciFieldType.ENCRYPTED).value;

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
        const fields: cciFields = cciFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          cciField.Payload(plaintext),
        ) as cciFields;

        const preSharedKey = Buffer.alloc(NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE, 1337);

        // Call tested function
        const encryptedFieldset: cciFields = Encrypt(fields, { preSharedKey });
        const encryptedBinary: Buffer =
          encryptedFieldset.getFirst(cciFieldType.ENCRYPTED).value;

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encryptedFieldset.length).toBe(4);
        expect(encryptedFieldset.all[0].type).toBe(cciFieldType.TYPE);
        expect(encryptedFieldset.all[1].type).toBe(cciFieldType.ENCRYPTED);
        expect(encryptedFieldset.all[2].type).toBe(cciFieldType.DATE);
        expect(encryptedFieldset.all[3].type).toBe(cciFieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encryptedFieldset.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encryptedFieldset.getFirst(cciFieldType.ENCRYPTED).valueString).
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
        const fields: cciFields = cciFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          cciField.Payload(plaintext),
        ) as cciFields;

        // Call tested function
        const encryptedFieldset: cciFields = Encrypt(fields, {
          recipients: recipient.publicKey,
          senderPrivateKey: sender.privateKey,
          includeSenderPubkey: sender.publicKey,
        });
        const encryptedBinary: Buffer =
          encryptedFieldset.getFirst(cciFieldType.ENCRYPTED).value;

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encryptedFieldset.length).toBe(4);
        expect(encryptedFieldset.all[0].type).toBe(cciFieldType.TYPE);
        expect(encryptedFieldset.all[1].type).toBe(cciFieldType.ENCRYPTED);
        expect(encryptedFieldset.all[2].type).toBe(cciFieldType.DATE);
        expect(encryptedFieldset.all[3].type).toBe(cciFieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encryptedFieldset.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encryptedFieldset.getFirst(cciFieldType.ENCRYPTED).valueString).
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
        const fields: cciFields = cciFields.DefaultPositionals(
          cciFrozenFieldDefinition,
          cciField.Payload(plaintext),
        ) as cciFields;

        // Call tested function
        const encryptedFieldset: cciFields = Encrypt(fields, {
          recipients: [recipient.publicKey, recipient2.publicKey],
          senderPrivateKey: sender.privateKey,
          includeSenderPubkey: sender.publicKey,
        });
        const encryptedBinary: Buffer =
          encryptedFieldset.getFirst(cciFieldType.ENCRYPTED).value;

        // Check that the result contains only a single ENCRYPTED field
        // apart from a Frozen Cube's positionals.
        expect(encryptedFieldset.length).toBe(4);
        expect(encryptedFieldset.all[0].type).toBe(cciFieldType.TYPE);
        expect(encryptedFieldset.all[1].type).toBe(cciFieldType.ENCRYPTED);
        expect(encryptedFieldset.all[2].type).toBe(cciFieldType.DATE);
        expect(encryptedFieldset.all[3].type).toBe(cciFieldType.NONCE);

        // Expect the resulting field set to fill a Cube exactly
        expect(encryptedFieldset.getByteLength()).toBe(NetConstants.CUBE_SIZE);

        // Ensure the plaintext is not visible in the encrypted data
        expect(encryptedFieldset.getFirst(cciFieldType.ENCRYPTED).valueString).
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
  let encrypted: cciFields;
  const secretMessage = 'Nuntius cryptatus secretus est, ne intercipiatur';

  describe('Continuation Cube', () => {
    let preSharedKey: Buffer;
    let predefinedNonce: Buffer;
    beforeAll(() => {
      const fields: cciFields = cciFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        cciField.Payload(secretMessage),
      ) as cciFields;

      preSharedKey = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES, 1337);
      predefinedNonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES, 42);

      encrypted = Encrypt(fields, { preSharedKey, predefinedNonce });
    });

    it('decrypts a Continuation Cube', () => {
      const decrypted: cciFields = Decrypt(encrypted,
        { preSharedKey, predefinedNonce });
      const payload = decrypted.getFirst(cciFieldType.PAYLOAD);
      expect(payload).toBeDefined();
      expect(payload.valueString).toEqual(secretMessage);
    });
  });  // Continuation Cube

  describe('Start-of-Veritum w/ pre-shared key', () => {
    let preSharedKey: Buffer;
    beforeAll(() => {
      const fields: cciFields = cciFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        cciField.Payload(secretMessage),
      ) as cciFields;

      preSharedKey = Buffer.alloc(NetConstants.CRYPTO_SYMMETRIC_KEY_SIZE, 1337);

      encrypted = Encrypt(fields, { preSharedKey });
    });

    it('decrypts a Start-of-Veritum w/ pre-shared key', () => {
      const decrypted: cciFields = Decrypt(encrypted, { preSharedKey });
      const payload = decrypted.getFirst(cciFieldType.PAYLOAD);
      expect(payload).toBeDefined();
      expect(payload.valueString).toEqual(secretMessage);
    });
  });  // Start-of-Veritum w/ pre-shared key

  describe('Start-of-Veritum for single recipient', () => {
    beforeAll(() => {
      const fields: cciFields = cciFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        cciField.Payload(secretMessage),
      ) as cciFields;

      encrypted = Encrypt(fields, {
        recipients: recipient.publicKey,
        senderPrivateKey: sender.privateKey,
        includeSenderPubkey: sender.publicKey,
      });
    });

    it('decrypts a Start-of-Veritum for single recipient', () => {
      const decrypted: cciFields = Decrypt(encrypted,
        { recipientPrivateKey: recipient.privateKey });
      expect(decrypted).toBeDefined();
      const payload = decrypted.getFirst(cciFieldType.PAYLOAD);
      expect(payload).toBeDefined();
      expect(payload.valueString).toEqual(secretMessage);
    });

    it('cannot decrypt Start-of-Veritum for different recipient', () => {
      const decrypted: cciFields = Decrypt(encrypted,
        { recipientPrivateKey: recipient2.privateKey });
      expect(decrypted).toBeUndefined();
    });
  });  // Start-of-Veritum for single recipient

  describe('Start-of-Veritum for multiple recipients', () => {
    beforeAll(() => {
      const fields: cciFields = cciFields.DefaultPositionals(
        cciFrozenFieldDefinition,
        cciField.Payload(secretMessage),
      ) as cciFields;

      encrypted = Encrypt(fields, {
        recipients: [recipient.publicKey, recipient2.publicKey, recipient3.publicKey],
        senderPrivateKey: sender.privateKey,
        includeSenderPubkey: sender.publicKey,
      });
    });

    it('decrypts a Start-of-Veritum for multiple recipients for each recipient', () => {
      for (const rcpt of [recipient, recipient2, recipient3]) {
        const decrypted: cciFields = Decrypt(encrypted,
          { recipientPrivateKey: rcpt.privateKey });
        expect(decrypted).toBeDefined();
        const payload = decrypted.getFirst(cciFieldType.PAYLOAD);
        expect(payload).toBeDefined();
        expect(payload.valueString).toEqual(secretMessage);
      }
    });
  });  // Start-of-Veritum for single recipient

});  // Encrypt()-Decrypt() round-trip tests

  //   // DELETE
  //   it('correctly encrypts and decrypts a single payload field', () => {
  //     const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
  //     const fields: cciFields = new cciFields(
  //       cciField.Payload(plaintext),
  //       cciFrozenFieldDefinition,
  //     );

  //     // Encrypt the fields
  //     const encrypted: cciFields = new cciFields(Encrypt(
  //       fields, sender.privateKey, recipient.publicKey
  //     ), cciFrozenFieldDefinition);

  //     // Verify that the encrypted fields contain an encypted content field,
  //     // but no payload field
  //     expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
  //     expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
  //     // Verify that no field contains the plaintext
  //     for (const field of encrypted.all) {
  //       expect(field.valueString).not.toContain(plaintext);
  //     }

  //     // Decrypt the fields
  //     const decrypted: cciFields = Decrypt(
  //       encrypted, recipient.privateKey, sender.publicKey);

  //     // Verify that the decrypted fields match the original fields
  //     expect(decrypted.getFirst(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
  //     expect(decrypted).toEqual(fields);
  //   });


  //   it.each([2, 3, 10, 100])('correctly encrypts and decrypts for %i recipients', (num) => {
  //     // create num keypairs
  //     const recipients: KeyPair[] = [];
  //     for (let i = 0; i < num; i++) {
  //       const uint8Recipient = sodium.crypto_box_keypair();
  //       recipients.push({
  //         publicKey: Buffer.from(uint8Recipient.publicKey),
  //         privateKey: Buffer.from(uint8Recipient.privateKey),
  //       });
  //     }

  //     // prepare a message
  //     const plaintext = 'Nuntius ad multos destinatarios';
  //     const fields: cciFields = new cciFields(
  //       cciField.Payload(plaintext),
  //       cciFrozenFieldDefinition,
  //     );

  //     // encrypt the message
  //     const encrypted: cciFields = new cciFields(Encrypt(fields, sender.privateKey,
  //       recipients.map((recipient) => recipient.publicKey),
  //     ), cciFrozenFieldDefinition);

  //     // Verify that the encrypted fields contain an encypted content field,
  //     // but no payload field
  //     expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
  //     expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();

  //     // decrypt the message for each recipient
  //     for (const recipient of recipients) {
  //       // Decrypt the fields
  //       const decrypted: cciFields = Decrypt(
  //         encrypted, recipient.privateKey, sender.publicKey);

  //       // verify that the ENCRYPTED field was replaced by a PAYLOAD field
  //       expect(decrypted.getFirst(cciFieldType.ENCRYPTED)).toBeFalsy();
  //       expect(decrypted.getFirst(cciFieldType.PAYLOAD)).toBeTruthy();

  //       // Verify that the decrypted fields match the original fields
  //       expect(decrypted.getFirst(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
  //       expect(decrypted).toEqual(fields);
  //     }
  //     // verify that the message is not decryptable by a non-recipient
  //     const cannotDecrypt: cciFields = Decrypt(
  //       encrypted, nonRecipient.privateKey, sender.publicKey);
  //     expect(cannotDecrypt.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
  //     expect(cannotDecrypt.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
  //   });


  //   it('correctly encrypts and decrypts multiple fields', () => {
  //     const plaintext = "Omnes campi mei secreti sunt";
  //     const fields: cciFields = new cciFields(
  //       [
  //         cciField.Application("cryptographia"),
  //         cciField.ContentName("Nuntius secretus"),
  //         cciField.Description("Nuntius cuius contenta non possunt divulgari"),
  //         cciField.MediaType(MediaTypes.TEXT),
  //         cciField.Payload(plaintext),
  //         cciField.Payload("Sinite me iterare: vere sunt secreta"),
  //       ],
  //       cciFrozenFieldDefinition
  //     );

  //     // Encrypt the fields
  //     const encrypted: cciFields = new cciFields(Encrypt(
  //       fields,
  //       Buffer.from(sender.privateKey),
  //       Buffer.from(recipient.publicKey),
  //     ), cciFrozenFieldDefinition);

  //     // Verify that the encrypted fields contain an encypted content field,
  //     // but no content field
  //     expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
  //     expect(encrypted.getFirst(cciFieldType.APPLICATION)).toBeFalsy();
  //     expect(encrypted.getFirst(cciFieldType.CONTENTNAME)).toBeFalsy();
  //     expect(encrypted.getFirst(cciFieldType.DESCRIPTION)).toBeFalsy();
  //     expect(encrypted.getFirst(cciFieldType.MEDIA_TYPE)).toBeFalsy();
  //     expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
  //     // Verify that no field contains the plaintext
  //     for (const field of encrypted.all) {
  //       expect(field.valueString).not.toContain(plaintext);
  //     }

  //     // Decrypt the fields
  //     const decrypted: cciFields = Decrypt(
  //       encrypted,
  //       Buffer.from(recipient.privateKey),
  //       Buffer.from(sender.publicKey),
  //     );

  //     // Verify that the decrypted fields match the original fields
  //     expect(decrypted).toEqual(fields);
  //   });


  //   it('leaves core fields intact and unencrypted', () => {
  //     const plaintext = "Campi fundamentales non possunt cryptari";
  //     const fields: cciFields = cciFields.DefaultPositionals(
  //       cciFrozenFieldDefinition,
  //       cciField.Payload(plaintext),
  //     ) as cciFields;

  //     // Verify that we have a complete set of core fields
  //     expect(fields.getFirst(CubeFieldType.TYPE)).toBeTruthy();
  //     expect(fields.getFirst(CubeFieldType.DATE)).toBeTruthy();
  //     expect(fields.getFirst(CubeFieldType.NONCE)).toBeTruthy();

  //     // Encrypt the fields
  //     const encrypted: cciFields = new cciFields(Encrypt(
  //       fields,
  //       Buffer.from(sender.privateKey),
  //       Buffer.from(recipient.publicKey),
  //     ), cciFrozenFieldDefinition);

  //     // Verify that the encrypted fields contain an encypted content field
  //     expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
  //     // Verify that the encrypted fields still contain all the core fields
  //     expect(encrypted.getFirst(CubeFieldType.TYPE)).toBeTruthy();
  //     expect(encrypted.getFirst(CubeFieldType.DATE)).toBeTruthy();
  //     expect(encrypted.getFirst(CubeFieldType.NONCE)).toBeTruthy();

  //     // Decrypt the fields
  //     const decrypted: cciFields = Decrypt(
  //       encrypted,
  //       Buffer.from(recipient.privateKey),
  //       Buffer.from(sender.publicKey),
  //     );

  //     // Verify that the decrypted fields match the original fields
  //     expect(decrypted).toEqual(fields);
  //   });


  //   it('includes the public key with the encrypted payload if supplied', () => {
  //     const plaintext = 'Decodificare facile est, nam clavis publica inclusa est';
  //     const fields: cciFields = new cciFields(
  //       cciField.Payload(plaintext),
  //       cciFrozenFieldDefinition,
  //     );

  //     // Encrypt the fields
  //     const encrypted: cciFields = new cciFields(Encrypt(
  //       fields,
  //       Buffer.from(sender.privateKey),
  //       Buffer.from(recipient.publicKey),
  //       { includeSenderPubkey: Buffer.from(sender.publicKey) },
  //     ), cciFrozenFieldDefinition);

  //     // Verify that the encrypted fields contain an encypted content field,
  //     // a crypto nonce field as well as a public key field, but no payload field
  //     expect(encrypted.getFirst(cciFieldType.ENCRYPTED)).toBeTruthy();
  //     expect(encrypted.getFirst(cciFieldType.CRYPTO_PUBKEY)).toBeTruthy();
  //     expect(encrypted.getFirst(cciFieldType.CRYPTO_NONCE)).toBeTruthy();
  //     expect(encrypted.getFirst(cciFieldType.PAYLOAD)).toBeFalsy();
  //     // Verify that no field contains the plaintext
  //     for (const field of encrypted.all) {
  //       expect(field.valueString).not.toContain(plaintext);
  //     }

  //     // Decrypt the fields
  //     const decrypted: cciFields = Decrypt(encrypted, Buffer.from(recipient.privateKey));

  //     // Verify that the decrypted fields match the original fields
  //     expect(decrypted.getFirst(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
  //     expect(decrypted).toEqual(fields);
  //   });
  // });  // Encrypt()-Decrypt() round-trip tests

  describe('Encrypt() edge case tests', () => {
    it('encrypts a minimal PADDING field if no payload provided', () => {
      // This can be used to perform pure key distribution without sending
      // an actual message just yet
      const encrypted: cciFields = Encrypt(
        new cciFields([], cciFrozenFieldDefinition), {
        senderPrivateKey:sender.privateKey,
        recipients: recipient.publicKey,
        includeSenderPubkey: sender.publicKey,
      });
      expect(encrypted.getFirst(cciFieldType.PADDING)).toBeUndefined();

      const decrypted: cciFields = Decrypt(encrypted, {
        recipientPrivateKey: recipient.privateKey,
      });
      expect(decrypted.getFirst(cciFieldType.PADDING)).toBeDefined();
      expect(decrypted.getFirst(cciFieldType.PAYLOAD)).toBeUndefined();
    });

    it('will throw on missing sender pubkey', () => {
      expect(() => {
        Encrypt(new cciFields([], cciFrozenFieldDefinition), {
          senderPrivateKey: sender.privateKey,
          recipients: recipient.publicKey,
        });
      }).toThrow(ApiMisuseError);
    });

    it('will throw on missing sender privkey', () => {
      expect(() => {
        Encrypt(new cciFields([], cciFrozenFieldDefinition), {
          includeSenderPubkey: sender.publicKey,
          recipients: recipient.publicKey,
        });
      }).toThrow(ApiMisuseError);
    });
  });

  // describe('Decrypt() edge case tests', () => {
  //   it('fails gently if no pubkey provided on decryption', () => {
  //     const plaintext = "Cryptographia clavi publicae sine clave publica decriptari nequit"
  //     const fields: cciFields = new cciFields(
  //       cciField.Payload(plaintext),
  //       cciFrozenFieldDefinition,
  //     );

  //     // Encrypt the fields
  //     const encrypted: cciFields = Encrypt(
  //       fields,
  //       Buffer.from(sender.privateKey),
  //       Buffer.from(recipient.publicKey),
  //     );

  //     // Attempt decryption
  //     const decrypted: cciFields = Decrypt(
  //       encrypted,
  //       Buffer.from(recipient.privateKey),
  //     );

  //     // Expect fields unchanged, i.e. no decryption performed
  //     expect(decrypted).toEqual(encrypted);
  //   });


  //   it('fails gently if pubkey is invalid on decryption', () => {
  //     const plaintext = "Si clavis publica invalida est, decryptio deficiet"
  //     const fields: cciFields = new cciFields(
  //       cciField.Payload(plaintext),
  //       cciFrozenFieldDefinition,
  //     );

  //     // Encrypt the fields
  //     const encrypted: cciFields = new cciFields(Encrypt(
  //       fields,
  //       Buffer.from(sender.privateKey),
  //       Buffer.from(recipient.publicKey),
  //     ), cciFrozenFieldDefinition);

  //     // Fake an invalid pubkey
  //     const invalidPubkey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 0xff);
  //     // Attempt decryption
  //     const decrypted: cciFields = Decrypt(
  //       encrypted,
  //       Buffer.from(recipient.privateKey),
  //       invalidPubkey
  //     );

  //     // Expect fields unchanged, i.e. no decryption performed
  //     expect(decrypted).toEqual(encrypted);
  //   });


  //   it('fails gently if no nonce provided on decryption', () => {
  //     const plaintext = "Decryptio impossibilis est sine numere unico"
  //     const fields: cciFields = new cciFields(
  //       cciField.Payload(plaintext),
  //       cciFrozenFieldDefinition,
  //     );

  //     // Encrypt the fields
  //     const encrypted: cciFields = new cciFields(Encrypt(
  //       fields,
  //       Buffer.from(sender.privateKey),
  //       Buffer.from(recipient.publicKey),
  //     ), cciFrozenFieldDefinition);

  //     // Remove the nonce
  //     const nonce = encrypted.getFirst(cciFieldType.CRYPTO_NONCE);
  //     encrypted.removeField(nonce);

  //     // Attempt decryption
  //     const decrypted: cciFields = Decrypt(encrypted, Buffer.from(recipient.privateKey));

  //     // Expect fields unchanged, i.e. no decryption performed
  //     expect(decrypted).toEqual(encrypted);
  //   });


  //   it('fails gently if nonce is invalid on decryption', () => {
  //     const plaintext = "Si numere unico non sit validus, decryptio deficiet"
  //     const fields: cciFields = new cciFields(
  //       cciField.Payload(plaintext),
  //       cciFrozenFieldDefinition,
  //     );

  //     // Encrypt the fields
  //     const encrypted: cciFields = new cciFields(Encrypt(
  //       fields,
  //       Buffer.from(sender.privateKey),
  //       Buffer.from(recipient.publicKey),
  //     ), cciFrozenFieldDefinition);

  //     // Temper with nonce
  //     const nonce = encrypted.getFirst(cciFieldType.CRYPTO_NONCE);
  //     nonce.value.writeUint16BE(31337);

  //     // Attempt decryption
  //     const decrypted: cciFields = Decrypt(encrypted, Buffer.from(recipient.privateKey));

  //     // Expect fields unchanged, i.e. no decryption performed
  //     expect(decrypted).toEqual(encrypted);
  //   });
  // });  // Decrypt() edge case tests

});
