import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { keyVariants } from "../../../src/core/cube/cubeUtil";
import { CubeSubscription } from "../../../src/core/networking/cubeRetrieval/pendingRequest";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { NetworkPeerIf } from "../../../src/core/networking/networkPeerIf";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

import sodium from 'libsodium-wrappers-sumo';
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// TODO: use the CubeRetriever rather than talking directly to the scheduler
//   (no application is expected to ever do that)

describe('Notification subscription e2e tests', () => {
  describe('test group 1', () => {
    const notificationKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42);
    let net: LineShapedNetwork;
    let initialSub: CubeSubscription;
    const receivedNotifications: Cube[] = [];

    beforeAll(async () => {
      await sodium.ready;
      // prepare a test network
      net = await LineShapedNetwork.Create(61311, 61312, {
        cubeSubscriptionPeriod: 1000,
      });

      // recipient subscribes to the notification key
      initialSub = await net.recipient.networkManager.scheduler.
        subscribeNotifications(notificationKey);
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
      let latin: string;
      let notification: Cube;
      let key: CubeKey;

      let rcvdAtFullNode1: Promise<CubeInfo>;
      let rcvdAtFullNode2: Promise<CubeInfo>;
      let rcvdAtRecipient: Promise<CubeInfo>;

      beforeAll(async () => {
        // sculpt new notification at sender
        latin = 'Quaeso meam existentia cognoscas';
        notification = Cube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            CubeField.RawContent(CubeType.PIC_NOTIFY, latin),
            CubeField.Notify(notificationKey),
          ],
          requiredDifficulty,
        });
        key = await notification.getKey();
        net.sender.cubeStore.addCube(notification);

        // expect recipient to receive the notification (later)
        rcvdAtFullNode1 = net.fullNode1.cubeStore.expectCube(key);
        rcvdAtFullNode2 = net.fullNode2.cubeStore.expectCube(key);
        rcvdAtRecipient = net.recipient.cubeStore.expectCube(key);
      });

      it('will receive the notification at full node 1', async () => {
        const receivedInfo: CubeInfo = await rcvdAtFullNode1;
        expect(receivedInfo.getCube().getFirstField(
          CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString).
          toContain(latin);
      });

      it('will receive the notification at full node 2', async () => {
        const receivedInfo: CubeInfo = await rcvdAtFullNode2;
        expect(receivedInfo.getCube().getFirstField(
          CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString).
          toContain(latin);
      });

      it('will receive the notification at the recipient', async () => {
        const receivedInfo: CubeInfo = await rcvdAtRecipient;
        expect(receivedInfo.getCube().getFirstField(
          CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString).
          toContain(latin);
      });
    });

    describe('subscription renewal', () => {
      it('will auto-renew the subscription after it expires', async() => {
        // wait for the subscription to expire
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
        const latin = 'Habeo res magnas dicere';
        const notification = Cube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            CubeField.RawContent(CubeType.PIC_NOTIFY, latin),
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
          toContain(latin);
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
        const notification = Cube.Create({
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
