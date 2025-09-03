import { Cube } from "../../../src/core/cube/cube";
import { CubeKey, CubeType, NotificationKey } from "../../../src/core/cube/cube.definitions";
import { asNotificationKey, keyVariants } from "../../../src/core/cube/keyUtil";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { calculateHash } from "../../../src/core/cube/cubeUtil";
import { MessageClass, NetConstants } from "../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { CubeResponseMessage, NetworkMessage, SubscribeCubeMessage, SubscribeNotificationsMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode, KeyResponseMessage, KeyRequestMode, KeyRequestMessage } from "../../../src/core/networking/networkMessage";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportConnection } from "../../../src/core/networking/testingDummies/dummyTransportConnection";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/dummyNetworkManager";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { ArrayFromAsync } from "../../../src/core/helpers/misc";

function randomNotificationKey(): NotificationKey {
  return asNotificationKey(
    Buffer.from(Array.from(
      {length: NetConstants.NOTIFY_SIZE},
      () => Math.floor(Math.random() * 256),
    )));
}

describe('NetworkPeer notification request tests', () => {
  let peer: NetworkPeer;
  let networkManager: NetworkManagerIf;
  let cubeStore: CubeStore;
  let peerDB: PeerDB;
  let conn: DummyTransportConnection;

  beforeAll(async () => {
    await sodium.ready;
  });

  describe('direct / CubeRequest mode', () => {
    it.todo('write tests if we decide to keep this feature');
  });

  describe('indirect / KeyRequest mode', () => {
    beforeAll(async() => {
      // prepare node
      cubeStore = new CubeStore(testCoreOptions);
      await cubeStore.readyPromise;
      peerDB = new PeerDB();
      networkManager = new DummyNetworkManager(cubeStore, peerDB);
      peer = new NetworkPeer(
        networkManager, new DummyTransportConnection(), cubeStore,
      );
      conn = peer.conn as DummyTransportConnection;
    });

    afterAll(async() => {
      await peer.close();
      await networkManager.shutdown();
      await peerDB.shutdown();
      await cubeStore.shutdown();
    });

    it('should respond with an empty KeyResponse if no notification cubes are available', async () => {
      // take note of current message count,
      // so we can later assert that exactly one new message was sent
      const msgCountBefore = conn.sentMessages.length;

      const unavailableNotificationKey = randomNotificationKey();

      // prepare message
      const req = new KeyRequestMessage(KeyRequestMode.NotificationChallenge,
        { notifies: unavailableNotificationKey });

      // perform test
      await (peer as any).handleKeyRequest(req);

      // expect a KeyResponse with zero cubes to have been "sent" through our dummy connection:
      expect(conn.sentMessages).toHaveLength(msgCountBefore + 1);

      const binaryMessage = conn.sentMessages[conn.sentMessages.length-1]
        .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
      const msg: KeyResponseMessage = NetworkMessage.fromBinary(binaryMessage);
      expect(msg.type).toBe(MessageClass.KeyResponse);
      expect(msg.mode).toBe(KeyRequestMode.NotificationChallenge);
      expect(msg.keyCount).toBe(0);
    });

    it('should return a key response quoting a single key if there is a single notification cube available', async () => {
      // add a notification cube to the store
      const notificationKey = randomNotificationKey();
      const notification = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.Notify(notificationKey),
          CubeField.RawContent(CubeType.PIC_NOTIFY, "Notificatio unica"),
        ],
        requiredDifficulty,
      });
      await cubeStore.addCube(notification);

      // take note of current message count,
      // so we can later assert that exactly one new message was sent
      const msgCountBefore = conn.sentMessages.length;

      // prepare message
      const req = new KeyRequestMessage(KeyRequestMode.NotificationChallenge,
        { notifies: notificationKey });

      // perform test
      await (peer as any).handleKeyRequest(req);

      // expect a KeyResponse with one cube to have been "sent" through our dummy connection:
      expect(conn.sentMessages).toHaveLength(msgCountBefore + 1);

      const binaryMessage = conn.sentMessages[conn.sentMessages.length-1]
        .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
      const msg: KeyResponseMessage = NetworkMessage.fromBinary(binaryMessage);
      expect(msg.type).toBe(MessageClass.KeyResponse);
      expect(msg.mode).toBe(KeyRequestMode.NotificationChallenge);
      expect(msg.keyCount).toBe(1);

      // retrieve cube info from message
      const cubeInfos = Array.from(msg.cubeInfos());
      expect(cubeInfos).toHaveLength(1);
      expect(cubeInfos[0].key).toEqual(await notification.getKey());
    });

    it('should return a key response quoting multiple keys if there are multiple notification cubes available', async () => {
      // add three notification cubes to the store
      const notificationKey = randomNotificationKey();
      const notification = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.Notify(notificationKey),
          CubeField.RawContent(CubeType.PIC_NOTIFY, "Notificatio prima"),
        ],
        requiredDifficulty,
      });
      await cubeStore.addCube(notification);

      const notification2 = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.Notify(notificationKey),
          CubeField.RawContent(CubeType.PIC_NOTIFY, "Notificatio secunda"),
        ],
        requiredDifficulty,
      });
      await cubeStore.addCube(notification2);

      const notification3 = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.Notify(notificationKey),
          CubeField.RawContent(CubeType.PIC_NOTIFY, "Notificatio tertia"),
        ],
        requiredDifficulty,
      });
      await cubeStore.addCube(notification3);

      // verify test setup:
      // - we have three notifications to this key in store
      const notifications: Cube[] = await ArrayFromAsync(
        cubeStore.getNotifications(notificationKey));
      expect(notifications).toHaveLength(3);

      // take note of current message count,
      // so we can later assert that exactly one new message was sent
      const msgCountBefore = conn.sentMessages.length;

      // prepare message
      const req = new KeyRequestMessage(KeyRequestMode.NotificationChallenge, {
        notifies: notificationKey,
      });

      // verify message:
      // - after compiling and decompiling, it still refers to the same notification key
      const compiled = req.value;
      const decompiled = new KeyRequestMessage(compiled);
      expect(decompiled.notifies).toEqual(notificationKey);

      // perform test
      await (peer as any).handleKeyRequest(req);

      // expect a KeyResponse with two cubes to have been "sent" through our dummy connection:
      expect(conn.sentMessages).toHaveLength(msgCountBefore + 1);

      const binaryMessage = conn.sentMessages[conn.sentMessages.length-1]
        .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
      const msg: KeyResponseMessage = NetworkMessage.fromBinary(binaryMessage);
      expect(msg.type).toBe(MessageClass.KeyResponse);
      expect(msg.mode).toBe(KeyRequestMode.NotificationChallenge);
      expect(msg.keyCount).toBe(3);

      // retrieve cube infos from message
      const cubeInfos = Array.from(msg.cubeInfos());
      expect(cubeInfos).toHaveLength(3);
      const expectedKeys = await Promise.all([
        notification.getKeyString(),
        notification2.getKeyString(),
        notification3.getKeyString(),
      ]);
      const receivedKeys = cubeInfos.map(ci => ci.keyString);
      expect(receivedKeys.sort()).toEqual(expectedKeys.sort());
    });

    describe('edge cases', () => {
      describe('notifications to zero key', () => {
        beforeAll(async () => {
          // add a notification cube to the all-zero notification key
          const zeroKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 0x00) as NotificationKey;
          const zeroNotification = Cube.Create({
            cubeType: CubeType.PIC_NOTIFY,
            fields: [
              CubeField.Notify(zeroKey),
              CubeField.RawContent(CubeType.PIC_NOTIFY, "Notificatio nulla"),
            ],
            requiredDifficulty,
          });
          await cubeStore.addCube(zeroNotification);
        });

        it('will still return an empty KeyResponse if there are notifications to the zero key present, but not to the requested one', async () => {
          // take note of current message count,
          // so we can later assert that exactly one new message was sent
          const msgCountBefore = conn.sentMessages.length;

          // prepare message
          const unavailableNotificationKey = randomNotificationKey();
          const req = new KeyRequestMessage(KeyRequestMode.NotificationChallenge, {
            notifies: unavailableNotificationKey,
          });

          // perform test
          await (peer as any).handleKeyRequest(req);

          // expect a KeyResponse with one cube to have been "sent" through our dummy connection:
          expect(conn.sentMessages).toHaveLength(msgCountBefore + 1);

          const binaryMessage = conn.sentMessages[conn.sentMessages.length-1]
            .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
          const msg: KeyResponseMessage = NetworkMessage.fromBinary(binaryMessage);
          expect(msg.type).toBe(MessageClass.KeyResponse);
          expect(msg.mode).toBe(KeyRequestMode.NotificationChallenge);
          expect(msg.keyCount).toBe(0);
        });

        it('will still return a single-key KeyResponse if there are notifications to the zero key present in addition to the requested one', async () => {
          // take note of current message count,
          // so we can later assert that exactly one new message was sent
          const msgCountBefore = conn.sentMessages.length;

          // prepare message
          const notificationKey = randomNotificationKey();
          const req = new KeyRequestMessage(KeyRequestMode.NotificationChallenge, {
            notifies: notificationKey,
          });

          // perform test
          await (peer as any).handleKeyRequest(req);

          // expect a KeyResponse with one cube to have been "sent" through our dummy connection:
          expect(conn.sentMessages).toHaveLength(msgCountBefore + 1);

          const binaryMessage = conn.sentMessages[conn.sentMessages.length-1]
            .subarray(NetConstants.PROTOCOL_VERSION_SIZE);
          const msg: KeyResponseMessage = NetworkMessage.fromBinary(binaryMessage);
          expect(msg.type).toBe(MessageClass.KeyResponse);
          expect(msg.mode).toBe(KeyRequestMode.NotificationChallenge);
          expect(msg.keyCount).toBe(1);

          // retrieve cube info from message
          const cubeInfos = Array.from(msg.cubeInfos());
          expect(cubeInfos).toHaveLength(1);
          expect(cubeInfos[0].key).toEqual(notificationKey);
        });
      });
    });
  });

  describe.todo('timing out subscriptions');
});
