import { CoreCube } from "../../../src/core/cube/coreCube";
import { CubeKey, NotificationKey } from "../../../src/core/cube/coreCube.definitions";
import { keyVariants } from "../../../src/core/cube/keyUtil";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { calculateHash } from "../../../src/core/cube/cubeUtil";
import { MessageClass, NetConstants } from "../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { CubeResponseMessage, NetworkMessage, SubscribeCubeMessage, SubscribeNotificationsMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode, KeyResponseMessage, KeyRequestMode } from "../../../src/core/networking/networkMessage";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportConnection } from "../../../src/core/networking/testingDummies/dummyTransportConnection";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/dummyNetworkManager";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const TEST_SUBSCRIPTION_PERIOD = 1000;  // TODO BUGBUG this does not seem to work for shorter periods e.g. 500, why?!?!?!

describe('NetworkPeer SubscribeNotification tests', () => {
  let peer: NetworkPeer;
  let networkManager: NetworkManagerIf;
  let cubeStore: CubeStore;
  let peerDB: PeerDB;
  let conn: DummyTransportConnection;

  const notificationKey1 = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x47) as NotificationKey;
  const notificationKey2 = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x11) as NotificationKey;
  const zeroKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x00) as NotificationKey;

  beforeAll(async () => {
    await sodium.ready;
  });

  describe('establishing subscriptions / handleSubscribeNotifications() private method', () => {
    describe('single key subscription requests', () => {
      describe('accepted requests', () => {
        beforeAll(async() => {
          // prepare node
          cubeStore = new CubeStore(testCoreOptions);
          await cubeStore.readyPromise;
          peerDB = new PeerDB();
          networkManager = new DummyNetworkManager(cubeStore, peerDB);
          peer = new NetworkPeer(
            networkManager, new DummyTransportConnection(), cubeStore, {
              cubeSubscriptionPeriod: TEST_SUBSCRIPTION_PERIOD,
            }
          );
          conn = peer.conn as DummyTransportConnection;

          // subscribe a single notification key
          const req = new SubscribeNotificationsMessage([notificationKey1]);
          await (peer as any).handleSubscribeNotifications(req);
        });

        afterAll(async() => {
          await peer.close();
          await networkManager.shutdown();
          await peerDB.shutdown();
          await cubeStore.shutdown();
        });

        it('should confirm the subscription', () => {
          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.SubscriptionConfirmed);
          expect(response.requestedKeyBlob).toEqual(notificationKey1);
          expect(response.cubesHashBlob).toEqual(zeroKey);  // TODO: or actual hash of existing, i.e. hash of zero length string
          expect(response.subscriptionDuration).toBe(TEST_SUBSCRIPTION_PERIOD);
        });

        it('should register the subscription if the key is available', () => {
          expect(peer.notificationSubscriptions).toHaveLength(1);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey1).keyString);
        });

        it('should remove the subscription once it has expired', async () => {
          // wait for expiry
          await new Promise(resolve => setTimeout(resolve, TEST_SUBSCRIPTION_PERIOD + 10));

          // subscription should be removed
          expect(peer.notificationSubscriptions).toHaveLength(0);
        });
      });  // accepted requests

      describe('edge cases', () => {
        it.todo('renew the subscription period if requested key is already subscribed');
      });
    });

    describe('multiple key subscription requests', () => {
      describe('accepted requests', () => {
        beforeAll(async() => {
          // prepare node
          cubeStore = new CubeStore(testCoreOptions);
          await cubeStore.readyPromise;
          peerDB = new PeerDB();
          networkManager = new DummyNetworkManager(cubeStore, peerDB);
          peer = new NetworkPeer(
            networkManager, new DummyTransportConnection(), cubeStore, {
              cubeSubscriptionPeriod: TEST_SUBSCRIPTION_PERIOD,
          });
          conn = peer.conn as DummyTransportConnection;

          // subscribe two notification keys
          const req = new SubscribeNotificationsMessage([notificationKey1, notificationKey2]);
          await (peer as any).handleSubscribeNotifications(req);
        });

        afterAll(async() => {
          await peer.close();
          await networkManager.shutdown();
          await peerDB.shutdown();
          await cubeStore.shutdown();
        });

        it('should confirm the subscription', async () => {
          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.SubscriptionConfirmed);

          const expectedKeyBlob: Buffer = calculateHash(
            Buffer.concat([notificationKey1, notificationKey2]));
          expect(response.requestedKeyBlob).toEqual(expectedKeyBlob);

          expect(response.cubesHashBlob).toEqual(zeroKey);  // TODO: or actual hash of existing, i.e. hash of zero length string
          expect(response.subscriptionDuration).toBe(TEST_SUBSCRIPTION_PERIOD);
        });

        it('should register the subscription', async () => {
          expect(peer.notificationSubscriptions).toHaveLength(2);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey1).keyString);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey2).keyString);
        });

        it('should not remove the subscription while it is active', async () => {
          // wait a little, but not quite till expiry
          await new Promise(resolve => setTimeout(resolve, TEST_SUBSCRIPTION_PERIOD - 100));
          // subscription should still be there
          expect(peer.notificationSubscriptions).toHaveLength(2);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey1).keyString);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey2).keyString);
        });

        it('should remove the subscription once it has expired', async () => {
          // wait for expiry
          await new Promise(resolve => setTimeout(resolve, TEST_SUBSCRIPTION_PERIOD + 10));

          // subscription should be removed
          expect(peer.notificationSubscriptions).toHaveLength(0);
        });
      });

      describe('edge cases', () => {
        it.todo('should handle duplicate keys gracefully');
        it.todo('renew the subscription period if one of the requested key is already subscribed');
      });
    });
  });  // handleSubscribeCube() private method

  describe('serving subscribers', () => {
    beforeAll(async() => {
      // prepare node
      cubeStore = new CubeStore(testCoreOptions);
      await cubeStore.readyPromise;
      peerDB = new PeerDB();
      networkManager = new DummyNetworkManager(cubeStore, peerDB);
      peer = new NetworkPeer(
        networkManager, new DummyTransportConnection(), cubeStore);
      conn = peer.conn as DummyTransportConnection;

      // subscribe a single notification key
      const req = new SubscribeNotificationsMessage([notificationKey1]);
      await (peer as any).handleSubscribeNotifications(req);
    });

    afterAll(async() => {
      await peer.close();
      await networkManager.shutdown();
      await peerDB.shutdown();
      await cubeStore.shutdown();
    });

    describe('sendSubscribedCubeUpdate() private method', () => {
      it('should send a KeyResponse with ExpressSync mode when a subscribed notification is added', async () => {
        // add a notification cube
        const notification = CoreCube.Create({
          fields: CubeField.Notify(notificationKey1),
          requiredDifficulty,
        });
        await cubeStore.addCube(notification);

        // expect a KeyResponse with ExpressSync mode to have been "sent" through our dummy connection:
        // fetch latest message
        const binaryMessage: Buffer =
          conn.sentMessages[conn.sentMessages.length-1]
          .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
        // decompile message
        const msg: KeyResponseMessage = NetworkMessage.fromBinary(binaryMessage) as KeyResponseMessage;
        expect(msg.type).toBe(MessageClass.KeyResponse);
        expect(msg.mode).toBe(KeyRequestMode.ExpressSync);
        expect(msg.keyCount).toBe(1);
        // retrieve cube info from message
        const cubeInfos = Array.from(msg.cubeInfos());
        expect(cubeInfos).toHaveLength(1);
        expect(cubeInfos[0].key).toEqual(await notification.getKey());
      });
    });
  });

  describe.todo('timing out subscriptions');
});
