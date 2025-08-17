import { Settings } from '../../../src/core/settings';
import { NetConstants, SupportedTransports } from '../../../src/core/networking/networkDefinitions';

import { NetworkManagerOptions } from '../../../src/core/networking/networkManagerIf';
import { NetworkManager } from '../../../src/core/networking/networkManager';
import { NetworkPeer } from '../../../src/core/networking/networkPeer';
import { WebSocketTransport } from '../../../src/core/networking/transport/webSocket/webSocketTransport';
import { WebSocketServer } from '../../../src/core/networking/transport/webSocket/webSocketServer';
import { WebSocketConnection } from '../../../src/core/networking/transport/webSocket/webSocketConnection';
import { NetworkPeerIf, NetworkPeerLifecycle } from '../../../src/core/networking/networkPeerIf';

import { CubeFieldType, CubeKey, CubeType, NotificationKey } from '../../../src/core/cube/cube.definitions';
import { cubeContest, cubeExpiration, cubeLifetime } from '../../../src/core/cube/cubeUtil';
import { asCubeKey } from '../../../src/core/cube/keyUtil';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';
import { Cube } from '../../../src/core/cube/cube';
import { CubeField } from '../../../src/core/cube/cubeField';
import { CubeFields } from '../../../src/core/cube/cubeFields';
import { CubeStore, CubeStoreOptions } from '../../../src/core/cube/cubeStore';

import { WebSocketAddress } from '../../../src/core/peering/addressing';
import { Peer } from '../../../src/core/peering/peer';
import { PeerDB } from '../../../src/core/peering/peerDB';
import { logger } from '../../../src/core/logger';

import WebSocket from 'isomorphic-ws';
import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { CubeResponseMessage } from '../../../src/core/networking/networkMessage';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// Note: Most general functionality concerning NetworkManager, NetworkPeer
// etc is described within the WebSocket tests while the libp2p tests are more
// focused on asserting the libp2p framework integrates into Verity as expected.

const fullNodeMinimalFeatures: NetworkManagerOptions = {  // disable optional features
  announceToTorrentTrackers: false,
  autoConnect: false,
  lightNode: false,
  peerExchange: false,
};
const lightNodeMinimalFeatures: NetworkManagerOptions = {  // disable optional features
  announceToTorrentTrackers: false,
  autoConnect: false,
  lightNode: true,
  peerExchange: false,
};

