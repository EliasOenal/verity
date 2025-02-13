import { cciNodeIf, DummyCciNode } from "../../src/cci/cciNode";
import { Cockpit } from "../../src/cci/cockpit";
import { cciFieldType } from "../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../src/cci/cube/cciField";
import { Identity } from "../../src/cci/identity/identity";
import { Veritum } from "../../src/cci/veritum/veritum";
import { CubeType } from "../../src/core/cube/cube.definitions";
import { NetConstants } from "../../src/core/networking/networkDefinitions";

import { masterKey, idTestOptions, remote1MasterKey, remote2MasterKey, requiredDifficulty, tooLong } from "./testcci.definitions";
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('cci Cockpit', () => {
  // Run tests both with and without an Identity object,
  // i.e. both logged-in and logged-out
  for (const loggedIn of [true, false]) {
    describe(`Tests ${loggedIn ? "while logged in, i.e. with an Identity object" : "while logged out, i.e. without an Identity object"}`, () => {
      let node: cciNodeIf;
      let identity: Identity;
      let remote1: Identity;
      let remote2: Identity;
      let cockpit: Cockpit;

      beforeAll(async () => {
        node = new DummyCciNode({requiredDifficulty});
        await node.readyPromise;
        if (loggedIn) {
          identity = new Identity(node.cubeStore, masterKey, idTestOptions);
          remote1 = new Identity(node.cubeStore, remote1MasterKey, idTestOptions);
          remote2 = new Identity(node.cubeStore, remote2MasterKey, idTestOptions);
        }
        cockpit = new Cockpit(node, {identity: identity});
      });

      afterAll(async () => {
        if (loggedIn) {
          await identity.shutdown();
          await remote1.shutdown();
          await remote2.shutdown();
        }
        await node.shutdown();
      });

      describe('prepareVeritum()', () => {
        it('can create single-chunk frozen Verita', () => {
          const veritum = cockpit.prepareVeritum({
            cubeType: CubeType.FROZEN,
            fields: cciField.Payload("Hoc veritum breve et congelatum est"),
            requiredDifficulty: requiredDifficulty,
          });
          expect(veritum.cubeType).toBe(CubeType.FROZEN);
          expect(veritum.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
            "Hoc veritum breve et congelatum est");
        });

        // TODO: Continuation doesn't actually handle MUC subkey derivation yet
        it.skip('can create single-chunk MUC Verita', () => {
          const veritum = cockpit.prepareVeritum({
            cubeType: CubeType.MUC,
            fields: cciField.Payload("Hoc veritum breve sed mutabile est"),
            requiredDifficulty: requiredDifficulty,
          });
          expect(veritum.cubeType).toBe(CubeType.MUC);
          expect(veritum.publicKey).toBe(identity.key);
          expect(veritum.privateKey).toBe(identity.privateKey);
          expect(veritum.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
            "Hoc veritum breve sed mutabile est");
        });

        it.todo('write tests for all Cube types, both single and multi chunk');
      });  // prepareVeritum()


      describe('publishVeritum() for existing Verita', () => {
        let veritum: Veritum;

        beforeAll(async () => {
          veritum = cockpit.prepareVeritum({
            cubeType: CubeType.FROZEN,
            fields: cciField.Payload(tooLong),
            requiredDifficulty: requiredDifficulty,
          });
          await cockpit.publishVeritum(veritum);
        });

        it('adds all chunks of a multi-Chunk Veritum to the local CubeStore', async() => {
          const chunks = Array.from(veritum.chunks);
          expect(chunks.length).toBeGreaterThan(1);

          for (const chunk of chunks) {
            const cube = await node.cubeStore.getCube(await chunk.getKey());
            expect(cube.equals(chunk)).toBe(true);
          }
        });

        if (loggedIn) it('stores the Veritum as a post in my Identity by default', async() => {
          expect(identity.hasPost(await veritum.getKey())).toBe(true);
        })

        if (loggedIn) it('can encrypt the Veritum for a single recipient', async() => {
          const latinBraggery = "Hoc veritum breve et cryptatum est";
          const veritum = cockpit.prepareVeritum({
            cubeType: CubeType.FROZEN,
            fields: cciField.Payload(latinBraggery),
            requiredDifficulty,
          });
          await cockpit.publishVeritum(veritum, {
            recipients: remote1,
            senderPubkey: identity.encryptionPublicKey,
          })
          // the (single) chunk must have an ENCRYPTED field but no PAYLOAD field
          expect(veritum.chunks[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
          expect(veritum.chunks[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();

          // the encrypted compiled Verium must be decryptable by the recipient
          const restored = Veritum.FromChunks(veritum.chunks, {
            recipientPrivateKey: remote1.encryptionPrivateKey,
          });
          // now we must be back to a PAYLOAD field but no ENCRYPTED field
          expect(restored.getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
          expect(restored.getFirstField(cciFieldType.ENCRYPTED)).toBeUndefined();
          expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(latinBraggery);
        });

        if (loggedIn) it.todo('can create an encrypted Veritum for multiple recipients');

      });  // publishVeritum() for existing Verita


      describe('publishVeritum() for new Verita', () => {
        let veritum: Veritum;
        const latinBraggary = "Hoc Veritum uno actu scriptum et prolatum est";

        beforeAll(async () => {
          veritum = await cockpit.publishVeritum({
            cubeType: CubeType.PIC,
            fields: cciField.Payload(latinBraggary),
            requiredDifficulty: requiredDifficulty,
          });
        });

        it('adds the Veritum to CubeStore', async() => {
          const cube = await node.cubeStore.getCube(await veritum.getKey());
          expect(cube.cubeType).toBe(CubeType.PIC);
          expect(cube.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(latinBraggary);
        });

        if (loggedIn) it('stores the Veritum as a post in my Identity by default', async() => {
          expect(identity.hasPost(await veritum.getKey())).toBe(true);
        });
      });

      describe('getVeritum()', () => {
        it('restores a multi-Chunk frozen Veritum from the local CubeStore', async () => {
          // prepare Veritum
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: cciField.Payload(tooLong), requiredDifficulty,
          });
          await veritum.compile();
          expect(Array.from(veritum.chunks).length).toBeGreaterThan(1);
          const key = veritum.getKeyIfAvailable();
          expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);

          // publish Veritum
          for (const chunk of veritum.chunks) await node.cubeStore.addCube(chunk);

          // perform test
          const restored: Veritum = await cockpit.getVeritum(veritum.getKeyIfAvailable());
          expect(restored.equals(veritum)).toBe(true);
        });

        if (loggedIn) it("automatically decrypts a single-chunk encrypted Veritum if sender's public key is included", async() => {
          // prepare Veritum
          const latinBraggery = "Hoc veritum breve et cryptatum est";
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: cciField.Payload(latinBraggery),
            requiredDifficulty,
          });
          await veritum.compile({
            senderPubkey: remote1.encryptionPublicKey,
            senderPrivateKey: remote1.encryptionPrivateKey,
            recipients: identity,
          })

          // expect compiled veritum to be encrypted
          expect(veritum.chunks[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
          expect(veritum.chunks[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();

          // publish Veritum
          await node.cubeStore.addCube(veritum.chunks[0]);

          // perform test
          const restored: Veritum = await cockpit.getVeritum(
            veritum.getKeyIfAvailable()
          );
          expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
            latinBraggery);
        });

        // fails due to a problem with split-then-encrypt, see lower-level test in Veritum
        if (loggedIn) it.skip("automatically decrypts a multi-chunk encrypted Veritum if sender's public key is supplied", async() => {
          // prepare Veritum
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: cciField.Payload(tooLong),
            requiredDifficulty,
          });
          await veritum.compile({
            // includeSenderPubkey: remote1.encryptionPublicKey,
            senderPrivateKey: remote1.encryptionPrivateKey,
            recipients: identity,
            senderPubkey: remote1.encryptionPublicKey
          })

          // expect compiled veritum to be encrypted
          expect(veritum.chunks[0].getFirstField(cciFieldType.ENCRYPTED)).toBeDefined();
          expect(veritum.chunks[0].getFirstField(cciFieldType.PAYLOAD)).toBeUndefined();

          // publish Veritum
          for (const chunk of veritum.chunks) await node.cubeStore.addCube(chunk);

          // perform test
          const restored: Veritum = await cockpit.getVeritum(
            veritum.getKeyIfAvailable()
          );
          expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
            tooLong);
        });
      });  // getVeritum()

    });  // block of tests for both logged-in and logged-out users
  }  // for (const loggedIn of [true, false])

});
