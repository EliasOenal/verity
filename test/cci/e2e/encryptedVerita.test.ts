import type { CubeKey } from "../../../src/core/cube/cube.definitions";
import type { CubeInfo } from "../../../src/core/cube/cubeInfo";
import type { cciCube } from "../../../src/cci/cube/cciCube";

import { cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { Identity } from "../../../src/cci/identity/identity";
import { Veritum } from "../../../src/cci/veritum/veritum";

import { cciLineShapedNetwork } from "./e2eCciSetup";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Transmission of encrypted Verita', () => {
  describe('Publishing an encrypted Veritum for a single recipient', () => {
    let net: cciLineShapedNetwork;
    const plaintext = "Nuntius secretus quem nemo praeter te legere potest";

    beforeAll(async () => {
      // Create a simple line-shaped network
      net = await cciLineShapedNetwork.Create(61201, 61202);

      // Sculpt a simple Veritum for a single recipient
      const veritum: Veritum = net.sender.makeVeritum(
        { fields: cciField.Payload(plaintext) });
      // Publish it encrypted solely for the recipient
      await net.sender.publishVeritum(
        veritum, { recipients: net.recipient.identity });
      const key: CubeKey = veritum.getKeyIfAvailable();
      expect(key).toBeDefined();
      const veritumPropagated: Promise<CubeInfo> = net.fullNode2.cubeStore.expectCube(key);

      // Reference Veritum thorugh Identity MUC --
      // TODO: do that automatically (opt-in or opt-out) through publishVeritum()
      net.sender.identity.addPost(veritum.getKeyIfAvailable());
      expect(net.sender.identity.getPostCount()).toBe(1);
      net.sender.identity.store();
      const idPropagated: Promise<CubeInfo> =
        net.fullNode2.cubeStore.expectCube(net.sender.identity.key);

      // give it some time to propagate through the network
      await Promise.all([veritumPropagated, idPropagated]);

      // verify test setup
      const propagated: cciCube = await net.fullNode2.cubeStore.getCube(key);
      expect(propagated).toBeDefined();
    });

    test('recipient receives and decrypts Veritum', async() => {
      // Recipient learns about sender out of band and subscribes to them
      // TODO: expose this though a simplified cciCockpit API
      const sub: Identity = await Identity.Construct(
        net.recipient.node.cubeRetriever,
        await net.recipient.node.cubeRetriever.getCube(net.sender.identity.key) as cciCube
      );
      expect(sub.getPostCount()).toEqual(1);  // TODO fix: this sometimes fails
      const key: CubeKey = Array.from(sub.getPostKeys())[0];
      expect(key).toBeDefined();
      const retrieved: Veritum = await net.recipient.getVeritum(key);
      expect(retrieved).toBeDefined();
      expect(retrieved.getFirstField(cciFieldType.PAYLOAD).valueString).toBe(plaintext);
    });
  });  // Publishing an encrypted Veritum for a single recipient
});
