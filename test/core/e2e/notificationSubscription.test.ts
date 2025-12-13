import { CoreCube } from "../../../src/core/cube/coreCube";
import { CubeFieldType, CubeKey, CubeType, NotificationKey } from "../../../src/core/cube/coreCube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { keyVariants } from "../../../src/core/cube/keyUtil";
import { CubeSubscribeRetrieverOptions } from "../../../src/core/networking/cubeRetrieval/cubeRetriever";
import { CubeSubscription } from "../../../src/core/networking/cubeRetrieval/pendingRequest";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

import sodium from 'libsodium-wrappers-sumo';
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// TODO: use the CubeRetriever rather than talking directly to the scheduler
//   (no application is expected to ever do that)

describe('Notification subscription e2e tests', () => {
  describe('test group 1', () => {
    const notificationKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42) as NotificationKey;
    let net: LineShapedNetwork;
    const received: CoreCube[] = [];

    const content1 = 'Quaeso meam existentia cognoscas';
    const content2 = 'Habeo res magnas dicere';

    beforeAll(async () => {
      await sodium.ready;
      // prepare a test network
      net = await LineShapedNetwork.Create(61311, 61312, {
        cubeSubscriptionPeriod: 1000,
      });

      // recipient subscribes to the notification key
      const sup: CubeSubscribeRetrieverOptions = {};
      const gen = net.recipient.cubeRetriever.subscribeNotifications(notificationKey, sup);
      // push received notifications into an array for ease of testing
      (async() => {
        for await (const cube of gen) received.push(cube);
      })();

      // wait for the subscription to be set up
      await sup.outputSubPromise;
    });

    afterAll(async () => {
      await net.shutdown();
    });

    describe('verify subscription setup', () => {
      test('recipient has the subscription locally registered (client-side)', () => {
        const sub: CubeSubscription =
          net.recipient.networkManager.scheduler.notificationSubscriptionDetails(notificationKey);
        expect(sub).toBeInstanceOf(CubeSubscription);
        expect(sub.sup!.key.equals(notificationKey)).toBe(true);
      });

      test('full node 2 has the subscription locally registered (server-side)', () => {
        expect(net.fullNode2ToRecipient.notificationSubscriptions).toContain(keyVariants(notificationKey).keyString);
      });
    });

    describe('notification propagation', () => {
      let notification: CoreCube;
      let key: CubeKey;

      let rcvdAtFullNode1: Promise<CubeInfo>;
      let rcvdAtFullNode2: Promise<CubeInfo>;
      let rcvdAtRecipient: Promise<CubeInfo>;

      beforeAll(async () => {
        // sculpt new notification at sender
        notification = CoreCube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            CubeField.RawContent(CubeType.PIC_NOTIFY, content1),
            CubeField.Notify(notificationKey),
          ],
          requiredDifficulty,
        });
        key = await notification.getKey();

        // expect recipient to receive the notification (later)
        rcvdAtFullNode1 = net.fullNode1.cubeStore.expectCube(key);
        rcvdAtFullNode2 = net.fullNode2.cubeStore.expectCube(key);
        rcvdAtRecipient = net.recipient.cubeStore.expectCube(key);

        // sender publishes the notification
        await net.sender.cubeStore.addCube(notification);
      });

      it('will receive the notification at full node 1', async () => {
        const receivedInfo: CubeInfo = await rcvdAtFullNode1;
        expect(receivedInfo.getCube().getFirstField(
          CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString).
          toContain(content1);
      });

      it('will receive the notification at full node 2', async () => {
        const receivedInfo: CubeInfo = await rcvdAtFullNode2;
        expect(receivedInfo.getCube().getFirstField(
          CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString).
          toContain(content1);
      });

      it('will receive the notification at the recipient', async () => {
        const receivedInfo: CubeInfo = await rcvdAtRecipient;
        expect(receivedInfo.getCube().getFirstField(
          CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString).
          toContain(content1);
      });

      it("will yield the notification at the receiver through CubeRetriever's generator", () => {
        expect(containsCube(received, content1)).toBe(true);
      })
    });

    describe('subscription renewal', () => {
      it('will auto-renew the subscription after it expires', async() => {
        // wait for the subscription to expire
        const initialSub = net.recipient.networkManager.scheduler.notificationSubscriptionDetails(notificationKey);
        await initialSub.promise;  // denotes expiry

        // expect subscription to have actually expired
        expect(initialSub.settled).toBe(true);

        // give it some time for the subscription to renew
        await new Promise(resolve => setTimeout(resolve, 100));
        const renewedSub: CubeSubscription =
          net.recipient.networkManager.scheduler.notificationSubscriptionDetails(notificationKey);

        // expect to have a fresh subscription
        expect(renewedSub).toBeInstanceOf(CubeSubscription);
        expect(renewedSub).not.toBe(initialSub);
      });


      it('will keep receiving notifications through the renewed subscription', async() => {
        // sculpt new notification at sender
        const notification = CoreCube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            CubeField.RawContent(CubeType.PIC_NOTIFY, content2),
            CubeField.Notify(notificationKey),
          ],
          requiredDifficulty,
        });
        const key = await notification.getKey();
        net.sender.cubeStore.addCube(notification);

        // expect recipient to receive the notification
        const receivedInfo: CubeInfo = await net.recipient.cubeStore.expectCube(key);
        expect(receivedInfo.getCube().getFirstField(
          CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString).
          toContain(content2);
      });

      it("will keep yielding notifications through CubeRetriever's generator after renewal", () => {
        expect(containsCube(received, content2)).toBe(true);
      });


      // TODO: We currently expect there to be a possibility of missed updates
      // during a subscription renewal. One we fixed that, implement this test.
      it.todo('will not miss any notifications during the renewal');
    });


    describe('subscription cancellation', () => {
      it('will stop receiving updates after a subscription is cancelled and expired', async () => {
        // Fetch current subscription
        const sub: CubeSubscription =
          net.recipient.networkManager.scheduler.notificationSubscriptionDetails(notificationKey);
        // Cancel the subscription
        net.recipient.networkManager.scheduler.cancelNotificationSubscription(notificationKey);
        // Wait for subscription expiry
        await sub.promise;  // denotes expiry

        // Sender sculpts yet another notification
        const latin = 'Numquis me audit?';
        const notification = CoreCube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            CubeField.RawContent(CubeType.PIC_NOTIFY, latin),
            CubeField.Notify(notificationKey),
          ],
          requiredDifficulty,
        });
        const key = await notification.getKey();
        net.sender.cubeStore.addCube(notification);

        // Allow some "propagation time" during which the notification should *not*
        // be delivered to the recipient as we cancelled the subscription
        await new Promise(resolve => setTimeout(resolve, 500));

        // Assert the recipient has *not* received the new notification
        const hasReceived = await net.recipient.cubeStore.hasCube(key);
        expect(hasReceived).toBe(false);
      });
    });

  });  // test group 1
});

function containsCube(list: CoreCube[], expectedContent: string): boolean {
  for (const cube of list) {
    const field = cube.getFirstField(CubeFieldType.PIC_NOTIFY_RAWCONTENT);
    if (field.valueString.includes(expectedContent)) return true;
  }
  return false;
}
