import { CoreCube } from "../../../src/core/cube/coreCube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/coreCube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { asCubeKey, keyVariants } from "../../../src/core/cube/keyUtil";
import { CubeSubscription } from "../../../src/core/networking/cubeRetrieval/pendingRequest";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

import sodium from 'libsodium-wrappers-sumo';
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// TODO: use the CubeRetriever rather than talking directly to the scheduler
//   (no application is expected to ever do that)

describe('Cube subscription e2e tests', () => {
  // Note! This is a test scenario.
  // Tests depend on each other.
  // Many tests cannot be run in isolation, and you cannot skip some test.
  describe('test group 1', () => {
    let net: LineShapedNetwork;
    const originalContent = 'cubus usoris mutabilis sum';
    const firstContentUpdate = 'ab domino meo renovatus sum';
    const secondContentUpdate = 'iterum atque iterum renovari possum';
    const missedUpdateContent = 'dominus meus taedere debet quod tam saepe me renovat';
    const concurrentUpdateSender = 'duos dominos habeo';
    const concurrentUpdateRecipient = 'de potestate mea pugnant';
    const updateAfterSubscriptionEnded = 'nemo hunc nuntium videbit';
    let originalMuc: CoreCube;
    let key: CubeKey;
    let privateKey: Buffer;
    let received: CoreCube[];

    beforeAll(async () => {
      // initialise vars
      received = [];

      // prepare crypto
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      key = asCubeKey(Buffer.from(keyPair.publicKey));
      privateKey = Buffer.from(keyPair.privateKey);

      // prepare a test network
      net = await LineShapedNetwork.Create(61401, 61402, {
        cubeSubscriptionPeriod: 1000,
      });

      // recipient subscribes to the MUC
      const subGen: AsyncGenerator<CoreCube> =
        net.recipient.cubeRetriever.subscribeCube(key);
      // push the received cubes into an array for easier testing
      (async () => { for await (const cube of subGen) received.push(cube)})();

      // sculpt the original MUC at the sender
      originalMuc = CoreCube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key, requiredDifficulty,
        fields: [
          CubeField.RawContent(CubeType.MUC, originalContent),
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

    afterAll(async () => {
      await net.shutdown();
    });

    it('can explicitly fetch the initial MUC after subscribing', async () => {
      // With the new behavior, subscribeCube doesn't automatically fetch initial cubes
      // We need to explicitly request it if we want the current version
      await net.recipient.cubeRetriever.getCubeInfo(key);
      expect (await waitForMucContent(
        net.recipient.cubeStore, key, originalContent)).
        toBe(true);
    });

    it('will yield the explicitly fetched MUC through the generator', async () => {
      expect(containsCube(received, key, originalContent)).toBe(true);
    });

    it('will receive MUC updates while subscribed', async () => {
      // sender updates the MUC
      const updatedMuc = CoreCube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, firstContentUpdate),
          CubeField.Date(1000002),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(updatedMuc);

      expect(await waitForMucContent(
        net.recipient.cubeStore, key, firstContentUpdate)).
        toBe(true);
    });

    it('will yield MUC updates through the generator', async () => {
      // high level test (testing CubeRetriever's Generator)
      expect(containsCube(received, key, firstContentUpdate)).toBe(true);
    });


    // Note: This test may not be run in isolation!
    // It must run after at least one of the previous tests awaiting the arrival
    // of a subscribed Cube.
    it('will auto-renew the subscription after it expires', async() => {
      // fetch the original subscription
      const sub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      // wait for the subscription to expire
      await sub.promise;  // denotes expiry

      // expect old subscription to have actually expired
      expect(sub.settled).toBe(true);

      // expect to have a fresh subscription
      const renewedSub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      expect(renewedSub).toBeInstanceOf(CubeSubscription);
      expect(renewedSub).not.toBe(sub);
    });


    it('will keep receiving updates through the renewed subscription', async() => {
      // Let's update the MUC at the sender.
      // sender updates the MUC
      const updatedMuc = CoreCube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, secondContentUpdate),
          CubeField.Date(1000003),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(updatedMuc);

      expect (await waitForMucContent(
        net.recipient.cubeStore, key, secondContentUpdate)).
        toBe(true);
    });

    it('will keep yielding updates through the renewed subscription', async() => {
      // high level test (testing CubeRetriever's Generator)
      expect(containsCube(received, key, secondContentUpdate)).toBe(true);
    });


    // TODO: We currently expect there to be a possibility of missed updates
    // during a subscription renewal. One we fixed that, implement this test.
    it.todo('will not miss any updates happening during the renewal');


    it('will not automatically catch up on missed updates on renewal (subscription is only for future updates)', async() => {
      // Some preliminary sanity-checks first:
      // Assert that the serving node still considers us connected & subscribed
      expect(net.fullNode2.networkManager.incomingPeers.length).toBe(1);
      const fn2ToRecpt: NetworkPeer =
        net.fullNode2.networkManager.incomingPeers[0] as NetworkPeer;
      expect(fn2ToRecpt.cubeSubscriptions).toContain(keyVariants(key).keyString);

      // To simulate a missed update, let's silently cancel the current
      // subscription on the serving node.
      fn2ToRecpt.cancelCubeSubscription(key);
      // Verify the subscription is indeed cancelled
      expect(fn2ToRecpt.cubeSubscriptions).not.toContain(keyVariants(key).keyString);

      // Have the sender update the MUC once again
      const updatedMuc = CoreCube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, missedUpdateContent),
          CubeField.Date(1000004),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(updatedMuc);

      // Allow some "propagation time" during which the update should *not*
      // be delivered to the recipient as we cancelled the subscription
      await new Promise(resolve => setTimeout(resolve, 200));

      // Assert the update was indeed missed due to us sabotaging the subscription
      const lastVersionAtRecipient = await net.recipient.cubeStore.getCube(key);
      expect(lastVersionAtRecipient.getFirstField(CubeFieldType.MUC_RAWCONTENT).
        valueString).toContain(secondContentUpdate);
      expect(lastVersionAtRecipient.getFirstField(CubeFieldType.MUC_RAWCONTENT).
        valueString).not.toContain(missedUpdateContent);

      // Wait for subscription expiry
      const sub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      await sub.promise;  // denotes expiry

      // Assert subscription has been auto-renewed
      const renewedSub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      expect(renewedSub).toBeInstanceOf(CubeSubscription);
      expect(renewedSub).not.toBe(sub);

      // Assert the missed update was NOT automatically caught up on renewal
      // (subscribeCube is now subscription-only - if you want current data, call requestCube explicitly)
      const stillNotReceived = await net.recipient.cubeStore.getCube(key);
      expect(stillNotReceived.getFirstField(CubeFieldType.MUC_RAWCONTENT).
        valueString).not.toContain(missedUpdateContent);
    });

    it('will not yield missed updates automatically (must be explicitly requested)', () => {
      // The subscription should not have automatically delivered the missed update
      expect(containsCube(received, key, missedUpdateContent)).toBe(false);

      // To get the missed update, you need to explicitly request it
      // This demonstrates the new behavior where subscription and requests are separate
    });

    it('can explicitly request missed updates after subscription renewal', async () => {
      await net.recipient.networkManager.scheduler.requestCube(key);
      const nowReceived = await net.recipient.cubeStore.getCube(key);
      expect(nowReceived.getFirstField(CubeFieldType.MUC_RAWCONTENT).valueString).
        toContain(missedUpdateContent);
    });


    it('can sync the same MUC both ways', async() => {
      // Plot twist! Recipient actually co-owns the MUC;
      // sender thus also subscribes to the MUC.
      const senderSub: CubeSubscription =
        await net.sender.networkManager.scheduler.subscribeCube(key);

      // Sender updates the MUC once again
      const senderUpdate = CoreCube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, concurrentUpdateSender),
          CubeField.Date(1000005),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.sender.cubeStore.addCube(senderUpdate);

      // Recipient now also pushes an update,
      // before having received the sender's latest version.
      const recipientUpdate = CoreCube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, concurrentUpdateRecipient),
          CubeField.Date(1000006),  // acts as version counter
        ],
        requiredDifficulty,
      });
      await net.recipient.cubeStore.addCube(recipientUpdate);

      // After some propagation time, sender should have adopted the recipient's
      // version as it is newer.
      expect(await waitForMucContent(
        net.sender.cubeStore, key, concurrentUpdateRecipient)).
          toBe(true);

      // Allow for some more propagation time
      await new Promise(resolve => setTimeout(resolve, 200));

      // Recipient on the other hand should have ignored the sender's update
      // as it is older.
      expect((await net.recipient.cubeStore.getCube(key)).getFirstField(
        CubeFieldType.MUC_RAWCONTENT).valueString).
          toContain(concurrentUpdateRecipient);
    });

    it('will yield concurrent updates on the recipient side through the Generator', () => {
      // Note that this asserts that CubeRetriever's generator also yields
      // local updates, which have not actually been retrieved through the
      // subscription. This is the current behavious and is probably sensible.
      expect(containsCube(received, key, concurrentUpdateRecipient)).toBe(true);
    });

    it('will stop receiving updates after a subscription is cancelled and expired', async () => {
      // Fetch the recipient's current MUC version
      const muc: CoreCube = await net.recipient.cubeStore.getCube(key);
      // Fetch current subscription
      const sub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      // Cancel the subscription
      net.recipient.networkManager.scheduler.cancelCubeSubscription(key);
      // Wait for subscription expiry
      await sub.promise;  // denotes expiry

      // Sender updates the MUC once again
      const updatedMuc = CoreCube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, updateAfterSubscriptionEnded),
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

    it('will not yield updates through the Generator after a subscription is cancelled and expired', () => {
      expect(containsCube(received, key, updateAfterSubscriptionEnded)).toBe(false);
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

function containsCube(list: CoreCube[], key: CubeKey, expectedContent: string): boolean {
  for (const cube of list) {
    if (cube.publicKey.equals(key)) {
      const field = cube.getFirstField(CubeFieldType.MUC_RAWCONTENT);
      if (field.valueString.includes(expectedContent)) return true;
    }
  }
  return false;
}
