import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { keyVariants } from "../../../src/core/cube/cubeUtil";
import { CubeSubscription } from "../../../src/core/networking/cubeRetrieval/pendingRequest";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { NetworkPeerIf } from "../../../src/core/networking/networkPeerIf";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

import sodium from 'libsodium-wrappers-sumo';
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// TODO: use the CubeRetriever rather than talking directly to the scheduler
//   (no application is expected to ever do that)

describe('Cube subscription e2e tests', () => {
  describe('test group 1', () => {
    let net: LineShapedNetwork;
    let originalMuc: Cube;
    let key: CubeKey;
    let privateKey: Buffer;
    let initialSubPromise: Promise<CubeSubscription>;

    beforeAll(async () => {
      // prepare crypto
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      key = Buffer.from(keyPair.publicKey);
      privateKey = Buffer.from(keyPair.privateKey);

      // prepare a test network
      net = await LineShapedNetwork.Create(61301, 61302, {
        cubeSubscriptionPeriod: 1000,
      });

      // recipient subscribes to the MUC
      initialSubPromise =
        net.recipient.networkManager.scheduler.subscribeCube(key);

      // sculpt the original MUC at the sender
      originalMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key, requiredDifficulty,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'cubus usoris mutabilis sum'),
          CubeField.Date(1000001),  // acts as version counter
        ],
      });
      await net.sender.cubeStore.addCube(originalMuc);

      // sanity-check test setup:
      // sender should have a single Cube stored, all other nodes should have
      // none yet
      expect(await net.sender.cubeStore.getNumberOfStoredCubes()).toBe(1);
      expect(await net.fullNode1.cubeStore.getNumberOfStoredCubes()).toBe(0);
      expect(await net.fullNode2.cubeStore.getNumberOfStoredCubes()).toBe(0);
      expect(await net.recipient.cubeStore.getNumberOfStoredCubes()).toBe(0);
    });


    it('will receive the initial MUC when subscribing', async () => {
      expect (await waitForMucContent(
        net.recipient.cubeStore, key, 'cubus usoris mutabilis sum')).
        toBe(true);
    });


    it('will receive MUC updates while subscribed', async () => {
      // sender updates the MUC
      const updatedMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'ab domino meo renovatus sum'),
          CubeField.Date(1000002),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(updatedMuc);

      expect (await waitForMucContent(
        net.recipient.cubeStore, key, 'ab domino meo renovatus sum')).
        toBe(true);
    });


    it('will auto-renew the subscription after it expires', async() => {
      // wait for the subscription to expire
      const sub: CubeSubscription = await initialSubPromise;
      await sub.promise;  // denotes expiry

      // expect subscription to have actually expired
      expect(sub.settled).toBe(true);
      // note: once we implement renewal-before-expiry, amend the next line
      const expired =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      expect(expired).toBeUndefined();

      // give it some time for the subscription to renew
      await new Promise(resolve => setTimeout(resolve, 100));
      const renewedSub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);

      // expect to have a fresh subscription
      expect(renewedSub).toBeInstanceOf(CubeSubscription);
      expect(renewedSub).not.toBe(sub);
    });


    it('will keep receiving updates through the renewed subscription', async() => {
      // Let's update the MUC at the sender.
      // sender updates the MUC
      const updatedMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'iterum atque iterum renovari possum'),
          CubeField.Date(1000003),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(updatedMuc);

      expect (await waitForMucContent(
        net.recipient.cubeStore, key, 'iterum atque iterum renovari possum')).
        toBe(true);
    });


    // TODO: We currently expect there to be a possibility of missed updates
    // during a subscription renewal. One we fixed that, implement this test.
    it.todo('will not miss any updates happening during the renewal');


    it('will catch up on any missed updates on renewal', async() => {
      // To simulate a missed update, let's silently cancel the current
      // subscription on the serving node.
      // Some sanity-check assertions first though.
      expect(net.fullNode2.networkManager.incomingPeers.length).toBe(1);
      const fn2ToRecpt: NetworkPeer =
        net.fullNode2.networkManager.incomingPeers[0] as NetworkPeer;
      expect(fn2ToRecpt.cubeSubscriptions).toContain(keyVariants(key).keyString);
      // Now cancel the subscription
      fn2ToRecpt.cancelCubeSubscription(key);
      // Verify the subscription is indeed cancelled
      expect(fn2ToRecpt.cubeSubscriptions).not.toContain(keyVariants(key).keyString);

      // Have the sender update the MUC once again
      const updatedMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC,
            'dominus meus taedere debet quod tam saepe me renovat'),
          CubeField.Date(1000004),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(updatedMuc);

      // Allow some "propagation time" during which the update should *not*
      // be delivered to the recipient as we cancelled the subscription
      await new Promise(resolve => setTimeout(resolve, 200));

      // Wait for subscription expiry
      const sub: CubeSubscription = await initialSubPromise;
      await sub.promise;  // denotes expiry

      // Assert the update was indeed missed due to us sabotaging the subscription
      const lastVersionAtRecipient = await net.recipient.cubeStore.getCube(key);
      expect(lastVersionAtRecipient.getFirstField(CubeFieldType.MUC_RAWCONTENT).
        valueString).
          toContain('iterum atque iterum renovari possum');
      expect(lastVersionAtRecipient.getFirstField(CubeFieldType.MUC_RAWCONTENT).
        valueString).
          not.toContain('dominus meus taedere debet quod tam saepe me renovat');

      // Wait for the subscription to auto-renew
      // give it some time for the subscription to renew
      await new Promise(resolve => setTimeout(resolve, 1000));
      const renewedSub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      // expect to have a fresh subscription
      expect(renewedSub).toBeInstanceOf(CubeSubscription);
      expect(renewedSub).not.toBe(sub);

      // Assert the missed update was catched up on renewal
      const nowReceived = await net.recipient.cubeStore.getCube(key);
      expect(nowReceived.getFirstField(CubeFieldType.MUC_RAWCONTENT).valueString).
        toContain('dominus meus taedere debet quod tam saepe me renovat');
    });


    it('can sync the same MUC both ways', async() => {
      // Plot twist! Recipient actually co-owns the MUC;
      // sender thus also subscribes to the MUC.
      const senderSub: CubeSubscription =
        await net.sender.networkManager.scheduler.subscribeCube(key);

      // Sender updates the MUC once again
      const senderUpdate = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'duos dominos habeo'),
          CubeField.Date(1000005),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(senderUpdate);

      // Recipient now also pushes an update,
      // before having received the sender's latest version.
      const recipientUpdate = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'de potestate mea pugnant'),
          CubeField.Date(1000006),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.recipient.cubeStore.addCube(recipientUpdate);

      // After some propagation time, sender should have adopted the recipient's
      // version as it is newer.
      expect(await waitForMucContent(
        net.sender.cubeStore, key, 'de potestate mea pugnant')).
          toBe(true);

      // Allow for some more propagation time
      await new Promise(resolve => setTimeout(resolve, 200));

      // Recipient on the other hand should have ignored the sender's update
      // as it is older.
      expect((await net.recipient.cubeStore.getCube(key)).getFirstField(
        CubeFieldType.MUC_RAWCONTENT).valueString).
          toContain('de potestate mea pugnant');
    });

    it('will stop receiving updates after a subscription is cancelled and expired', async () => {
      // Fetch the recipient's current MUC version
      const muc: Cube = await net.recipient.cubeStore.getCube(key);
      // Fetch current subscription
      const sub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      // Cancel the subscription
      net.recipient.networkManager.scheduler.cancelCubeSubscription(key);
      // Wait for subscription expiry
      await sub.promise;  // denotes expiry

      // Sender updates the MUC once again
      const updatedMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'nemo hunc nuntium videbit'),
          CubeField.Date(1000007),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(updatedMuc);

      // Allow some "propagation time" during which the update should *not*
      // be delivered to the recipient as we cancelled the subscription
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert the recipient still possesses the old version
      const recipientsLastVersion = await net.recipient.cubeStore.getCube(key);
      expect(await recipientsLastVersion.getHash()).toEqual(await muc.getHash());
    });

    afterAll(async () => {
      await net.shutdown();
    });

  });  // test group 1

});



async function waitForMucContent(cubeStore: CubeStore, key: CubeKey, expectedContent: string, timeout: number = 1000): Promise<boolean> {
  let timeWaited: number = 0;
  while (true) {
    const cube = await cubeStore.getCube(key);
    if (cube) {
      const field = cube.getFirstField(CubeFieldType.MUC_RAWCONTENT);
      if (field.valueString.includes(expectedContent)) return true;
    }
    if (timeWaited > timeout) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
    timeWaited += 50;
  }
}