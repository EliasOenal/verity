import { KeyPair } from "../../../src/cci/helpers/cryptography";
import { Cube } from "../../../src/core/cube/cube";
import { CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { calculateHash, keyVariants } from "../../../src/core/cube/cubeUtil";
import { unixtime } from "../../../src/core/helpers/misc";
import { MessageClass, NetConstants } from "../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { CubeResponseMessage, NetworkMessage, SubscribeCubeMessage, SubscribeNotificationsMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode } from "../../../src/core/networking/networkMessage";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportConnection } from "../../../src/core/networking/testingDummies/dummyTransportConnection";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/dummyNetworkManager";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { Settings } from "../../../src/core/settings";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('NetworkPeer SubscribeNotification tests', () => {
  let peer: NetworkPeer;
  let networkManager: NetworkManagerIf;
  let cubeStore: CubeStore;
  let peerDB: PeerDB;
  let conn: DummyTransportConnection;

  const notificationKey1: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x47);
  const notificationKey2: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x11);
  const zeroKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x00);

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

        it('should confirm the subscription', async () => {
          expect(conn.sentMessages).toHaveLength(1);
          const binaryResponse = conn.sentMessages[0].subarray(2);
          const response = new SubscriptionConfirmationMessage(binaryResponse);
          expect(response.responseCode).toBe(SubscriptionResponseCode.SubscriptionConfirmed);
          expect(response.requestedKeyBlob).toEqual(notificationKey1);
          expect(response.cubesHashBlob).toEqual(zeroKey);  // TODO: or actual hash of existing, i.e. hash of zero length string
          expect(response.subscriptionDuration).toBe(Settings.CUBE_SUBSCRIPTION_PERIOD);
        });

        it('should register the subscription if the key is available', async () => {
          expect(peer.notificationSubscriptions).toHaveLength(1);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey1).keyString);
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
            networkManager, new DummyTransportConnection(), cubeStore);
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
          expect(response.subscriptionDuration).toBe(Settings.CUBE_SUBSCRIPTION_PERIOD);
        });

        it('should register the subscription', async () => {
          expect(peer.notificationSubscriptions).toHaveLength(2);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey1).keyString);
          expect(peer.notificationSubscriptions).toContain(keyVariants(notificationKey2).keyString);
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
      it('should send a CubeUpdateMessage when a subscribed Cube is updated', async () => {
        // add a notification cube
        const notification = Cube.Create({
          fields: CubeField.Notify(notificationKey1),
          requiredDifficulty,
        });
        await cubeStore.addCube(notification);

        // expect a CubeResponseMessage to have been "sent" through our dummy connection:
        // fetch latest message
        const binaryMessage: Buffer =
          conn.sentMessages[conn.sentMessages.length-1]
          .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
        // decompile message
        const msg: CubeResponseMessage = NetworkMessage.fromBinary(binaryMessage) as CubeResponseMessage;
        expect(msg.type).toBe(MessageClass.CubeResponse);
        expect(msg.cubeCount).toBe(1);
        // retrieve binary Cube from message
        const binaryCube: Buffer = Array.from(msg.binaryCubes())[0];
        // should be the new notification Cube
        expect(binaryCube.equals(notification.getBinaryDataIfAvailable())).toBeTruthy();
      });
    });
  });

  describe.todo('timing out subscriptions');
});
