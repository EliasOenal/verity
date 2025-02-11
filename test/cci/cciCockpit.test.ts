import { cciNodeIf, DummyCciNode } from "../../src/cci/cciNode";
import { cciCockpit } from "../../src/cci/cockpit";
import { cciFieldType } from "../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../src/cci/cube/cciField";
import { Identity } from "../../src/cci/identity/identity";
import { Veritum } from "../../src/cci/veritum/veritum";
import { CubeType } from "../../src/core/cube/cube.definitions";
import { NetConstants } from "../../src/core/networking/networkDefinitions";

import { masterKey, idTestOptions, remote1MasterKey, remote2MasterKey, requiredDifficulty, tooLong } from "./testcci.definitions";
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('cci Cockpit', () => {
  let node: cciNodeIf;
  let identity: Identity;
  let remote1: Identity;
  let remote2: Identity;
  let cockpit: cciCockpit;

  beforeEach(async () => {
    node = new DummyCciNode({requiredDifficulty});
    await node.readyPromise;
    identity = new Identity(node.cubeStore, masterKey, idTestOptions);
    remote1 = new Identity(node.cubeStore, remote1MasterKey, idTestOptions);
    remote2 = new Identity(node.cubeStore, remote2MasterKey, idTestOptions);
    cockpit = new cciCockpit(node, {identity: identity});
  });

  afterEach(async () => {
    await node.shutdown();
  });

  describe('makeVeritum()', () => {
    it('can create frozen Verita', () => {
      const veritum = cockpit.makeVeritum({
        cubeType: CubeType.FROZEN,
        fields: cciField.Payload("Hoc veritum breve et congelatum est"),
        requiredDifficulty: requiredDifficulty,
      });
      expect(veritum.cubeType).toBe(CubeType.FROZEN);
      expect(veritum.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
        "Hoc veritum breve et congelatum est");
    });

    // Note / TODO somewhere else: Continuation doesn't actually handle MUC subkey derivation yet
    it('can create MUC Verita', () => {
      const veritum = cockpit.makeVeritum({
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
  });

  describe('publishVeritum()', () => {
    it('adds all chunks of a multi-Chunk Veritum to the local CubeStore', async() => {
      const veritum = cockpit.makeVeritum({
        cubeType: CubeType.FROZEN,
        fields: cciField.Payload(tooLong),
        requiredDifficulty: requiredDifficulty,
      });
      await cockpit.publishVeritum(veritum);

      const chunks = Array.from(veritum.chunks);
      expect(chunks.length).toBeGreaterThan(1);

      for (const chunk of chunks) {
        const cube = await node.cubeStore.getCube(await chunk.getKey());
        expect(cube.equals(chunk)).toBe(true);
      }
    });

    it('can encrypt the Veritum for a single recipient', async() => {
      const latinBraggery = "Hoc veritum breve et cryptatum est";
      const veritum = cockpit.makeVeritum({
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

    it.todo('can create an encrypted Veritum for multiple recipients');

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

    it("automatically decrypts a single-chunk encrypted Veritum if sender's public key is included", async() => {
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
    it.skip("automatically decrypts a multi-chunk encrypted Veritum if sender's public key is supplied", async() => {
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
  });

});