describe('networkManager - WebSocket connection end-to-end tests', () => {
  const reducedDifficulty = 0;
  const testCubeStoreParams: CubeStoreOptions = {
    inMemory: true,
    enableCubeRetentionPolicy: false,
    requiredDifficulty: 0
  }

  describe('setup and teardown', () => {
    it('creates and cleanly shuts down a WebSocket server', async () => {
      const manager: NetworkManager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 3000]]),
        },
      );
      expect(manager.transports.size).toEqual(1);
      expect(manager.transports.get(SupportedTransports.ws)).
        toBeInstanceOf(WebSocketTransport);
      await manager.start();
      expect(manager.transports.get(SupportedTransports.ws)!.servers[0]).
        toBeInstanceOf(WebSocketServer);
      await manager.shutdown();
    }, 3000);

    it.todo('properly shuts down');
  });

  describe('connection handling', () => {
    it('should create a NetworkPeer on incoming connection', async () => {
      const manager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 3001]]),
        },
      );
      await manager.start();
      // @ts-ignore Checking private attributes
      (manager.transports.get(SupportedTransports.ws).servers[0] as WebSocketServer).server.on('connection', () => {
        expect(manager?.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
      });

      const client = new WebSocket('ws://localhost:3001');
      client.on('open', () => {
        client.close();
        manager.shutdown();
      });
    }, 3000);

    it('should create a NetworkPeer on outgoing connection', async () => {
      const manager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 3003]]),
        },
      );
      await manager.start();

      const server = new WebSocket.Server({ port: 3002 });

      // Wait for server2 to start listening
      await new Promise((resolve) => server?.on('listening', resolve));

      manager.connect(new Peer(new WebSocketAddress('localhost', 3002)));

      expect(manager.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
      server.close();
      manager.shutdown();
    }, 3000);


    it('correctly opens and closes multiple connections', async () => {
      // create a server and two clients
      const listener = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 4000]]),
        },
      );
      const client1 = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        fullNodeMinimalFeatures  // note: no listeners defined
      );
      const client2 = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        fullNodeMinimalFeatures  // note: no listeners defined
      );
      // wait for server to be listening
      await listener.start();

      // connect clients to server and make sure all are well connected
      client1.connect(new Peer(new WebSocketAddress("127.0.0.1", 4000)));
      expect(client1.outgoingPeers.length).toEqual(1);
      await client1.outgoingPeers[0].onlinePromise;
      expect(listener.incomingPeers.length).toEqual(1);
      await listener.incomingPeers[0].onlinePromise;

      client2.connect(new Peer(new WebSocketAddress("127.0.0.1", 4000)));
      expect(client2.outgoingPeers.length).toEqual(1);
      await client2.outgoingPeers[0].onlinePromise;
      expect(listener.incomingPeers.length).toEqual(2);
      await listener.incomingPeers[1].onlinePromise;

      // shut the whole thing down
      const listenerShutdown = new Promise<void>(resolve => listener.on('shutdown', resolve));
      const client1Shutdown = new Promise<void>(resolve => client1.on('shutdown', resolve));
      const client2Shutdown = new Promise<void>(resolve => client2.on('shutdown', resolve));
      client1.shutdown();
      client2.shutdown();
      await client1Shutdown;
      await client2Shutdown;
      listener.shutdown();
      await listenerShutdown;
    });


    it('should exchange HELLO messages and report online after connection', async () => {
      const manager1 = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 4010]]),
        },
      );
      const manager2 = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 4011]]),
        },
      );

      const promise1_listening = manager1.start();
      const promise2_listening = manager2.start();
      await Promise.all([promise1_listening, promise2_listening]);

      manager2.connect(new Peer(new WebSocketAddress("localhost", 4010)));
      expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
      await manager2.outgoingPeers[0].onlinePromise
      await manager1.incomingPeers[0].onlinePromise;
      expect(manager1.online).toBeTruthy();
      expect(manager2.online).toBeTruthy();
      expect(manager1.incomingPeers[0]).toBeInstanceOf(NetworkPeer);

      const promise1_shutdown = manager1.shutdown();
      const promise2_shutdown = manager2.shutdown();
      await Promise.all([promise1_shutdown, promise2_shutdown]);
    });

    it('works with IPv6', async () => {
      // create two nodes and connect them via IPv6 loopback (::1)
      const protagonist = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 3010]]),
        },
      );
      const ipv6peer = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 3011]]),
        },
      );
      await Promise.all([protagonist.start(), ipv6peer.start()]);
      const peerObj = protagonist.connect(
        new Peer(new WebSocketAddress("[::1]", 3011))
      );
      // node still offline now as connect is obviously async
      expect(protagonist.online).toBeFalsy();
      expect(peerObj.online).toBeFalsy();

      await peerObj.onlinePromise;  // now they should be online!
      expect(protagonist.online).toBeTruthy();
      expect(peerObj.status).toEqual(NetworkPeerLifecycle.ONLINE);
      expect(peerObj.online).toBeTruthy();

      // After connect, protagonist should tell its peer it's server port.
      // ipv6peer will emit updatepeer when this message is received.
      // The peer should correctly associate this with the IPv6 loopback
      // address (::1).
      await new Promise<void>(resolve => ipv6peer.on('updatepeer', resolve));
      expect(ipv6peer.incomingPeers[0].address.ip).toEqual("::1");
      expect(ipv6peer.incomingPeers[0].address.port).toEqual(3010);

      // shutdown
      await Promise.all([protagonist.shutdown(), ipv6peer.shutdown()]);
    });

    it('should block a peer when trying to connect to itself', async () => {
      const peerDB = new PeerDB();
      const manager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        peerDB,
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 6004]]),
        },
      );
      await manager.start();

      expect(peerDB.peersBlocked.size).toEqual(0);

      // Trigger a connection to itself
      manager.connect(new Peer(new WebSocketAddress('localhost', 6004)));

      // Wait for the 'blocklist' event to be triggered
      await new Promise<void>((resolve, reject) => {
        manager.on('blocklist', (bannedPeer: Peer) => {
          resolve();
        })
      });
      expect(peerDB.peersBlocked.size).toEqual(1);

      manager.shutdown();
    }, 3000);

    it('should close the duplicate connections to same peer on different address', async () => {
      const myPeerDB = new PeerDB();
      const myManager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        myPeerDB,
        fullNodeMinimalFeatures,  // note: no listeners defined
      );
      myManager.start();

      const otherPeerDB = new PeerDB();
      const otherManager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        otherPeerDB,
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 7005]]),
        },
      );
      await otherManager.start();

      // connect to peer and wait till connected
      // (= wait for the peeronline signal, which is emitted after the
      //    hello exchange is completed)
      const iHaveConnected = new Promise((resolve) => myManager.on('peeronline', resolve));
      const otherHasConnected = new Promise((resolve) => otherManager.on('peeronline', resolve));
      const bothHaveConnected = Promise.all([iHaveConnected, otherHasConnected]);
      const myFirstNp: NetworkPeerIf =
        myManager.connect(new Peer(new WebSocketAddress('localhost', 7005)));
      await bothHaveConnected;

      // ensure connected
      expect(myManager.outgoingPeers.length).toEqual(1);
      expect(myManager.incomingPeers.length).toEqual(0);
      expect(myManager.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
      expect(myManager.outgoingPeers[0] === myFirstNp).toBeTruthy();
      expect(myManager.outgoingPeers[0].id?.equals(otherManager.id));
      expect(otherManager.outgoingPeers.length).toEqual(0);
      expect(otherManager.incomingPeers.length).toEqual(1);
      expect(otherManager.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
      const othersFirstNp: NetworkPeerIf = otherManager.incomingPeers[0];
      expect(othersFirstNp.id?.equals(myManager.id));
      expect(myPeerDB.peersVerified.size).toEqual(0);  // outgoing peers get exchangeable on verification
      expect(myPeerDB.peersExchangeable.size).toEqual(1);
      expect(otherPeerDB.peersVerified.size).toEqual(1);
      expect(otherPeerDB.peersExchangeable.size).toEqual(0);  // incoming ones don't
      expect(myManager.outgoingPeers[0].conn).toBeInstanceOf(WebSocketConnection);
      expect((myManager.outgoingPeers[0].conn as WebSocketConnection).
        ws.readyState).toEqual(WebSocket.OPEN);
      expect(myFirstNp.conn).toBeInstanceOf(WebSocketConnection);
      expect((myFirstNp.conn as WebSocketConnection).
        ws.readyState).toEqual(WebSocket.OPEN);
      expect(othersFirstNp.conn).toBeInstanceOf(WebSocketConnection);
      expect((othersFirstNp.conn as WebSocketConnection).
        ws.readyState).toEqual(WebSocket.OPEN);

      // Connect again through different address.
      // This will trigger the peerclosed signal on both peer
      // (and a duplicatepeer signal on at least one of them, but you
      // can't know on which one(s)).
      // Wait for these signals; if they don't come, this test will fail
      // due to *timeout only*.
      const iNotedDuplicate = new Promise((resolve) =>
        myManager.on('peerclosed', resolve));
      const otherNotedDuplicate = new Promise((resolve) =>
        otherManager.on('peerclosed', resolve));
      const myDuplicateNp: NetworkPeerIf =
        myManager.connect(new Peer(new WebSocketAddress('127.0.0.1', 7005)));
      let othersDuplicateNp: NetworkPeerIf;
      otherManager.on("incomingPeer", peer => othersDuplicateNp = peer);
      await iNotedDuplicate;
      logger.error("iNotedDuplicate")
      await otherNotedDuplicate;
      logger.error("otherNotedDuplicate")

      expect(myPeerDB.peersBlocked.size).toEqual(0);  // duplicate is not / no longer blocklisting
      expect(otherPeerDB.peersBlocked.size).toEqual(0);  // duplicate is not / no longer blocklisting
      expect(myManager.outgoingPeers.length).toEqual(1);
      expect(myManager.incomingPeers.length).toEqual(0);
      // expect(otherManager.outgoingPeers.length).toEqual(0);  // at this point, peer exchange of other's own duplicate address might have occurred and other might not yet have realized it's his own address
      expect(otherManager.incomingPeers.length).toEqual(1);
      expect(myPeerDB.peersVerified.size).toEqual(0);  // outgoing peers get exchangeable on verification
      expect(myPeerDB.peersExchangeable.size).toEqual(1);
      expect(otherPeerDB.peersVerified.size).toEqual(1);
      expect(otherPeerDB.peersExchangeable.size).toEqual(0);  // incoming ones don't

      // ensure the duplicate connection has been closed,
      // while the original connection is still open
      expect((myFirstNp.conn as WebSocketConnection).
        ws.readyState).toEqual(WebSocket.OPEN);
      expect((othersFirstNp.conn as WebSocketConnection).
        ws.readyState).toEqual(WebSocket.OPEN);
      expect((myDuplicateNp.conn as WebSocketConnection).
        ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
      expect((othersDuplicateNp!.conn as WebSocketConnection).
        ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);

      // maybe implement further tests:
      // Will not attempt to reconnect to an already blocklisted peer
      // For these tests, peer exchange needs to be enabled on
      // NetworkManager creation

      // Teardown
      const iShutdown = new Promise(resolve => myManager.on('shutdown', resolve));
      const otherShutdown = new Promise(resolve => otherManager.on('shutdown', resolve));
      myManager.shutdown();
      otherManager.shutdown();
      await iShutdown;
      await otherShutdown;

      // expect all connections to be closed
      expect(myManager.outgoingPeers.length).toEqual(0);
      expect(myManager.incomingPeers.length).toEqual(0);
      expect(otherManager.outgoingPeers.length).toEqual(0);
      expect(otherManager.incomingPeers.length).toEqual(0);
      expect((myFirstNp.conn as WebSocketConnection).
        ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
      expect((othersFirstNp.conn as WebSocketConnection).
        ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
      expect((myDuplicateNp.conn as WebSocketConnection).
        ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
      expect((othersDuplicateNp!.conn as WebSocketConnection).
        ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
    }, 5000);

    it('only accepts incoming connections when enabled', async () => {
      const myPeerDB = new PeerDB();
      const myManager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        myPeerDB,
        {
          ...fullNodeMinimalFeatures,
          transports: new Map([[SupportedTransports.ws, 7005]]),
          acceptIncomingConnections: false,
        },
      );
      await myManager.start();

      const otherPeerDB = new PeerDB();
      const otherManager = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        otherPeerDB,
        fullNodeMinimalFeatures,  // note: no listeners
      );
      await otherManager.start();

      // Attempt to connect to myManager and set a timeout for the attempt
      const connectionAttempt = new Promise<boolean>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection attempt timed out')), 200);
        otherManager.connect(new Peer(new WebSocketAddress('localhost', 7005)));
        myManager.on('incomingPeer', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      let connectionEstablished = false;
      try {
        connectionEstablished = await connectionAttempt;
      } catch (error) {
        connectionEstablished = false;
      }

      // Ensure the connection was not established since acceptIncomingConnections is false
      expect(connectionEstablished).toBe(false);
      expect(myManager.incomingPeers.length).toEqual(0);
      expect(myPeerDB.peersVerified.size).toEqual(0);

      // Teardown
      const iShutdown = new Promise(resolve => myManager.on('shutdown', resolve));
      const otherShutdown = new Promise(resolve => otherManager.on('shutdown', resolve));
      await myManager.shutdown();
      await otherManager.shutdown();
      await iShutdown;
      await otherShutdown;

      // Ensure all connections are closed
      expect(myManager.outgoingPeers.length).toEqual(0);
      expect(myManager.incomingPeers.length).toEqual(0);
      expect(otherManager.outgoingPeers.length).toEqual(0);
      expect(otherManager.incomingPeers.length).toEqual(0);
    });

    it.todo('should fail gracefully when trying to connect to an invalid address');
  });

  describe('cube exchange', () => {
    describe('as a full node', () => {
      it('auto-exchanges Cubes after connection', async () => {
        const node1 = new NetworkManager(
          new CubeStore(testCubeStoreParams),
          new PeerDB(),
          {
            ...fullNodeMinimalFeatures,
            transports: new Map([[SupportedTransports.ws, 3021]]),
          },
        );
        const node2 = new NetworkManager(
          new CubeStore(testCubeStoreParams),
          new PeerDB(),
          {
            ...fullNodeMinimalFeatures,
            transports: new Map([[SupportedTransports.ws, 3022]]),
          },
        );
        await Promise.all([node1.cubeStore.readyPromise, node2.cubeStore.readyPromise]);
        await Promise.all([node1.start(), node2.start()]);
        const cube = Cube.Frozen(
          { fields: CubeField.RawContent(CubeType.FROZEN, "Hic cubus automatice transferetur") })
        const key = await cube.getKey();
        await node1.cubeStore.addCube(cube);

        expect(await node1.cubeStore.getNumberOfStoredCubes()).toEqual(1);
        expect(await node2.cubeStore.getNumberOfStoredCubes()).toEqual(0);

        await node1.connect(new Peer("127.0.0.1:3022"));
        // Wait up to three seconds for Cube exchange to happen
        await waitForCubeSync(node2.cubeStore, 1, 3000);

        const received: Cube = await node2.cubeStore.getCube(key);
        expect(received).toBeInstanceOf(Cube);
        expect((await received).getFirstField(CubeFieldType.FROZEN_RAWCONTENT).valueString).
          toContain("Hic cubus automatice transferetur");

        await Promise.all([node1.shutdown(), node2.shutdown()]);
      });

      it('syncs cubes between three nodes', async () => {
        const numberOfCubes = 10;
        const cubeStore = new CubeStore(testCubeStoreParams);
        const cubeStore2 = new CubeStore(testCubeStoreParams);
        const cubeStore3 = new CubeStore(testCubeStoreParams);
        const manager1 = new NetworkManager(
          cubeStore, new PeerDB(),
          {
            ...fullNodeMinimalFeatures,
            transports: new Map([[SupportedTransports.ws, 4020]]),
          },
        );
        const manager2 = new NetworkManager(
          cubeStore2, new PeerDB(),
          {
            ...fullNodeMinimalFeatures,
            transports: new Map([[SupportedTransports.ws, 4021]]),
          },
        );
        const manager3 = new NetworkManager(
          cubeStore3, new PeerDB(),
          {
            ...fullNodeMinimalFeatures,
            transports: new Map([[SupportedTransports.ws, 4022]]),
          },
        );

        // Start all three nodes
        const promise1_listening = manager1.start();
        const promise2_listening = manager2.start();
        const promise3_listening = manager3.start();
        await Promise.all([promise1_listening, promise2_listening, promise3_listening]);

        // Connect peer 2 to both peer 1 and peer 3
        manager2.connect(new Peer(new WebSocketAddress("localhost", 4020)));
        manager2.connect(new Peer(new WebSocketAddress('localhost', 4022)));
        expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        expect(manager2.outgoingPeers[1]).toBeInstanceOf(NetworkPeer);

        await manager2.outgoingPeers[0].onlinePromise
        await manager2.outgoingPeers[1].onlinePromise

        // Create new cubes at peer 1
        for (let i = 0; i < numberOfCubes; i++) {
          const cube = Cube.Frozen({
            fields: CubeField.RawContent(CubeType.FROZEN,
              `Cubus inutilis numero ${i} amplitudinem retis tuam consumens`),
            requiredDifficulty: reducedDifficulty
          });
          await cubeStore.addCube(cube);
        }
        expect(await cubeStore.getNumberOfStoredCubes()).toEqual(numberOfCubes);

        // sync cubes from peer 1 to peer 2
        expect(manager1.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        manager2.outgoingPeers[0].sendKeyRequests();
        // Verify cubes have been synced. Wait up to three seconds for that to happen.
        for (let i = 0; i < 30; i++) {
          if (await cubeStore2.getNumberOfStoredCubes() === numberOfCubes) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(await cubeStore2.getNumberOfStoredCubes()).toEqual(numberOfCubes);
        for await (const key of cubeStore.getKeyRange({ limit: Infinity })) {
          expect(await cubeStore2.getCube(key)).toBeInstanceOf(Cube);
        }

        // sync cubes from peer 2 to peer 3
        expect(manager3.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        manager3.incomingPeers[0].sendKeyRequests();
        // Verify cubes have been synced. Wait up to three seconds for that to happen.
        for (let i = 0; i < 30; i++) {
          if (await cubeStore3.getNumberOfStoredCubes() === numberOfCubes) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(await cubeStore3.getNumberOfStoredCubes()).toEqual(numberOfCubes);
        for await (const key of cubeStore2.getKeyRange({ limit: Infinity })) {
          expect(await cubeStore3.getCube(key)).toBeInstanceOf(Cube);
        }

        const promise1_shutdown = manager1.shutdown();
        const promise2_shutdown = manager2.shutdown();
        const promise3_shutdown = manager3.shutdown();
        await Promise.all([promise1_shutdown, promise2_shutdown, promise3_shutdown]);
      }, 5000);

      it('syncs MUC updates', async () => {
        await sodium.ready;
        const keyPair = sodium.crypto_sign_keypair();

        const cubeStore = new CubeStore(testCubeStoreParams);
        const cubeStore2 = new CubeStore(testCubeStoreParams);
        const manager1 = new NetworkManager(
          cubeStore, new PeerDB(),
          {
            ...fullNodeMinimalFeatures,
            transports: new Map([[SupportedTransports.ws, 5002]]),
          },
        );
        const manager2 = new NetworkManager(
          cubeStore2, new PeerDB(),
          {
            ...fullNodeMinimalFeatures,
            transports: new Map([[SupportedTransports.ws, 5001]]),
          },
        );

        // Start both nodes
        await Promise.all([manager1.start(), manager2.start()]);

        // Connect peer 1 to peer 2
        manager1.connect(new Peer(new WebSocketAddress('localhost', 5001)));
        expect(manager1.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        await manager1.outgoingPeers[0].onlinePromise;

        // just defining some vars, bear with me...
        let counterBuffer: Buffer;
        let muc: Cube;
        let mucKey: CubeKey;
        let receivedFields: CubeFields;

        // Create MUC at peer 1
        counterBuffer = Buffer.from("Prima versio cubi usoris mutabilis mei.");
        muc = Cube.MUC(
          Buffer.from(keyPair.publicKey),
          Buffer.from(keyPair.privateKey),
          {
            fields: CubeField.RawContent(CubeType.MUC, counterBuffer),
            requiredDifficulty: reducedDifficulty,
          }
        );
        mucKey = (await cubeStore.addCube(muc)).getKeyIfAvailable();
        const firstMucHash = await muc.getHash();
        expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);

        // sync MUC from peer 1 to peer 2
        const expectDelivery1: Promise<CubeInfo> =
          manager2.cubeStore.expectCube(mucKey);
        manager2.incomingPeers[0].sendKeyRequests();
        await expectDelivery1;

        // check MUC has been received correctly at peer 2
        expect(await cubeStore2.getNumberOfStoredCubes()).toEqual(1);
        expect(await cubeStore2.getCube(mucKey)).toBeInstanceOf(Cube);
        expect((await (await cubeStore2.getCube(mucKey))?.getHash())!.equals(firstMucHash)).toBeTruthy();
        receivedFields = (await cubeStore2.getCube(mucKey))?.fields!;
        expect(receivedFields?.getFirst(CubeFieldType.MUC_RAWCONTENT).valueString).
          toContain("Prima versio cubi usoris mutabilis mei.");

        // update MUC at peer 1
        await new Promise(resolve => setTimeout(resolve, 1000));  // wait one second as we don't have better time resolution
        counterBuffer = Buffer.from("Secunda versio cubi usoris mutabilis mei.");
        muc = Cube.MUC(
          Buffer.from(keyPair.publicKey),
          Buffer.from(keyPair.privateKey),
          {
            fields: CubeField.RawContent(CubeType.MUC, counterBuffer),
            requiredDifficulty: reducedDifficulty,
          }
        );
        mucKey = (await cubeStore.addCube(muc)).getKeyIfAvailable();
        const secondMucHash = await muc.getHash();
        expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);  // still just one, new MUC version replaces old MUC version

        // sync MUC from peer 1 to peer 2, again
        const expectDelivery2: Promise<CubeInfo> =
          manager2.cubeStore.expectCube(mucKey);
        manager2.incomingPeers[0].sendKeyRequests();
        await expectDelivery2;

        // check MUC has been updated correctly at peer 2
        expect(await cubeStore2.getNumberOfStoredCubes()).toEqual(1);  // still one, MUC has only been updated
        expect(await cubeStore2.getCube(mucKey)).toBeInstanceOf(Cube);
        expect((await (await cubeStore2.getCube(mucKey))?.getHash())!.equals(secondMucHash)).toBeTruthy();
        receivedFields = (await cubeStore2.getCube(mucKey))?.fields!;
        expect(receivedFields?.getFirst(CubeFieldType.MUC_RAWCONTENT).valueString).
          toContain("Secunda versio cubi usoris mutabilis mei.");

        // teardown
        const promise1_shutdown = manager1.shutdown();
        const promise2_shutdown = manager2.shutdown();
        await Promise.all([promise1_shutdown, promise2_shutdown]);
      }, 5000);


      describe('syncs PMUC updates', async () => {
        let manager1: NetworkManager, manager2: NetworkManager;
        let privateKey: Buffer, publicKey: Buffer;
        let firstHash: Buffer, secondHash: Buffer, thirdHash: Buffer, fourthHash: Buffer;
        const firstVersionContent = "Haec est prima versio cubiculi utentis perpetuo mutabilis";
        const secondVersionContent = "A Creatore meo renovatus sum";
        const thirdVersionContent = "Haec versio ab altera parte scripta est";
        const fourthVersionContent = "Si numeri versionis idem sunt, diuturnissima vita vincit"
        const staleContent = "Versiones obsoletae non accipientur";

        beforeAll(async () => {
          await sodium.ready;
          const keyPair = sodium.crypto_sign_keypair();
          privateKey = Buffer.from(keyPair.privateKey);
          publicKey = Buffer.from(keyPair.publicKey);

          manager1 = new NetworkManager(
            new CubeStore(testCubeStoreParams), new PeerDB(),
            {
              ...fullNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 5003]]),
            },
          );
          manager2 = new NetworkManager(
            new CubeStore(testCubeStoreParams), new PeerDB(),
            {
              ...fullNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 5004]]),
            },
          );

          // Start both nodes
          await Promise.all([manager1.start(), manager2.start()]);

          // Connect peer 1 to peer 2
          manager1.connect(new Peer(new WebSocketAddress('localhost', 5004)));
          expect(manager1.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
          await manager1.outgoingPeers[0].onlinePromise;

          // Create PMUC at peer 1
          const pmuc = Cube.Create({
            cubeType: CubeType.PMUC,
            privateKey, publicKey,
            fields: [
              CubeField.RawContent(CubeType.PMUC, firstVersionContent),
              CubeField.PmucUpdateCount(1),
              CubeField.Date(1e9),  // only relevant later test
            ],
            requiredDifficulty: reducedDifficulty,
          });
          await manager1.cubeStore.addCube(pmuc);
          firstHash = await pmuc.getHash();
          expect(await manager1.cubeStore.getNumberOfStoredCubes()).toEqual(1);

          // sync PMUC from peer 1 to peer 2
          const expectPmucDelivery: Promise<CubeInfo> =
            manager2.cubeStore.expectCube(publicKey as CubeKey);
          manager2.incomingPeers[0].sendKeyRequests();
          await expectPmucDelivery;
        });

        it('receives the first version from peer 1 at peer 2', async () => {
          // check PMUC has been received correctly by peer 2
          expect(await manager2.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          const rcvd: Cube = await manager2.cubeStore.getCube(publicKey as CubeKey);
          expect(rcvd).toBeInstanceOf(Cube);
          expect((await rcvd.getHash()).equals(firstHash)).toBeTruthy();
          expect(rcvd.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value.
            readUintBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);
          expect(rcvd.getFirstField(CubeFieldType.PMUC_RAWCONTENT).valueString).
            toContain(firstVersionContent);
        });


        it('will refuse updates of same version number if lifetime is shorter', async () => {
          // update PMUC at peer 1
          const pmuc = Cube.Create({
            cubeType: CubeType.PMUC,
            privateKey, publicKey,
            fields: [
              CubeField.RawContent(CubeType.PMUC, staleContent),
              CubeField.PmucUpdateCount(1),  // note version conflict
              CubeField.Date(1e6),  // note this one is older
            ],
            requiredDifficulty: reducedDifficulty,
          });
          const staleHash: Buffer = await pmuc.getHash();
          // we need to wipe the old version locally as it obviously wouldn't
          // even be accepted as an update locally
          await manager1.cubeStore.wipeAll();
          await manager1.cubeStore.addCube(pmuc);

          // verify test setup:
          // expect the stale version to be stored locally
          expect(await manager1.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          const stored: Cube = await manager1.cubeStore.getCube(publicKey as CubeKey);
          expect(await stored.getHash()).toEqual(staleHash);
          expect(stored.getFirstField(CubeFieldType.PMUC_RAWCONTENT).valueString).
            toContain(staleContent);
          // expect peer 2 to have another version of the PMUC
          const previous: Cube = await manager2.cubeStore.getCube(publicKey as CubeKey);
          expect(previous).toBeInstanceOf(Cube);
          expect((await previous.getHash()).equals(staleHash)).toBe(false);
          expect(previous.getFirstField(CubeFieldType.PMUC_RAWCONTENT).valueString)
            .not.toContain(staleContent);
          // expect the version currently present at peer 2 to have the same update count
          expect(previous.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value.
            readUintBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);
          // expect the version currently present at peer 2 to win a Cube contest
          // against the stale update
          const previousInfo: CubeInfo = await previous.getCubeInfo();
          const staleInfo: CubeInfo = await pmuc.getCubeInfo();
          expect(previousInfo.updatecount).toEqual(staleInfo.updatecount);
          expect(staleInfo.date).toBeLessThan(previousInfo.date);
          expect(cubeExpiration(previousInfo)).toBeGreaterThan(cubeExpiration(staleInfo));
          expect(cubeContest(staleInfo, previousInfo)).toBe(previousInfo);

          // sync PMUC from peer 1 to peer 2
          manager2.incomingPeers[0].sendKeyRequests();
          // give it some time -- TODO avoid time based waiting
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // check MUC has *not* been updated at peer 2
          expect(await manager2.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          const rcvd: Cube = await manager2.cubeStore.getCube(publicKey as CubeKey);
          expect(rcvd).toBeInstanceOf(Cube);
          expect(rcvd.getFirstField(CubeFieldType.PMUC_RAWCONTENT).valueString).
            not.toContain(staleContent);
          expect((await rcvd.getHash()).equals(staleHash)).toBeFalsy();
        });


        it('syncs the second version from peer 1 to peer 2', async () => {
          // update PMUC at peer 1
          const pmuc = Cube.Create({
            cubeType: CubeType.PMUC,
            privateKey, publicKey,
            fields: [
              CubeField.RawContent(CubeType.PMUC, secondVersionContent),
              CubeField.PmucUpdateCount(2),
              CubeField.Date(1e9),  // only relevant later test
            ],
            requiredDifficulty: reducedDifficulty,
          });
          await manager1.cubeStore.addCube(pmuc);
          secondHash = await pmuc.getHash();
          // expect still just one Cube stored, new version replaces old version
          expect(await manager1.cubeStore.getNumberOfStoredCubes()).toEqual(1);

          // sync PMUC from peer 1 to peer 2, again
          const expectPmucDelivery: Promise<CubeInfo> =
            manager2.cubeStore.expectCube(publicKey as CubeKey);
          manager2.incomingPeers[0].sendKeyRequests();
          await expectPmucDelivery;

          // check MUC has been updated correctly at peer 2
          expect(await manager2.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          const rcvd: Cube = await manager2.cubeStore.getCube(publicKey as CubeKey);
          expect(rcvd).toBeInstanceOf(Cube);
          expect((await rcvd.getHash()).equals(secondHash)).toBeTruthy();
          expect(rcvd.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value.
            readUintBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(2);
          expect(rcvd.getFirstField(CubeFieldType.PMUC_RAWCONTENT).valueString).
            toContain(secondVersionContent);
        });

        it('will sync in reverse direction if version number is higher', async () => {
          // update PMUC at peer 2
          const pmuc = Cube.Create({
            cubeType: CubeType.PMUC,
            privateKey, publicKey,
            fields: [
              CubeField.RawContent(CubeType.PMUC, thirdVersionContent),
              CubeField.PmucUpdateCount(3),
              CubeField.Date(1e9),  // only relevant later test
            ],
            requiredDifficulty: reducedDifficulty,
          });
          await manager2.cubeStore.addCube(pmuc);
          thirdHash = await pmuc.getHash();
          // expect still just one Cube stored, new version replaces old version
          expect(await manager2.cubeStore.getNumberOfStoredCubes()).toEqual(1);

          // sync PMUC from peer 2 to peer 1
          const expectPmucDelivery: Promise<CubeInfo> =
            manager1.cubeStore.expectCube(publicKey as CubeKey);
          manager1.outgoingPeers[0].sendKeyRequests();
          await expectPmucDelivery;

          // check MUC has been updated correctly at peer 1
          expect(await manager1.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          const rcvd: Cube = await manager1.cubeStore.getCube(publicKey as CubeKey);
          expect(rcvd).toBeInstanceOf(Cube);
          expect((await rcvd.getHash()).equals(thirdHash)).toBeTruthy();
          expect(rcvd.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value.
            readUintBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(3);
          expect(rcvd.getFirstField(CubeFieldType.PMUC_RAWCONTENT).valueString).
            toContain(thirdVersionContent);
        });

        it('will sync updates of same version number if lifetime is longer', async () => {
          // update PMUC at peer 1
          const pmuc = Cube.Create({
            cubeType: CubeType.PMUC,
            privateKey, publicKey,
            fields: [
              CubeField.RawContent(CubeType.PMUC, fourthVersionContent),
              CubeField.PmucUpdateCount(3),  // note version conflict
              CubeField.Date(1e12),  // note this one is newer
            ],
            requiredDifficulty: reducedDifficulty,
          });
          const expectPmucDelivery: Promise<CubeInfo> =
            manager2.cubeStore.expectCube(publicKey as CubeKey);
          await manager1.cubeStore.addCube(pmuc);
          fourthHash = await pmuc.getHash();
          // expect still just one Cube stored, new version replaces old version
          expect(await manager1.cubeStore.getNumberOfStoredCubes()).toEqual(1);

          // sync PMUC from peer 1 to peer 2
          manager2.incomingPeers[0].sendKeyRequests();
          await expectPmucDelivery;

          // check MUC has been updated correctly at peer 2
          expect(await manager2.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          const rcvd: Cube = await manager2.cubeStore.getCube(publicKey as CubeKey);
          expect(rcvd).toBeInstanceOf(Cube);
          expect((await rcvd.getHash()).equals(fourthHash)).toBeTruthy();
          expect(rcvd.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value.
            readUintBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(3);
          expect(rcvd.getFirstField(CubeFieldType.PMUC_RAWCONTENT).valueString).
            toContain(fourthVersionContent);
        });

        afterAll(async () => {
          // teardown
          const promise1_shutdown = manager1.shutdown();
          const promise2_shutdown = manager2.shutdown();
          await Promise.all([promise1_shutdown, promise2_shutdown]);
        });
      });  // syncs PMUC updates


      it.todo('will not request Cubes already in store');
      it.todo('will not send Cubes that have not been requested');
    });  // as a full node

    describe('as a light node', () => {
      describe('individual Cube retrieval', () => {
        it('exchanges Cubes on request', async () => {
          const node1 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3026]]),
            },
          );
          const node2 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3027]]),
            },
          );
          await Promise.all([node1.cubeStore.readyPromise, node2.cubeStore.readyPromise]);
          await Promise.all([node1.start(), node2.start()]);
          const cube = Cube.Frozen(
            { fields: CubeField.RawContent(CubeType.FROZEN, "Hic cubus per rogatum transferetur") })
          const key = await cube.getKey();
          await node1.cubeStore.addCube(cube);

          expect(await node1.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          expect(await node2.cubeStore.getNumberOfStoredCubes()).toEqual(0);

          const node2to1 = await node2.connect(new Peer("127.0.0.1:3026"));
          await node2to1.onlinePromise;

          // Request Cube
          await node2.scheduler.requestCube(key, { scheduleIn: 0 });
          const received: Cube = await node2.cubeStore.getCube(key);
          expect(received).toBeInstanceOf(Cube);
          expect((await received).getFirstField(CubeFieldType.FROZEN_RAWCONTENT).valueString).
            toContain("Hic cubus per rogatum transferetur");

          await Promise.all([node1.shutdown(), node2.shutdown()]);
        });

        it('does not exchange unrequested Cubes', async () => {
          const node1 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3031]]),
            },
          );
          const node2 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3032]]),
            },
          );
          await Promise.all([node1.cubeStore.readyPromise, node2.cubeStore.readyPromise]);
          await Promise.all([node1.start(), node2.start()]);
          const cube = Cube.Frozen(
            { fields: CubeField.RawContent(CubeType.FROZEN, "Hic cubus per rogatum transferetur") })
          const key = await cube.getKey();
          await node1.cubeStore.addCube(cube);

          expect(await node1.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          expect(await node2.cubeStore.getNumberOfStoredCubes()).toEqual(0);

          const node2to1 = await node2.connect(new Peer("127.0.0.1:3031"));
          await node2to1.onlinePromise;

          // wait a little...
          await new Promise(resolve => setTimeout(resolve, 3000));
          // light node: no request, no Cube
          expect(await node2.cubeStore.getNumberOfStoredCubes()).toEqual(0);

          await Promise.all([node1.shutdown(), node2.shutdown()]);
        });

        it('discards unrequested Cubes', async () => {
          // set up two nodes and connect them
          const node1 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3033]]),
            },
          );
          const node2 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3034]]),
            },
          );
          await Promise.all([node1.cubeStore.readyPromise, node2.cubeStore.readyPromise]);
          await Promise.all([node1.start(), node2.start()]);
          const node2to1 = await node2.connect(new Peer("127.0.0.1:3033"));
          await node2to1.onlinePromise;

          // node 2 sculpts a Cube nobody wants
          const cube = Cube.Create({
            cubeType: CubeType.FROZEN,
            fields: CubeField.RawContent(CubeType.FROZEN, "Nemo hunc Cubum vult"),
          });
          await node2.cubeStore.addCube(cube);
          expect(await node1.cubeStore.getNumberOfStoredCubes()).toEqual(0);
          expect(await node2.cubeStore.getNumberOfStoredCubes()).toEqual(1);

          // node 2 sends Cube to node 1, even though node 1 never requested it
          node2to1.sendMessage(new CubeResponseMessage([await cube.getBinaryData()]));

          // wait a little...
          await new Promise(resolve => setTimeout(resolve, 3000));

          // expect node 1 *not* to store the spurious Cube
          expect(await node1.cubeStore.getNumberOfStoredCubes()).toEqual(0);

          // shut down test nodes
          await Promise.all([node1.shutdown(), node2.shutdown()]);
        });
      });  // individual Cube retrieval

      describe('Cube subscriptions', () => {
        let server: NetworkManager, client: NetworkManager;
        let clientToServer: NetworkPeerIf;
        let mucKey: CubeKey, mucPrivateKey: Buffer;

        beforeAll(async () => {
          // Set up two nodes, a "server" and a "client".
          // The server needs to be a full node to accept subscriptions.
          server = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...fullNodeMinimalFeatures,  // full node (subscription provider)
              transports: new Map([[SupportedTransports.ws, 3025]]),
            }
          );
          client = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            lightNodeMinimalFeatures,  // light node (subscriber)
          );
          await Promise.all(
            [server.cubeStore.readyPromise, client.cubeStore.readyPromise]);
          await Promise.all([server.start(), client.start()]);
          // connect client to server
          const online: Promise<any> = Promise.all([
            new Promise((resolve) => client.on('peeronline', resolve)),
            new Promise((resolve) => server.on('peeronline', resolve)),
          ]);
          clientToServer = client.connect(new Peer(new WebSocketAddress("127.0.0.1", 3025)));
          await online;

          // Prepare a key pair for an updatable Cube, i.e. a MUC
          await sodium.ready;
          const keyPair = sodium.crypto_sign_keypair();
          mucKey = asCubeKey(Buffer.from(keyPair.publicKey));
          mucPrivateKey = Buffer.from(keyPair.privateKey);
          // Sculpt a MUC at the server
          const content = "Noli oblivisci ad amare et subscribere!";
          const cube = Cube.Create({
            cubeType: CubeType.MUC,
            privateKey: mucPrivateKey,
            publicKey: mucKey,
            fields: CubeField.RawContent(CubeType.MUC, content),
          });
          mucKey = await cube.getKey();
          await server.cubeStore.addCube(cube);
          expect(await server.cubeStore.getNumberOfStoredCubes()).toEqual(1);
          // Client retrieves the original MUC
          client.scheduler.requestCube(mucKey, { scheduleIn: 0 });
          await client.cubeStore.expectCube(mucKey);
          expect(await client.cubeStore.getNumberOfStoredCubes()).toEqual(1);
        });

        it('updates a subscribed Cube', async () => {
          // client subscribes Cube
          client.scheduler.subscribeCube(mucKey);
          const updated: Promise<CubeInfo> = client.cubeStore.expectCube(mucKey);

          // allow for subscription to be processed
          // TODO: once we have implemented replies, properly await the reply
          await new Promise(resolve => setTimeout(resolve, 1000));

          // server updates Cube
          const content =
            "Gratias tibi ago pro subscripto, noli oblivisci ad campanam pulsare!";
          const cube = Cube.Create({
            cubeType: CubeType.MUC,
            privateKey: mucPrivateKey,
            publicKey: mucKey,
            fields: CubeField.RawContent(CubeType.MUC, content),
          });
          await server.cubeStore.addCube(cube);

          // client automatically receives update
          await updated;
          const receivedUpdate: Cube = await client.cubeStore.getCube(mucKey);
          expect(receivedUpdate.getFirstField(CubeFieldType.MUC_RAWCONTENT).valueString).
            toContain(content);
        });
      });  // Cube subscriptions

      describe('notification retrieval', () => {
        it('should retrieve notifications from other nodes', async () => {
          // set up two nodes
          const node1 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3023]]),
            },
          );
          const node2 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            {
              ...lightNodeMinimalFeatures,
              transports: new Map([[SupportedTransports.ws, 3024]]),
            },
          );
          await Promise.all([node1.cubeStore.readyPromise, node2.cubeStore.readyPromise]);
          await Promise.all([node1.start(), node2.start()]);

          // sculpt a notification Cube at node1
          const notificationKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42) as NotificationKey;
          const latinSmartassery = "Cubi notificationes ad clavem notificationis referunt";
          const contentField = CubeField.RawContent(CubeType.FROZEN_NOTIFY, latinSmartassery);
          const notificationCube = Cube.Frozen({
            fields: [
              contentField,
              CubeField.Notify(notificationKey),
            ],
            requiredDifficulty: reducedDifficulty,
          });
          await node1.cubeStore.addCube(notificationCube);

          // connect node2 to node1
          const node2to1 = node2.connect(new Peer("127.0.0.1:3023"));
          await node2to1.onlinePromise;

          // node2 requests notifications from node1
          await node2.scheduler.requestNotifications(notificationKey);

          // verify notification has been received correctly
          const receivedNotifications: Cube[] = [];
          for await (const cube of node2.cubeStore.getNotifications(notificationKey)) {
            receivedNotifications.push(cube);
          }
          expect(receivedNotifications.length).toEqual(1);
          expect(await receivedNotifications[0].getKey()).toEqual(await notificationCube.getKey());
          expect(await receivedNotifications[0].fields.
            getFirst(CubeFieldType.FROZEN_NOTIFY_RAWCONTENT)).
              toEqual(contentField);

          // shut down
          await Promise.all([node1.shutdown(), node2.shutdown()]);
        });
      });  // notification retrieval
    });  // as a light node
  });  // cube exchange

  describe('peer exchange and auto-connect', () => {
    it('should exchange peers and auto-connect them', async () => {
      Settings.NODE_REQUEST_TIME = 1337; // Don't wait 10 seconds for the peer exchange
      const manager1 = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          transports: new Map([[SupportedTransports.ws, 7011]]),
          // select feature set for this test
          announceToTorrentTrackers: false,
          autoConnect: true,
          lightNode: false,
          peerExchange: true,
        });
      const manager2 = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          transports: new Map([[SupportedTransports.ws, 7012]]),
          // select feature set for this test
          announceToTorrentTrackers: false,
          autoConnect: true,
          lightNode: false,
          peerExchange: true,
        });
      const manager3 = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        new PeerDB(),
        {
          transports: new Map([[SupportedTransports.ws, 7013]]),
          // select feature set for this test
          announceToTorrentTrackers: false,
          autoConnect: true,
          lightNode: false,
          peerExchange: true,
        });
      await Promise.all([manager1.start(), manager2.start(), manager3.start()]);

      // connect node 1 to node 2
      const peer1 =
        manager1.connect(new Peer(new WebSocketAddress('localhost', 7012)));
      await Promise.all([
        peer1.onlinePromise,
        new Promise((resolve) => manager2.on('peeronline', resolve))
      ]);
      expect(peer1.online).toBeTruthy();
      expect(manager1.online).toBeTruthy();
      expect(manager2.online).toBeTruthy();
      expect(manager1.outgoingPeers[0]).toBe(peer1);
      expect(manager2.incomingPeers[0].idString).toEqual(manager1.idString);

      // connect node 2 to node 3
      const peer2 =
        manager2.connect(new Peer(new WebSocketAddress('localhost', 7013)));
      await Promise.all([
        peer2.onlinePromise,
        new Promise((resolve) => manager3.on('peeronline', resolve))
      ]);
      expect(peer2.online).toBeTruthy();
      expect(manager3.online).toBeTruthy();
      expect(manager2.outgoingPeers[0]).toBe(peer2);
      expect(manager3.incomingPeers[0].idString).toEqual(manager2.idString);

      // Automatically, peer exchanges will occur between nodes 2 and 3
      // as well as between nodes 1 and 2. We don't know what happens first.
      // In any case, node 1 and 3 will autoconnect -- we don't know who
      // will initiate the connection, though.
      await Promise.all([
        new Promise((resolve) => manager3.on('peeronline', resolve)),
        new Promise((resolve) => manager1.on('peeronline', resolve))
      ]);
      // expect node 1 to have some sort of connection to node 3
      expect([...manager1.outgoingPeers, ...manager1.incomingPeers].some(
        (peer) => peer.idString == manager3.idString)
      );
      // expect node 3 to have some sort of connection to node 1
      expect([...manager3.outgoingPeers, ...manager3.incomingPeers].some(
        (peer) => peer.idString == manager1.idString)
      );

      await Promise.all([
        manager1.shutdown(),
        manager2.shutdown(),
        manager3.shutdown()
      ]);
    }, 5000);

    // This test runs NetworkManager but actually tests a PeerDB feature
    it('should strongly prefer auto-connecting to peers with good reputation score while still giving low reputation ones a shot once in a while', async () => {
      const goodPeers: NetworkManager[] = [];
      const goodPeerIds: string[] = [];
      const badPeers: NetworkManager[] = [];
      const badPeerIds: string[] = [];
      const peerDB = new PeerDB({
        badPeerRehabilitationChance: 0.1,
      });
      const maximumConnections = 100;

      // create as many good peers as there are connection slots
      const peerStartPromises: Promise<void>[] = [];
      for (let i = 0; i < maximumConnections; i++) {
        const node = new NetworkManager(
          new CubeStore(testCubeStoreParams),
          new PeerDB(),
          {
            transports: new Map([[SupportedTransports.ws, 28000 + i]]),
            // select feature set for this test
            announceToTorrentTrackers: false,
            autoConnect: false,
            lightNode: false,
            peerExchange: false,
          }
        );
        goodPeers.push(node);
        goodPeerIds.push(node.idString);
        const peerObj = new Peer(new WebSocketAddress("127.0.0.1", 28000 + i));
        peerObj.trustScore = 1000;  // very good peer indeed
        peerDB.learnPeer(peerObj);
        peerStartPromises.push(node.start());
      }
      // create twice as many bad peers
      for (let i = 0; i < maximumConnections * 2; i++) {
        const node = new NetworkManager(
          new CubeStore(testCubeStoreParams),
          new PeerDB(),
          {
            transports: new Map([[SupportedTransports.ws, 29000 + i]]),
            // select feature set for this test
            announceToTorrentTrackers: false,
            autoConnect: false,
            lightNode: false,
            peerExchange: false,
          }
        );
        badPeers.push(node);
        badPeerIds.push(node.idString);
        const peerObj = new Peer(new WebSocketAddress("127.0.0.1", 29000 + i));
        peerObj.trustScore = -10000;  // very bad peer indeed
        peerDB.learnPeer(peerObj);
        peerStartPromises.push(node.start());
      }
      await Promise.all(peerStartPromises);

      const protagonist = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        peerDB,
        {
          transports: new Map([[SupportedTransports.ws, 7999]]),
          // select feature set for this test
          announceToTorrentTrackers: false,
          autoConnect: true,
          lightNode: false,
          peerExchange: false,
          newPeerInterval: 1,  // rush through auto-connections every single millisecond
          connectRetryInterval: 1,  // virtually no reconnect backoff
          reconnectInterval: 1, // virtually no reconnect limit
          maximumConnections: maximumConnections,
        }
      );
      await protagonist.start();
      // Wait up to 10 seconds for autoconnect to complete
      for (let i = 0; i < 100; i++) {
        // autoconnect is only complete once all peers have the "online"
        // flag, i.e. once their HELLO is received and thus their peer
        // ID is known
        let allonline: boolean = true;
        if (protagonist.outgoingPeers.length >= maximumConnections) {
          for (const peer of protagonist.outgoingPeers) {
            if (!peer.online) allonline = false;
          }
          if (allonline) break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(protagonist.outgoingPeers.length).toBeGreaterThanOrEqual(maximumConnections);

      // count number of good and bad peers selected
      let goodCount: number = 0, badCount: number = 0;
      for (let i = 0; i < maximumConnections; i++) {
        if (goodPeerIds.includes(protagonist.outgoingPeers[i].idString)) goodCount++;
        if (badPeerIds.includes(protagonist.outgoingPeers[i].idString)) badCount++;
      }
      expect(goodCount + badCount).toEqual(maximumConnections);  // I sure would hope so

      // expect protagonist to have selected at least 70% good peers
      expect(goodCount).toBeGreaterThanOrEqual(maximumConnections * 0.7);
      // expect protagonist to have given a chance to at least one bad peer
      expect(badCount).toBeGreaterThanOrEqual(1);

      // shut everything down
      const shutdownPromises: Promise<void>[] = [];
      shutdownPromises.push(protagonist.shutdown());
      for (const peer of [...goodPeers, ...badPeers]) {
        shutdownPromises.push(peer.shutdown());
      }
      await Promise.all(shutdownPromises);
    });

    it('should auto-connect low reputation peers when no others are available', async () => {
      const badPeers: NetworkManager[] = [];
      let badPeerIds: string[] = [];
      const peerDB = new PeerDB();
      const maximumConnections = 5;

      // create bad peers only
      const peerStartPromises: Promise<void>[] = [];
      for (let i = 0; i < maximumConnections; i++) {
        const node = new NetworkManager(
          new CubeStore(testCubeStoreParams),
          new PeerDB(),
          {
            transports: new Map([[SupportedTransports.ws, 10000 + i]]),
            // select feature set for this test
            announceToTorrentTrackers: false,
            autoConnect: false,
            lightNode: false,
            peerExchange: false,
          }
        );
        badPeers.push(node);
        badPeerIds.push(node.idString);
        const peerObj = new Peer(new WebSocketAddress("127.0.0.1", 10000 + i));
        peerObj.trustScore = -10000;  // very bad peer indeed
        peerDB.learnPeer(peerObj);
        peerStartPromises.push(node.start());
      }
      await Promise.all(peerStartPromises);

      const protagonist = new NetworkManager(
        new CubeStore(testCubeStoreParams),
        peerDB,
        {
          transports: new Map([[SupportedTransports.ws, 11000]]),
          // select feature set for this test
          announceToTorrentTrackers: false,
          autoConnect: true,
          lightNode: false,
          peerExchange: false,
          newPeerInterval: 1,  // rush through auto-connections every single millisecond
          connectRetryInterval: 1,  // virtually no reconnect backoff
          reconnectInterval: 1, // virtually no reconnect limit
          maximumConnections: maximumConnections,
        }
      );
      await protagonist.start();
      // Wait up to 10 seconds for autoconnect to complete
      for (let i = 0; i < 100; i++) {
        // autoconnect is only complete once all peers have the "online"
        // flag, i.e. once their HELLO is received and thus their peer
        // ID is known
        let allonline: boolean = true;
        if (protagonist.outgoingPeers.length >= maximumConnections) {
          for (const peer of protagonist.outgoingPeers) {
            if (!peer.online) allonline = false;
          }
          if (allonline) break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(protagonist.outgoingPeers.length).toBeGreaterThanOrEqual(maximumConnections);

      // just double check these are our peers
      for (let i = 0; i < maximumConnections; i++) {
        // remove each actual connection from the candidate list...
        badPeerIds = badPeerIds.filter(id => id != protagonist.outgoingPeers[i].idString);
      }
      expect(badPeerIds.length).toEqual(0);  // ... which should leave the list empty

      // shut everything down
      const shutdownPromises: Promise<void>[] = [];
      shutdownPromises.push(protagonist.shutdown());
      for (const peer of badPeers) {
        shutdownPromises.push(peer.shutdown());
      }
      await Promise.all(shutdownPromises);
    });
  });
});

async function createAndAddCubes(cubeStore: CubeStore, count: number): Promise<Cube[]> {
  const cubes: Cube[] = [];
  for (let i = 0; i < count; i++) {
    const cube = Cube.Frozen({
      fields: CubeField.RawContent(CubeType.FROZEN, `Test cube ${i}`),
      requiredDifficulty: 0
    });
    await cubeStore.addCube(cube);
    cubes.push(cube);
  }
  return cubes;
}

async function waitForCubeSync(cubeStore: CubeStore, expectedCount: number, timeout: number = 5000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await cubeStore.getNumberOfStoredCubes() >= expectedCount) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for cube sync. Expected ${expectedCount} cubes, got ${await cubeStore.getNumberOfStoredCubes()}`);
}
