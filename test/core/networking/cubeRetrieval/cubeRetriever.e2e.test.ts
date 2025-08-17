import type { NetworkPeerIf } from '../../../../src/core/networking/networkPeerIf';

import { ArrayFromAsync } from '../../../../src/core/helpers/misc';
import { Cube } from "../../../../src/core/cube/cube";
import { CubeKey, CubeType, NotificationKey } from "../../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeInfo } from "../../../../src/core/cube/cubeInfo";
import { CubeStore } from "../../../../src/core/cube/cubeStore";
import { CubeRetriever } from "../../../../src/core/networking/cubeRetrieval/cubeRetriever";
import { NetConstants, SupportedTransports } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManager } from "../../../../src/core/networking/networkManager";
import { WebSocketAddress } from "../../../../src/core/peering/addressing";
import { Peer } from "../../../../src/core/peering/peer";
import { PeerDB } from "../../../../src/core/peering/peerDB";

import { requiredDifficulty, testCoreOptions } from '../../testcore.definition';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import { asCubeKey } from '../../../../src/core/cube/keyUtil';

let local: NetworkManager;
let remote: NetworkManager;
let cubeRetriever: CubeRetriever;

// Note: These are actually almost end-to-end tests as they involve actual
//   network communication via WebSockets.

describe('CubeRetriever e2e tests', () => {
  beforeAll(async () => {
    local = new NetworkManager(
      new CubeStore(testCoreOptions),
      new PeerDB(),
      {
        ...testCoreOptions,
        lightNode: true,
        transports: new Map([[SupportedTransports.ws, 18001]]),
      },
    );
    cubeRetriever = new CubeRetriever(local.cubeStore, local.scheduler);
    remote = new NetworkManager(
      new CubeStore(testCoreOptions),
      new PeerDB(),
      {
        ...testCoreOptions,
        lightNode: false,  // full node (subscription provider)
        transports: new Map([[SupportedTransports.ws, 18002]]),
      },
    );
    await Promise.all([local.start(), remote.start()]);
    const np: NetworkPeerIf =
      local.connect(new Peer(new WebSocketAddress("localhost", 18002)));
    await np.onlinePromise;
  });

  afterAll(async () => {
    await Promise.all([local.shutdown(), remote.shutdown()]);
  })

  describe('getCube() / getCubeInfo()', () => {
    it('retrieves a locally available Cube', async () => {
      // create Cube
      const cube: Cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN, "Cubus localis in loco nostro disponibilis est"),
        requiredDifficulty,
      });
      await local.cubeStore.addCube(cube);
      const key: CubeKey = await cube.getKey();

      // retrieve Cube
      const retrieved: Cube = await cubeRetriever.getCube(key);
      expect((await retrieved.getHash()).equals(key)).toBe(true);
      // retrieve CubeInfo
      const retrievedInfo: CubeInfo = await cubeRetriever.getCubeInfo(key);
      expect(retrievedInfo.date).toEqual(cube.getDate());
      expect(retrievedInfo.binaryCube.equals(await cube.getBinaryData())).toBe(true);
    });

    it('retrieves a Cube available remotely', async () => {
      // create Cube
      const cube: Cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN, "Cubus remotus per rete petendus est"),
        requiredDifficulty,
      });
      await remote.cubeStore.addCube(cube);
      const key: CubeKey = await cube.getKey();

      // retrieve Cube
      const retrieved: Cube = await cubeRetriever.getCube(key);
      expect((await retrieved.getHash()).equals(key)).toBe(true);
      // retrieve CubeInfo
      const retrievedInfo: CubeInfo = await cubeRetriever.getCubeInfo(key);
      expect(retrievedInfo.date).toEqual(cube.getDate());
      expect(retrievedInfo.binaryCube.equals(await cube.getBinaryData())).toBe(true);
    });
  });  // getCube() / getCubeInfo()


  describe('subscribeCube()', () => {
    let yielded: Cube[];
    let preExisting: Cube;
    let localUpdate: Cube;
    let remoteUpdate: Cube;

    beforeAll(async () => {
      yielded = [];

      // create a keypair
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey = Buffer.from(keyPair.publicKey);
      const privateKey = Buffer.from(keyPair.privateKey);

      // create pre-existing Cube
      preExisting = Cube.Create({
        cubeType: CubeType.PMUC,
        fields: [
          CubeField.RawContent(CubeType.PMUC, "hic cubus in repositus est"),
          CubeField.PmucUpdateCount(1),
        ],
        requiredDifficulty, publicKey, privateKey,
      });
      await local.cubeStore.addCube(preExisting);

      // run test call
      const gen = cubeRetriever.subscribeCube(asCubeKey(publicKey));
      // consume generator
      (async () => {
        for await (const cube of gen) {
          yielded.push(cube);
        }
      })();

      localUpdate = Cube.Create({
        cubeType: CubeType.PMUC,
        fields: [
          CubeField.RawContent(CubeType.PMUC, "hic cubus loco renovatus est"),
          CubeField.PmucUpdateCount(2),
        ],
        requiredDifficulty, publicKey, privateKey,
      });
      await local.cubeStore.addCube(localUpdate);

      remoteUpdate = Cube.Create({
        cubeType: CubeType.PMUC,
        fields: [
          CubeField.RawContent(CubeType.PMUC, "hic cubus remoto renovatus est"),
          CubeField.PmucUpdateCount(3),
        ],
        requiredDifficulty, publicKey, privateKey,
      });
      await remote.cubeStore.addCube(remoteUpdate);

      // Explicitly request the remote update to trigger local cubeAdded event
      // (since subscribeCube no longer implicitly requests existing data)
      // Use requestScheduler directly because cubeRetriever.getCube won't update mutable cubes
      await cubeRetriever.requestScheduler.requestCube(asCubeKey(publicKey));

      await new Promise(resolve => setTimeout(resolve, 1000));  // give it some time
    });

    it.todo('yields an already locally available Cube');

    it('yields a local-originating update', () => {
      expect(yielded.some(cube => cube.equals(localUpdate))).toBe(true);
    });

    it('yields a remote-originating update', () => {
      expect(yielded.some(cube => cube.equals(remoteUpdate))).toBe(true);
    });
  });  // subscribeCube()


  describe('getNotifications()', () => {
    const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42) as NotificationKey;
    const irrelevantKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 43) as NotificationKey;
    let notificationCubeKeys: CubeKey[];

    beforeAll(async () => {
      // Sculpt two Cubes notifying recipientKey, and an irrelevant one
      // notifying irrelevantKey.
      const notification1 = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.RawContent(CubeType.PIC_NOTIFY, "Cubus notificationis"),
          CubeField.Notify(recipientKey),
        ],
        requiredDifficulty,
      });
      await local.cubeStore.addCube(notification1);

      const notification2 = Cube.Create({
        cubeType:CubeType.FROZEN_NOTIFY,
        fields: [
            CubeField.Notify(recipientKey),  // mix up input field order for extra fuzzing
            CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Hic receptor notificationis popularis est"),
        ],
        requiredDifficulty,
      });
      await local.cubeStore.addCube(notification2);

      const irrelevant = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.RawContent(CubeType.PIC_NOTIFY, "Cubus irrelevans"),
          CubeField.Notify(irrelevantKey),
        ],
        requiredDifficulty,
      });
      await local.cubeStore.addCube(irrelevant);

      notificationCubeKeys = [
        await notification1.getKey(),
        await notification2.getKey(),
      ];
    });

    it('fetches multiple locally available notifications', async () => {
      const retrieved: Cube[] = await ArrayFromAsync(
        cubeRetriever.getNotifications(recipientKey)
      );
      expect(retrieved.length).toEqual(notificationCubeKeys.length);
      // Assert each retrieved Cube is one of our two notifications
      expect(retrieved.every(cube => notificationCubeKeys.includes(cube.getKeyIfAvailable()))).toBe(true);
      // Assert each of our notifications is retrieved
      expect(notificationCubeKeys.every(key => retrieved.some(cube => cube.getKeyIfAvailable().equals(key)))).toBe(true);
    }, 10000);  // blocks till timeout due to Github#703

    it('fetches multiple remote notifications', async () => {
      // sculpt two remote notifications
      const remote1 = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.RawContent(CubeType.PIC_NOTIFY, "monitum alienum"),
          CubeField.Notify(recipientKey),
        ],
        requiredDifficulty,
      });
      await remote.cubeStore.addCube(remote1);
      const remote1Key = await remote1.getKey();

      const remote2 = Cube.Create({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          CubeField.RawContent(CubeType.PIC_NOTIFY, "aliud monitum alienum"),
          CubeField.Notify(recipientKey),
        ],
        requiredDifficulty,
      });
      await remote.cubeStore.addCube(remote2);
      const remote2Key = await remote2.getKey();

      // run test
      const retrieved: Cube[] = await ArrayFromAsync(
        cubeRetriever.getNotifications(recipientKey)
      );
      expect(retrieved.some(cube => cube.getKeyIfAvailable().equals(remote1Key))).toBe(true);
      expect(retrieved.some(cube => cube.getKeyIfAvailable().equals(remote2Key))).toBe(true);
    });
  });  // getNotifications()


  describe('subscribeNotifications()', () => {
    it.todo('write tests');
  });  // subscribeNotifications()
});
