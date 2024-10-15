import { cciCube } from "../../../src/cci/cube/cciCube";
import { cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { KeyPair } from "../../../src/cci/helpers/cryptography";
import { Decrypt } from "../../../src/cci/veritum/chunkDecryption";
import { Continuation } from "../../../src/cci/veritum/continuation";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { CubeType } from "../../../src/core/cube/cube.definitions";
import { requiredDifficulty, tooLong, evenLonger, farTooLong } from "../testcci.definitions";

import sodium from 'libsodium-wrappers-sumo'

describe('CCI Veritum encryption', () => {
  const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
  const payloadField = cciField.Payload(plaintext);
  const longPayloadField = cciField.Payload(tooLong);
  const applicationField = cciField.Application("contentum probationis non applicationis");

  describe('encryption-decryption round trip tests', () => {
    let senderKeyPair: KeyPair;
    let recipientKeyPair: KeyPair;

    beforeAll(async () => {
      await sodium.ready;
      const uint8senderKeyPair = sodium.crypto_box_keypair();
      senderKeyPair = {
        publicKey: Buffer.from(uint8senderKeyPair.publicKey),
        privateKey: Buffer.from(uint8senderKeyPair.privateKey),
      };
      const uint8recipientKeyPair = sodium.crypto_box_keypair();
      recipientKeyPair = {
        publicKey: Buffer.from(uint8recipientKeyPair.publicKey),
        privateKey: Buffer.from(uint8recipientKeyPair.privateKey),
      };
    })

    describe('single recipient', () => {
      describe('single chunk', () => {
        it('encrypts a Veritum having a single payload field', async() => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: payloadField,
          });
          await veritum.compile({
            recipients: recipientKeyPair.publicKey,
            senderPrivateKey: senderKeyPair.privateKey,
            senderPubkey: senderKeyPair.publicKey,
            requiredDifficulty,
          });
          // just check that the Veritum has compiled as expected
          expect(veritum.compiled).toHaveLength(1);
          // the resulting (single) chunk Cube must have an ENCRYPTED field
          expect(veritum.compiled[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
          // it must not however have a PAYLOAD field (as it's encrypted now)
          expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();

          // restore & decrypt the Veritum from its chunks
          const restored: Veritum = Veritum.FromChunks(veritum.compiled, {
            recipientPrivateKey: recipientKeyPair.privateKey,
          });
          // after decryption, there must now be a PAYLOAD field but
          // no longer an ENCRYPTED field
          expect(restored.getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
          expect(restored.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
          // ensure payload is readable
          expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(plaintext);
        });

        it('encrypts fields excluding specific fields', async() => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, payloadField],
          });
          await veritum.compile({
            recipients: recipientKeyPair.publicKey,
            senderPrivateKey: senderKeyPair.privateKey,
            requiredDifficulty,
            excludeFromEncryption: [...Continuation.ContinuationDefaultExclusions, cciFieldType.APPLICATION],
            senderPubkey: senderKeyPair.publicKey,
          });
          // expect the APPLICATION field to be kept
          expect(veritum.compiled[0].getFirstField(cciFieldType.APPLICATION)).toEqual(applicationField);
          // expect there to be an ENCRYPTED field
          expect(veritum.compiled[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
          // expect encrypted fields not to contain any PAYLOAD field
          expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
        });
      });  // single recipient → single chunk

      describe('multiple chunks', () => {
        it.each([
          ["two-chunk", 2, tooLong],
          ["three-chunk", 3, evenLonger],
          ["very long", 10, farTooLong],
        ])('encrypts a %s Veritum to a single recipient', async(name, minChunks, payloadString) => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: cciField.Payload(payloadString), requiredDifficulty});
          await veritum.compile({
            recipients: recipientKeyPair.publicKey,
            senderPrivateKey: senderKeyPair.privateKey,
            senderPubkey: senderKeyPair.publicKey,
            requiredDifficulty,
          });
          expect(Array.from(veritum.compiled).length).toBeGreaterThanOrEqual(minChunks);

          // expect both chunks to have an ENCRYPTED field, but both PAYLOAD
          // and RELATES_TO fields are encrypted and therefore invisible
          for (const chunk of veritum.compiled) {
            expect(chunk.getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
            expect(chunk.getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
            expect(chunk.getFirstField(cciFieldType.RELATES_TO)).toBeUndefined();
          }

          const restored: Veritum = Veritum.FromChunks(veritum.compiled, {
            recipientPrivateKey: recipientKeyPair.privateKey,
          });
          expect(restored.cubeType).toBe(CubeType.FROZEN);
          expect(restored.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
          expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
            payloadString);
        });

        it('uses continuation mode for a multi-chunk Veritum ' +
           'and uses a different nonce in each chunk', async() => {
          const veritum = new Veritum(
            { cubeType: CubeType.FROZEN, fields: cciField.Payload(tooLong) });
          await veritum.compile({
            recipients: recipientKeyPair.publicKey,
            senderPrivateKey: senderKeyPair.privateKey,
            senderPubkey: senderKeyPair.publicKey,
            requiredDifficulty,
          });
          // just check that the Veritum has compiled as expected
          expect(veritum.compiled).toHaveLength(2);

          // verify the first chunk decrypts using the ECDH agreed secret and
          // the nonce included
          const cryptoBlob: Buffer = veritum.compiled[0].getFirstField(
            cciFieldType.ENCRYPTED).value;
          const includedPubkey: Buffer = cryptoBlob.subarray(
            0, sodium.crypto_box_PUBLICKEYBYTES);
          const includedNonce: Buffer = cryptoBlob.subarray(
            sodium.crypto_box_PUBLICKEYBYTES,
            sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES);
          const ciphertext: Buffer = cryptoBlob.subarray(
            sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES,
            cryptoBlob.length);
          const sharedSecret: Uint8Array = sodium.crypto_box_beforenm(
            includedPubkey, recipientKeyPair.privateKey);
          const plaintext: Uint8Array = sodium.crypto_secretbox_open_easy(
            ciphertext, includedNonce, sharedSecret);
          expect(Buffer.from(plaintext).toString('utf-8')).toContain(
            tooLong.substring(0, 800));

          // verify that the second chunk decrypts using the same secret and the
          // hash of the first nonce
          const ciphertext2: Buffer = veritum.compiled[1].getFirstField(
            cciFieldType.ENCRYPTED).value;
          const nonce2: Uint8Array = sodium.crypto_generichash(
            sodium.crypto_secretbox_NONCEBYTES, includedNonce);
          const plaintext2: Uint8Array = sodium.crypto_secretbox_open_easy(
            ciphertext2, nonce2, sharedSecret);
          expect(Buffer.from(plaintext2).toString('utf-8')).toContain(
            tooLong.substring(1024, tooLong.length));

          // verify that the second chunk cannot be decrypted using the first nonce
          expect(() => sodium.crypto_secretbox_open_easy(
            ciphertext2, includedNonce, sharedSecret)).toThrow();
        });
      });  // single recipient → multiple chunks
    });  // single recipient


    describe('multiple recipients', () => {
      it('encrypts a Veritum having a single payload field for three recipients', async () => {
        // Generate key pairs for three recipients
        const recipientKeyPairs: KeyPair[] = [];
        for (let i = 0; i < 3; i++) {
          const uint8KeyPair = sodium.crypto_box_keypair();
          recipientKeyPairs.push({
            publicKey: Buffer.from(uint8KeyPair.publicKey),
            privateKey: Buffer.from(uint8KeyPair.privateKey),
          });
        }

        // Create a Veritum instance with a single payload field
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN, fields: payloadField });

        // Compile the Veritum instance with encryption options for the three recipients
        await veritum.compile({
          recipients: recipientKeyPairs.map(kp => kp.publicKey),
          senderPrivateKey: senderKeyPair.privateKey,
          requiredDifficulty,
          senderPubkey: senderKeyPair.publicKey,
        });

        // Verify that the compiled Veritum contains the expected encrypted fields,
        // but no plaintext payload field
        expect(veritum.compiled).toHaveLength(1);
        const compiledChunk = veritum.compiled[0];
        expect(compiledChunk.getFields(cciFieldType.PAYLOAD)).toHaveLength(0);
        expect(compiledChunk.getFields(cciFieldType.ENCRYPTED)).toHaveLength(1);

        // Attempt decryption for each of the three recipients
        for (const recipient of recipientKeyPairs) {
          const restored = Veritum.FromChunks(veritum.compiled,
            { recipientPrivateKey: recipient.privateKey });
          expect(restored.getFirstField(cciFieldType.PAYLOAD)).toEqual(payloadField);
        }
      });

      it.each([
        ["two-chunk", 1, tooLong],
        ["three-chunk", 2, evenLonger],
        ["very long", 10, farTooLong],
      ])('encrypts a %s Veritum to three recipients', async(name, minChunks, payloadString) => {
        // Generate key pairs for three recipients
        const recipientKeyPairs: KeyPair[] = [];
        for (let i = 0; i < 3; i++) {
          const uint8KeyPair = sodium.crypto_box_keypair();
          recipientKeyPairs.push({
            publicKey: Buffer.from(uint8KeyPair.publicKey),
            privateKey: Buffer.from(uint8KeyPair.privateKey),
          });
        }

        // construct the encrypted Veritum
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: cciField.Payload(payloadString),
          requiredDifficulty,
        });
        await veritum.compile({
          senderPrivateKey: senderKeyPair.privateKey,
          senderPubkey: senderKeyPair.publicKey,
          recipients: recipientKeyPairs.map(kp => kp.publicKey),
          requiredDifficulty,
        });
        expect(Array.from(veritum.compiled).length).toBeGreaterThanOrEqual(minChunks);

        // expect both chunks to have an ENCRYPTED field, but both PAYLOAD
        // and RELATES_TO fields are encrypted and therefore invisible
        for (const chunk of veritum.compiled) {
          expect(chunk.getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
          expect(chunk.getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
          expect(chunk.getFirstField(cciFieldType.RELATES_TO)).toBeUndefined();
        }

        // verify decryption for all three recipients
        for (const recipient of recipientKeyPairs) {
          const restored: Veritum = Veritum.FromChunks(veritum.compiled, {
            recipientPrivateKey: recipient.privateKey,
          });
          expect(restored.cubeType).toBe(CubeType.FROZEN);
          expect(restored.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
          expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
            payloadString);
        }
      });

      describe('encrypts a multi-chunk Veritum for more recipients than a single Cube holds key slots', () => {
        let recipients: KeyPair[] = [];
        let veritum: Veritum;

        beforeAll(async () => {
          // make 50 recipients
          for (let i = 0; i < 40; i++) {
            const uint8senderKeyPair = sodium.crypto_box_keypair();
            const keyPair = {
              publicKey: Buffer.from(uint8senderKeyPair.publicKey),
              privateKey: Buffer.from(uint8senderKeyPair.privateKey),
            };
            recipients.push(keyPair);
          }

          // Create a Veritum instance with a long payload field
          veritum = new Veritum({
            cubeType: CubeType.FROZEN, fields: longPayloadField });

          // Compile the Veritum instance with encryption options for the three recipients
          await veritum.compile({
            recipients: recipients.map(kp => kp.publicKey),
            senderPrivateKey: senderKeyPair.privateKey,
            requiredDifficulty,
            senderPubkey: senderKeyPair.publicKey,
          });
        });

        it('encrypts correctly', async () => {
          expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
          expect(veritum.compiled[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();

          // verify this indeed uses more than one key chunk
          expect(veritum.keyChunkNo).toBeGreaterThan(1);
        });

        it('is decryptable by all recipients when supplied as a whole', async () => {
          // Ensure that the Veritum is decryptable by all recipients
          for (const recipient of recipients) {
            const restored = Veritum.FromChunks(veritum.compiled, {
              recipientPrivateKey: recipient.privateKey,
            });
            expect(restored.cubeType).toBe(CubeType.FROZEN);
            expect(restored.getFirstField(cciFieldType.PAYLOAD)?.valueString).toEqual(
              tooLong);
          }
        });

        // Note: This test performs a lot of asymmetric operations;
        // we may want to either reduce its impact or skip it in the future.
        it('can supply the correct key chunk for each recipient', async () => {
          for (const recipient of recipients) {
            const keyChunk: cciCube = veritum.getRecipientKeyChunk(recipient.publicKey);
            expect(keyChunk).toBeInstanceOf(cciCube);
            // verify this is the correct key chunk by trying to decrypt it
            expect(keyChunk.getFirstField(cciFieldType.RELATES_TO)).toBeUndefined();
            const decryptedKeyChunk = Decrypt(keyChunk.manipulateFields(),
              { recipientPrivateKey: recipient.privateKey });
            expect(decryptedKeyChunk).toBeDefined();
            expect(decryptedKeyChunk.getFirst(cciFieldType.RELATES_TO)).toBeDefined();
          }
        });

        // Note: This test performs a lot of asymmetric operations;
        // we may want to either reduce its impact or skip it in the future.
        it('is decryptable by all recipient if supplied with the correct key chunk', async () => {
          for (const recipient of recipients) {
            const myChunks: cciCube[] = Array.from(
              veritum.getRecipientChunks(recipient.publicKey));
            const restored: Veritum = Veritum.FromChunks(myChunks, {
              recipientPrivateKey: recipient.privateKey });
            expect(restored.getFirstField(cciFieldType.PAYLOAD)?.valueString).toEqual(
              tooLong);
          }
        });

        it('is not decryptable by a recipient if supplied with the wrong key chunk', () => {
          // Test by example: The first recipient is not expected to be included
          // in the last key chunk; therefore, the first recipient should
          // not be able to decrypt the version of the Veritum including only
          // the last key chunk.
          const recipient = recipients[0];
          const veritumWithCorrectKeyChunk: cciCube[] = [];
          const veritumWithWrongKeyChunk: cciCube[] = [];
          let i=0;
          for (const chunk of veritum.compiled) {
            if (i === 0) veritumWithCorrectKeyChunk.push(chunk);
            if (i === veritum.keyChunkNo - 1) veritumWithWrongKeyChunk.push(chunk);
            if (i > veritum.keyChunkNo) {
              veritumWithCorrectKeyChunk.push(chunk);
              veritumWithWrongKeyChunk.push(chunk);
            }
            i++;
          }
          // verify our test setup:
          // recipient should be able to decrypt the chain including the
          // correct key chunk
          const canDecrypt: Veritum = Veritum.FromChunks(veritumWithCorrectKeyChunk, {
            recipientPrivateKey: recipient.privateKey,
          });
          expect(canDecrypt.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
          expect(canDecrypt.getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
          // but recipient should not be able to decrypt the chain including
          // the wrong key chunk
          const cannotDecrypt: Veritum = Veritum.FromChunks(veritumWithWrongKeyChunk, {
            recipientPrivateKey: recipient.privateKey,
          });
          expect(cannotDecrypt.getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
        });

        it('never has duplicate data in its encrypted chunks', () => {
          // Ensure that no 8 byte (64 bit) string ever gets repeated
          // throughout the encrypted chunks.
          // 8 bytes is an aribitrary number large enough to be unlikely to be
          // repeated by pure chance.

          // First, concatenate all of this Veritum's encrypted fields
          // into a single blob
          let blob: Buffer = Buffer.alloc(0);
          for (const chunk of veritum.compiled) {
            const encryptedField = chunk.getFirstField(cciFieldType.ENCRYPTED);
            expect(encryptedField.value).toBeInstanceOf(Buffer);
            blob = Buffer.concat([blob, encryptedField.value]);
          }

          // Now ensure each 8 byte chunk is unique throughout the blob
          let i: number = 0;
          while (i < blob.length - 8) {
            const shouldBeUnique = blob.subarray(i, i + 8);
            let occurences: number = 0;
            let j: number = 0;
            while (j < blob.length - 8) {
              const compareTo = blob.subarray(j, j + 8);
              if (compareTo.equals(shouldBeUnique)) occurences++;
              j++;
            }
            expect(occurences).toBe(1);
            i++;
          }
        });

        it.todo('uses different nonces for all chunks, including key distribution chunks');
      });  // encrypts a multi-chunk Veritum for more recipients than a single Cube holds key slots
    });  // multiple recipients
  });

  describe('TODOs', () => {
    it.todo('calculates the chunk sizes for different Cube types');
    it.todo('calculates the chunk sizes correctly when including auxialliary non-encrypted data');
  });
});
