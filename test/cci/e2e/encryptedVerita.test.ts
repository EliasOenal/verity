import type { CubeKey } from "../../../src/core/cube/cube.definitions";
import type { CubeInfo } from "../../../src/core/cube/cubeInfo";
import type { cciCube } from "../../../src/cci/cube/cciCube";

import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import { FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Identity } from "../../../src/cci/identity/identity";
import { Veritum } from "../../../src/cci/veritum/veritum";

import { cciLineShapedNetwork } from "./e2eCciSetup";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Transmission of encrypted Verita', () => {
  describe('Publishing an encrypted Veritum for a single recipient', () => {
    let net: cciLineShapedNetwork;
    const plaintext = "Nuntius secretus quem nemo praeter te legere potest";

    test('recipient receives and decrypts Veritum', async() => {
      // Create a simple line-shaped network
      net = await cciLineShapedNetwork.Create(61201, 61202);

      // Sculpt a simple Veritum
      const veritum: Veritum = net.sender.prepareVeritum(
        { fields: VerityField.Payload(plaintext) });
      // Publish it encrypted solely for the recipient
      await net.sender.publishVeritum(
        veritum, {
          recipients: net.recipient.identity,
          addAsPost: false,
          requiredDifficulty: 0,
      });
      const key: CubeKey = veritum.getKeyIfAvailable();

      // Verify test setup:
      // - Key should be valid
      expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);
      // - Veritum should consist of a single Cube
      const originalChunks: cciCube[] = Array.from(veritum.chunks);
      expect(originalChunks).toHaveLength(1);
      // - Encrypted chunk has an ENCRYPTED but no PAYLOAD field
      expect(originalChunks[0].getFirstField(FieldType.ENCRYPTED)).toBeDefined();
      expect(originalChunks[0].getFirstField(FieldType.PAYLOAD)).toBeUndefined();

      // Reference Veritum thorugh Identity MUC
      // Note: This is also possible to do automatically through publishVeritum();
      //   in fact, we just opted out of it above.
      //   That's because publishVeritum does many things at once, one of those
      //   is calculate the key. If we use it, we don't manage to create our
      //   propagation promises in time.
      net.sender.identity.addPost(veritum.getKeyIfAvailable());
      expect(net.sender.identity.getPostCount()).toBe(1);
      net.sender.identity.store();
      const idPropagated: Promise<CubeInfo> =
        net.fullNode2.cubeStore.expectCube(net.sender.identity.key);

      // Wait for network propagation
      // Note: Creating the veritumPropagated promise here is a bit late, as
      //   propagation already started while we awaited publishVeritum().
      //   To compensate, let's create a competing Promise that will resolve
      //   if it has already propagated.
      const veritumWillPropagate: Promise<CubeInfo> = net.fullNode2.cubeStore.expectCube(key);
      const veritumAlreadyArrived: CubeInfo = await net.fullNode2.cubeStore.getCubeInfo(key);
      const veritumPropagated = veritumAlreadyArrived ? Promise.resolve() : veritumWillPropagate;
      await Promise.all([veritumPropagated, idPropagated]);

      // verify test setup
      const propagated: cciCube = await net.fullNode2.cubeStore.getCube(key);
      expect(propagated).toBeDefined();

      // Recipient learns about sender out of band and subscribes to them
      // TODO: expose this though a simplified cciCockpit API
      const sub: Identity = await Identity.Construct(
        net.recipient.node.cubeRetriever,
        await net.recipient.node.cubeRetriever.getCube(net.sender.identity.key) as cciCube
      );
      expect(sub.getPostCount()).toEqual(1);  // TODO fix: this sometimes fails
      const retrievedKey: CubeKey = Array.from(sub.getPostKeys())[0];
      expect(retrievedKey.equals(key)).toBe(true);
      const retrieved: Veritum = await net.recipient.getVeritum(retrievedKey);
      // expect Veritum received
      expect(retrieved).toBeDefined();

      // debugging intermezzo (see Github#835):
      // Attempt a manual decryption first.
      // Below, we will still expect the Veritum to have been auto-decrypted
      // on the initial retrieval.
      // - Original Veritum as present on sender-side should be decryptable by the recipient
      const testDecryption = Veritum.FromChunks(originalChunks, {
        recipientPrivateKey: net.recipient.identity.encryptionPrivateKey,
      });
      expect.soft(testDecryption.getFirstField(FieldType.PAYLOAD)).toBeDefined();
      expect.soft(testDecryption.getFirstField(FieldType.ENCRYPTED)).toBeUndefined();
      // - Veritum received over the wire at recipient-side should be identical
      const manualDecryptionCipherchunk: cciCube =
        await net.recipient.node.cubeStore.getCube(key);
      expect(manualDecryptionCipherchunk.getBinaryDataIfAvailable().length).toBe(NetConstants.CUBE_SIZE);
      expect(originalChunks[0].getBinaryDataIfAvailable()
        .equals(manualDecryptionCipherchunk.getBinaryDataIfAvailable()))
        .toBe(true);
      // - Veritum received over the wire at recipient-side should be decryptable
      const manualDecryptionPlain: Veritum = Veritum.FromChunks(
        [manualDecryptionCipherchunk],
        { recipientPrivateKey: net.recipient.identity.encryptionPrivateKey }
      );
      expect.soft(manualDecryptionPlain.getFirstField(FieldType.PAYLOAD)).toBeDefined();
      expect.soft(manualDecryptionPlain.getFirstField(FieldType.PAYLOAD).valueString).toBe(plaintext);
      expect.soft(manualDecryptionPlain.getFirstField(FieldType.ENCRYPTED)).toBeUndefined();

      // expect Veritum auto-decrypted on initial retrieval
      expect.soft(retrieved.getFirstField(FieldType.ENCRYPTED)).not.toBeDefined();
      // TODO FIXME this sometimes fails and I don't know why :(
      expect.soft(retrieved.getFirstField(FieldType.PAYLOAD)).toBeDefined();

      // expect plaintext to be restored correctly
      expect(retrieved.getFirstField(FieldType.PAYLOAD).valueString).toBe(plaintext);  // TODO fix: this sometimes fails
    });
  }, 20000);  // Publishing an encrypted Veritum for a single recipient
});
