import { cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { KeyPair } from "../../../src/cci/helpers/cryptography";
import { Continuation } from "../../../src/cci/veritum/continuation";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { CubeType } from "../../../src/core/cube/cube.definitions";
import { requiredDifficulty, tooLong, evenLonger, farTooLong } from "../testcci.definitions";

import sodium from 'libsodium-wrappers-sumo'

describe('CCI Veritum encryption', () => {
  const plaintext = 'Nuntius cryptatus secretus est, ne intercipiatur';
  const payloadField = cciField.Payload(plaintext);
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
          const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });
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
          const veritum = new Veritum(CubeType.FROZEN, { fields: [applicationField, payloadField] });
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
          const veritum = new Veritum(CubeType.FROZEN, {
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
          const veritum = new Veritum(CubeType.FROZEN,
            { fields: cciField.Payload(tooLong) });
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
        const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });

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
        const veritum = new Veritum(CubeType.FROZEN, {
          fields: cciField.Payload(payloadString), requiredDifficulty});
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

      it('encrypts a Veritum for more recipients than a single Cube hold key slots', async() => {
        // make 50 recipients
        const recipients: KeyPair[] = [];
        for (let i = 0; i < 40; i++) {
          const uint8senderKeyPair = sodium.crypto_box_keypair();
          const keyPair = {
            publicKey: Buffer.from(uint8senderKeyPair.publicKey),
            privateKey: Buffer.from(uint8senderKeyPair.privateKey),
          };
          recipients.push(keyPair);
        }

        // Create a Veritum instance with a single payload field
        const veritum = new Veritum(CubeType.FROZEN, { fields: payloadField });

        // Compile the Veritum instance with encryption options for the three recipients
        await veritum.compile({
          recipients: recipients.map(kp => kp.publicKey),
          senderPrivateKey: senderKeyPair.privateKey,
          requiredDifficulty,
          senderPubkey: senderKeyPair.publicKey,
        });
        expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();
        expect(veritum.compiled[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();

        // Ensure that the Veritum is decryptable by all recipients
        for (const recipient of recipients) {
          const restored = Veritum.FromChunks(veritum.compiled, {
            recipientPrivateKey: recipient.privateKey,
          });
          expect(restored.cubeType).toBe(CubeType.FROZEN);
          expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
            payloadField.valueString);
        }
      });
    });  // multiple recipients
  });

  describe('TODOs', () => {
    it.todo('encrypts a multi-chunk Veritum to more recipients that fit in a Cube');
    it.todo('calculates the chunk sizes for different Cube types');
    it.todo('calculates the chunk sizes correctly when including auxialliary non-encrypted data');
  });
});
