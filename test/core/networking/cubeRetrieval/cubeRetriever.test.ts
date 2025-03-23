import type { NetworkPeerIf } from '../../../../src/core/networking/networkPeerIf';

import { Cube } from "../../../../src/core/cube/cube";
import { CubeKey, CubeType } from "../../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeInfo } from "../../../../src/core/cube/cubeInfo";
import { CubeStore, CubeStoreOptions } from "../../../../src/core/cube/cubeStore";
import { CubeRetriever } from "../../../../src/core/networking/cubeRetrieval/cubeRetriever";
import { SupportedTransports } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManager } from "../../../../src/core/networking/networkManager";
import { NetworkManagerOptions } from '../../../../src/core/networking/networkManagerIf';
import { WebSocketAddress } from "../../../../src/core/peering/addressing";
import { Peer } from "../../../../src/core/peering/peer";
import { PeerDB } from "../../../../src/core/peering/peerDB";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';

let local: NetworkManager;
let remote: NetworkManager;
let cubeRetriever: CubeRetriever;

const reducedDifficulty = 0;

const testCubeStoreParams: CubeStoreOptions = {
  inMemory: true,
  enableCubeRetentionPolicy: false,
  requiredDifficulty: 0,
};
const lightNodeMinimalFeatures: NetworkManagerOptions = {  // disable optional features
  announceToTorrentTrackers: false,
  autoConnect: false,
  lightNode: true,
  peerExchange: false,
};

// Note: These are actually almost end-to-end tests as they involve actual
//   network communication via WebSockets.

describe('CubeRetriever', () => {
  beforeAll(async () => {
    local = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...lightNodeMinimalFeatures,
        transports: new Map([[SupportedTransports.ws, 18001]]),
      },
    );
    cubeRetriever = new CubeRetriever(local.cubeStore, local.scheduler);
    remote = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...lightNodeMinimalFeatures,
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
        requiredDifficulty: reducedDifficulty,
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
        requiredDifficulty: reducedDifficulty,
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
          CubeField.RawContent(CubeType.PMUC, "hic cubus iam repositus est"),
          CubeField.PmucUpdateCount(1),
        ],
        requiredDifficulty: reducedDifficulty,
        publicKey, privateKey,
      });
      await local.cubeStore.addCube(preExisting);

      // run test call
      const gen = cubeRetriever.subscribeCube(publicKey);
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
        requiredDifficulty: reducedDifficulty,
        publicKey, privateKey,
      });
      await local.cubeStore.addCube(localUpdate);

      remoteUpdate = Cube.Create({
        cubeType: CubeType.PMUC,
        fields: [
          CubeField.RawContent(CubeType.PMUC, "hic cubus remoto renovatus est"),
          CubeField.PmucUpdateCount(3),
        ],
        requiredDifficulty: reducedDifficulty,
        publicKey, privateKey,
      });
      await remote.cubeStore.addCube(remoteUpdate);

      await new Promise(resolve => setTimeout(resolve, 1000));  // give it some time
    });

    it.todo('yields an already locally available Cube');

    it('yields a local-originating update', () => {
      expect(yielded.some(cube => cube.equals(localUpdate))).toBe(true);
    });

    it('yields a remote-originating update', () => {
      expect(yielded.some(cube => cube.equals(remoteUpdate))).toBe(true);
    });
  });
});
