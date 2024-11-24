import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { NetConstants, SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { AddressAbstraction } from "../../../src/core/peering/addressing";
import { VerityNode } from "../../../src/core/verityNode";

import { LineShapedNetwork } from "./e2eSetup";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import { Buffer } from 'buffer';

describe('notification end-to-end tests', () => {
  test('light nodes can request notifications from other light nodes', async() => {
    // set up two light nodes and wait for them to be connected
    const sender: VerityNode = new VerityNode({
      ...testCoreOptions,
      lightNode: true,
      transports: new Map([
        [SupportedTransports.ws, 61104],
      ]),
    });
    await sender.readyPromise;
    const recipient: VerityNode = new VerityNode({
      ...testCoreOptions,
      inMemory: true,
      lightNode: true,
      initialPeers: [new AddressAbstraction("ws://127.0.0.1:61104")],
    });
    await recipient.readyPromise;
    await sender.onlinePromise;
    await recipient.onlinePromise;

    // ensure both nodes are connected
    expect(sender.networkManager.onlinePeers.length).toBe(1);
    expect(recipient.networkManager.onlinePeers.length).toBe(1);

    // ensure sender is connected to recipient
    // ws lib on Node gives us this strange pseudo IPv6 mapped notation for clients
    expect(sender.networkManager.onlinePeers[0].address.ip).toEqual("::ffff:127.0.0.1");
    // recipient is the client and thus must be on a high port; the exact port number cannot be known
    expect(sender.networkManager.onlinePeers[0].address.port).toBeGreaterThan(32767);

    // ensure recipient is connected to sender
    expect(recipient.networkManager.onlinePeers[0].address.ip).toEqual("127.0.0.1");
    expect(recipient.networkManager.onlinePeers[0].address.port).toBe(61104);

    // sender sculpts a notification Cube for recipient
    const notificationKey: Buffer = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42);
    const contentField = CubeField.RawContent(CubeType.FROZEN_NOTIFY,
      "Haec notificatio directe tradetur. Nulla deviatio acceptabilis est!");
    const notification: Cube = Cube.Frozen({
      fields: [
        contentField,
        CubeField.Notify(notificationKey),
        ],
      requiredDifficulty,
    });
    await sender.cubeStore.addCube(notification);

    // recipient retrieves notification
    const retrieved: CubeInfo = await recipient.cubeRetriever.requestScheduler.
      requestNotifications(notificationKey);

    expect(retrieved).toBeInstanceOf(CubeInfo);
    expect(retrieved.key).toEqual(notification.getKeyIfAvailable());
    expect(retrieved.getCube().getFirstField(CubeFieldType.NOTIFY).value).
      toEqual(notificationKey);
    expect(retrieved.getCube().getFirstField(CubeFieldType.FROZEN_NOTIFY_RAWCONTENT).value).
      toEqual(contentField.value);

    // shutdown
    await Promise.all([
      sender.shutdown(),
      recipient.shutdown(),
    ]);
  });

  test('notifications posted by light nodes propagate through the full node network to be retrieved by another light node', async() => {
    const { sender, fullNode1, fullNode2, recipient } = await LineShapedNetwork.Create(61101, 61102);
    // sender sculpts a notification Cube for recipient
    const notificationKey: Buffer = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42);
    const contentField = CubeField.RawContent(CubeType.FROZEN_NOTIFY,
      "Haec notificatio ad collegam meam directa est");
    const notification: Cube = Cube.Frozen({
      fields: [
        contentField,
        CubeField.Notify(notificationKey),
        ],
      requiredDifficulty,
    });
    await sender.cubeStore.addCube(notification);

    // give the notification some time to propagate through the network
    await new Promise(resolve => setTimeout(resolve, 500));

    // assert light nodes are actually light
    expect(await recipient.cubeStore.getNumberOfStoredCubes()).toBe(0);

    // recipient retrieves notification
    const retrieved: CubeInfo = await recipient.cubeRetriever.requestScheduler.
      requestNotifications(notificationKey);
    expect(retrieved).toBeInstanceOf(CubeInfo);
    expect(retrieved.key).toEqual(notification.getKeyIfAvailable());
    expect(retrieved.getCube().getFirstField(CubeFieldType.NOTIFY).value).
      toEqual(notificationKey);
    expect(retrieved.getCube().getFirstField(CubeFieldType.FROZEN_NOTIFY_RAWCONTENT).value).
      toEqual(contentField.value);

    // shutdown
    await Promise.all([
      fullNode1.shutdown(),
      fullNode2.shutdown(),
      sender.shutdown(),
      recipient.shutdown(),
    ]);
  }, 5000);
});
