import { CubeStore } from "../../../src/core/cube/cubeStore";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportConnection } from "../../../src/core/networking/testingDummies/dummyTransportConnection";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/dummyNetworkManager";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// TODO: write a proper, complete set of unit tests
// We did not write actual unit tests for NetworkPeer in the beginning as we
// didn't have/use a proper mocking framework. Instead, we relied on our tests
// in NetworkManager, which are almost end-to-end tests involving actual
// network communiation.

describe('NetworkPeer', () => {
  let peer: NetworkPeer;
  let networkManager: NetworkManagerIf;
  let cubeStore: CubeStore;
  let peerDB: PeerDB;
  let conn: DummyTransportConnection;

  beforeAll(async () => {
    await sodium.ready;
  });

  describe('close', () => {
    beforeAll(async () => {
      // set up
      cubeStore = new CubeStore(testCoreOptions);
      await cubeStore.readyPromise;
      peerDB = new PeerDB();
      networkManager = new DummyNetworkManager(cubeStore, peerDB);
      conn = new DummyTransportConnection();
      peer = new NetworkPeer(
        networkManager, conn, cubeStore);

      // shutdown
      await peer.close();
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      peerDB.shutdown();
      await networkManager.shutdown();
    });

    it('should cancel all event subscriptions', () => {
      expect(conn.listenerCount("messageReceived")).toBe(0);
      expect(peerDB.listenerCount("exchangeablePeer")).toBe(0);
      expect(cubeStore.listeners("cubeAdded")).not.toContain((peer as any).sendSubscribedCubeUpdate);
    });
  });

});
