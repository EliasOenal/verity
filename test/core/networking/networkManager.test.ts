import { CubeStore } from "../../../src/core/cube/cubeStore";
import { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { DummyTransportServer } from "../../../src/core/networking/testingDummies/dummyTransportServer";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/dummyNetworkManager";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { DummyNetworkTransport } from "../../../src/core/networking/testingDummies/dummyNetworkTransport";
import { NetworkManager } from "../../../src/core/networking/networkManager";
import { SupportedTransports } from "../../../src/core/networking/networkDefinitions";

// TODO: write a proper, complete set of unit tests
// We did not write actual unit tests for NetworkManager in the beginning as we
// didn't have/use a proper mocking framework.
// Instead, our comprehensive set of tests is in the networkManager.websocket
// an networkManager.libp2p test files, which are almost end-to-end tests
// involving actual network communiation.

describe('NetworkManager', () => {
  let networkManager: NetworkManagerIf;
  let cubeStore: CubeStore;
  let peerDB: PeerDB;
  let transport: DummyNetworkTransport;
  let transportServer: DummyTransportServer;

  beforeAll(async () => {
    await sodium.ready;
  });

  describe('shutdown', () => {
    beforeAll(async () => {
      // set up
      cubeStore = new CubeStore(testCoreOptions);
      await cubeStore.readyPromise;
      peerDB = new PeerDB();

      networkManager = new NetworkManager(
        cubeStore, peerDB, {
          transports: new Map([
            [SupportedTransports.dummy, "whatever"],
          ])
        }
      );
      await networkManager.start();

      // fetch (dummy) transport objects as they're emitters
      transport = networkManager.transports.get(SupportedTransports.dummy)!;
      expect(transport).toBeInstanceOf(DummyNetworkTransport);
      transportServer = transport.servers[0];
      expect(transportServer).toBeInstanceOf(DummyTransportServer);

      // perform shutdown
      await networkManager.shutdown();
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      peerDB.shutdown();
      await networkManager.shutdown();
    });

    it('should cancel all event subscriptions', () => {
      expect(cubeStore.listenerCount("cubeAdded")).toBe(0);
      expect(transport.listenerCount("serverAddress")).toBe(0);
      expect(transportServer.listenerCount("incomingConnection")).toBe(0);
      expect(peerDB.listenerCount("newPeer")).toBe(0);
    });
  });

});
