import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { NetConstants, SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { AddressAbstraction, WebSocketAddress } from "../../../src/core/peering/addressing";
import { VerityNode, VerityNodeOptions } from "../../../src/core/verityNode";

import { Buffer } from 'buffer';

const testOptions: VerityNodeOptions = {
  inMemoryLevelDB: true,
  enableCubeRetentionPolicy: false,
  requiredDifficulty: 0,
  announceToTorrentTrackers: false,
  autoConnect: true,
  peerExchange: false,
  initialPeers: [],
  requestInterval: 100,  // yes, repeating requests ten times per second totally is a sensible idea!
}

const reducedDifficulty = 0;

describe('notification end-to-end tests', () => {
  test('notifications posted by light nodes propagate through the full node network to be retrieved by another light node', async() => {
    // set up a small line-shaped network:
    // Sender light node - Full node 1 - Full node 2 - Recipient light node
    // As peer exchange is off, it should stay line shaped so we properly test
    // Cube propagation.
    const fullNode1: VerityNode = new VerityNode({
      ...testOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.ws, 61101],
      ]),
    });
    await fullNode1.readyPromise;
    const fullNode2: VerityNode = new VerityNode({
      ...testOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.ws, 61111],
      ]),
      initialPeers: [new AddressAbstraction("ws://127.0.0.1:61101")],
    });
    const sender: VerityNode = new VerityNode({
      ...testOptions,
      inMemoryLevelDB: true,
      lightNode: true,
      initialPeers: [new AddressAbstraction("ws://127.0.0.1:61101")],
    });
    await fullNode2.readyPromise;
    const recipient: VerityNode = new VerityNode({
      ...testOptions,
      inMemoryLevelDB: true,
      lightNode: true,
      initialPeers: [new AddressAbstraction("ws://127.0.0.1:61111")],
    });
    await sender.readyPromise;
    await recipient.readyPromise;

    const notificationKey: Buffer = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42);

    // sender sculpts a notification Cube for recipient
    const contentField = CubeField.RawContent(CubeType.FROZEN_NOTIFY,
      "Haec notificatio ad collegam meam directa est");
    const notification: Cube = Cube.Frozen({
      fields: [
        contentField,
        CubeField.Notify(notificationKey),
        ],
      requiredDifficulty: reducedDifficulty,
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
    expect(retrieved.getCube().fields.getFirst(CubeFieldType.NOTIFY).value).
      toEqual(notificationKey);
    expect(retrieved.getCube().fields.getFirst(CubeFieldType.FROZEN_NOTIFY_RAWCONTENT).value).
      toEqual(contentField.value);

    // shutdown
    await Promise.all([
      fullNode1.shutdown(),
      fullNode2.shutdown(),
      sender.shutdown(),
      recipient.shutdown(),
    ]);
  }, 20000);
});
