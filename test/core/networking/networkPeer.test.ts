import { KeyPair } from "../../../src/cci/helpers/cryptography";
import { Cube } from "../../../src/core/cube/cube";
import { CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { calculateHash, keyVariants } from "../../../src/core/cube/cubeUtil";
import { unixtime } from "../../../src/core/helpers/misc";
import { MessageClass, NetConstants } from "../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { CubeResponseMessage, NetworkMessage, SubscribeCubeMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode } from "../../../src/core/networking/networkMessage";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportConnection } from "../../../src/core/networking/testingDummies/DummyTransportConnection";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/networkManagerDummy";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { Settings } from "../../../src/core/settings";
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

  beforeEach(() => {
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
