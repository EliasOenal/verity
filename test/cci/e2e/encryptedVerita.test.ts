import type { CubeKey } from "../../../src/core/cube/cube.definitions";
import type { CubeInfo } from "../../../src/core/cube/cubeInfo";
import type { cciCube } from "../../../src/cci/cube/cciCube";

import { FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Identity } from "../../../src/cci/identity/identity";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { logger } from "../../../src/core/logger";

import { cciLineShapedNetwork } from "./e2eCciSetup";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Transmission of encrypted Verita', () => {
  describe('Publishing an encrypted Veritum for a single recipient', () => {
    let net: cciLineShapedNetwork;
    const plaintext = "Nuntius secretus quem nemo praeter te legere potest";

    beforeAll(async () => {
      // Create a simple line-shaped network
      net = await cciLineShapedNetwork.Create(61201, 61202);

      logger.debug('Network created, preparing encrypted veritum');
      
      // Verify encryption keys are available before proceeding
      expect(net.sender.identity.encryptionPrivateKey).toBeDefined();
      expect(net.sender.identity.encryptionPublicKey).toBeDefined();
      expect(net.recipient.identity.encryptionPrivateKey).toBeDefined();
      expect(net.recipient.identity.encryptionPublicKey).toBeDefined();

      // Sculpt a simple Veritum
      const veritum: Veritum = net.sender.prepareVeritum(
        { fields: VerityField.Payload(plaintext) });
      
      logger.debug(`Veritum prepared with fields: ${veritum.getFields().map(f => f.type).join(', ')}`);
      
      // Publish it encrypted solely for the recipient
      logger.debug('Publishing encrypted veritum for recipient');
      await net.sender.publishVeritum(
        veritum, { recipients: net.recipient.identity, addAsPost: false });
      const key: CubeKey = veritum.getKeyIfAvailable();
      expect(key).toBeDefined();
      
      logger.debug(`Veritum published with key: ${key.toString('hex')}`);

      // Note: Creating the veritumPropagated promise here is a bit late, as
      //   propagation already started while we awaited publishVeritum().
      //   To compensate, let's create a competing Promise that will resolve
      //   if it has already propagated.
      const veritumWillPropagate: Promise<CubeInfo> = net.fullNode2.cubeStore.expectCube(key);
      const veritumAlreadyArrived: CubeInfo = await net.fullNode2.cubeStore.getCubeInfo(key);
      const veritumPropagated = veritumAlreadyArrived ? Promise.resolve() : veritumWillPropagate;

      // Reference Veritum through Identity MUC
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

      logger.debug('Waiting for network propagation');
      // give it some time to propagate through the network
      await Promise.all([veritumPropagated, idPropagated]);
      logger.debug('Network propagation complete');

      // verify test setup
      const propagated: cciCube = await net.fullNode2.cubeStore.getCube(key);
      expect(propagated).toBeDefined();
      logger.debug('Test setup verification complete');
    });

    test('recipient receives and decrypts Veritum', async() => {
      // Verify that both identities have proper encryption keys
      expect(net.sender.identity.encryptionPrivateKey).toBeDefined();
      expect(net.sender.identity.encryptionPublicKey).toBeDefined();
      expect(net.recipient.identity.encryptionPrivateKey).toBeDefined();
      expect(net.recipient.identity.encryptionPublicKey).toBeDefined();
      
      logger.debug('Starting recipient receives and decrypts Veritum test');
      
      // Recipient learns about sender out of band and subscribes to them
      // TODO: expose this though a simplified cciCockpit API
      let sub: Identity = await Identity.Construct(
        net.recipient.node.cubeRetriever,
        await net.recipient.node.cubeRetriever.getCube(net.sender.identity.key) as cciCube
      );
      
      // Wait for the post to be properly propagated with retry logic
      let retries = 0;
      const maxRetries = 20;
      while (sub.getPostCount() === 0 && retries < maxRetries) {
        logger.debug(`Waiting for post propagation, attempt ${retries + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
        
        // Reconstruct the identity to get the latest state
        sub = await Identity.Construct(
          net.recipient.node.cubeRetriever,
          await net.recipient.node.cubeRetriever.getCube(net.sender.identity.key) as cciCube
        );
      }
      
      if (sub.getPostCount() > 0) {
        logger.debug(`Post found after ${retries} attempts`);
      }
      
      expect(sub.getPostCount()).toEqual(1);
      const key: CubeKey = Array.from(sub.getPostKeys())[0];
      expect(key).toBeDefined();
      
      logger.debug(`Retrieving veritum with key: ${key.toString('hex')}`);
      
      // Debug: Check if we can get the cube directly from the store first
      const cubeFromStore = await net.recipient.node.cubeStore.getCube(key);
      if (cubeFromStore?.fields?.fieldTypes) {
        logger.debug(`Cube from store field types: ${cubeFromStore.fields.fieldTypes.join(', ')}`);
      } else {
        logger.debug(`Cube from store has unexpected structure: ${Object.keys(cubeFromStore || {}).join(', ')}`);
      }
      
      // Use the original recipient identity for decryption since it has the proper encryption keys
      const retrieved: Veritum = await net.recipient.getVeritum(key);
      
      // expect Veritum received
      expect(retrieved).toBeDefined();
      
      // Check field types for debugging
      const availableFieldTypes = retrieved.getFields().map(f => f.type);
      logger.debug(`Available field types: ${availableFieldTypes.join(', ')}`);
      
      // expect Veritum decrypted (no ENCRYPTED field should remain)
      const encryptedField = retrieved.getFirstField(FieldType.ENCRYPTED);
      if (encryptedField) {
        logger.error(`ENCRYPTED field still present with length: ${encryptedField.value?.length}`);
      }
      expect(encryptedField).not.toBeDefined();

      // expect PAYLOAD field to be present after decryption
      const payloadField = retrieved.getFirstField(FieldType.PAYLOAD);
      if (!payloadField) {
        logger.error('PAYLOAD field missing after decryption');
        logger.error(`Retrieved veritum fields: ${availableFieldTypes.join(', ')}`);
      }
      expect(payloadField).toBeDefined();

      // expect plaintext to be restored correctly
      expect(payloadField.valueString).toBe(plaintext);
    });
  });  // Publishing an encrypted Veritum for a single recipient
});
