// Note! Most tests are in cubeRetriever.e2e.test.ts as we originally
//  wrote CubeRetriever's test involving actual network communication.
//  This file was originally only create to mirror VeritumRetriever's test
//  setup to help identify whether a bug originates on the VeritumRetriever (CCI)
//  or CubeRetriever (core) level.

import { CubeFieldType, CubeKey, CubeType } from '../../../../src/core/cube/cube.definitions';
import { CubeField } from '../../../../src/core/cube/cubeField';
import { NetConstants } from '../../../../src/core/networking/networkDefinitions';
import { ArrayFromAsync } from '../../../../src/core/helpers/misc';
import { Cube } from '../../../../src/core/cube/cube';
import { CubeRetriever } from '../../../../src/core/networking/cubeRetrieval/cubeRetriever';
import { CubeStore } from '../../../../src/core/cube/cubeStore';
import { RequestScheduler } from '../../../../src/core/networking/cubeRetrieval/requestScheduler';
import { NetworkManagerIf } from '../../../../src/core/networking/networkManagerIf';
import { DummyNetworkManager } from '../../../../src/core/networking/testingDummies/dummyNetworkManager';
import { DummyNetworkPeer } from '../../../../src/core/networking/testingDummies/dummyNetworkPeer';
import { PeerDB } from '../../../../src/core/peering/peerDB';

import { testCoreOptions } from '../../testcore.definition';

import sodium from 'libsodium-wrappers-sumo';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('CubeRetriever', () => {
  let cubeStore: CubeStore;
  let networkManager: NetworkManagerIf;
  let scheduler: RequestScheduler;
  let retriever: CubeRetriever;
  let peer: DummyNetworkPeer;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore(testCoreOptions);
    await cubeStore.readyPromise;

    networkManager = new DummyNetworkManager(cubeStore, new PeerDB());
    peer = new DummyNetworkPeer(networkManager, undefined, cubeStore);
    networkManager.outgoingPeers = [peer];

    scheduler = new RequestScheduler(networkManager, {
      ...testCoreOptions,
      requestTimeout: 200,
    });
    retriever = new CubeRetriever(cubeStore, scheduler);
  });

  afterEach(async () => {
    await cubeStore.shutdown();
    await networkManager.shutdown();
    await scheduler.shutdown();
  });


  describe('getNotifications()', () => {
    describe('notifications already in store', () => {
      it.todo('write tests (or just be fine with the e2e tests we already have');
    });

    describe('notifications retrieved over the wire', () => {
      it('retrieves two single-Cube notifications, arriving together after the request', async () => {
        // Sculpt two single-Chunk notifications
        // Note we don't add those to the store just yet, meaning they're not
        // locally available and have to be requested from the network.
        const recipientKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);

        const firstLatin = "Magni momenti nuntiatio";
        const first: Cube = Cube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            CubeField.RawContent(CubeType.PIC_NOTIFY, firstLatin),
            CubeField.Notify(recipientKey),
            CubeField.Date(148302000),  // fixed date, thus fixed key for ease of debugging
          ],
          requiredDifficulty: 0,
        });
        await first.compile();
        const firstBin: Buffer = first.getBinaryDataIfAvailable();
        expect(firstBin.length).toBe(NetConstants.CUBE_SIZE);

        const secondLatin = "Haud minus magni momenti nuntiatio";
        const second: Cube = Cube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            CubeField.RawContent(CubeType.PIC_NOTIFY, secondLatin),
            CubeField.Notify(recipientKey),
            CubeField.Date(148302000),  // fixed date, thus fixed key for ease of debugging
          ],
          requiredDifficulty: 0,
        });
        await second.compile();
        const secondBin: Buffer = second.getBinaryDataIfAvailable();
        expect(secondBin.length).toBe(NetConstants.CUBE_SIZE);


        // Run test --
        // note we don't await the result just yet
        const retrievalPromise: Promise<Cube[]> = ArrayFromAsync(
          retriever.getNotifications(recipientKey));

        // wait a moment to simulate network latency
        await new Promise(resolve => setTimeout(resolve, 100));

        // have both notification "arrive over the wire" at once
        await scheduler.handleCubesDelivered([firstBin, secondBin], peer);

        // verify test setup: assert both Cubes are now in the local store
        expect(await cubeStore.hasCube(first.getKeyIfAvailable())).toBe(true);
        expect(await cubeStore.hasCube(second.getKeyIfAvailable())).toBe(true);

        // All chunks have "arrived", so the retrieval promise should resolve
        const res: Cube[] = await retrievalPromise;

        // Verify result
        expect(res.length).toBe(2);
        expect(res[0] instanceof Cube).toBe(true);
        expect(res[1] instanceof Cube).toBe(true);
        expect(res.some(cube =>
          cube.getFirstField(CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString.includes(firstLatin))).
          toBe(true);
        expect(res.some(cube =>
          cube.getFirstField(CubeFieldType.PIC_NOTIFY_RAWCONTENT).valueString.includes(secondLatin))).
          toBe(true);
        expect(res.some(cube =>
          cube.getKeyIfAvailable().equals(first.getKeyIfAvailable()))).
          toBe(true);
        expect(res.some(cube =>
          cube.getKeyIfAvailable().equals(second.getKeyIfAvailable()))).
          toBe(true);
      });
    });
  });

});