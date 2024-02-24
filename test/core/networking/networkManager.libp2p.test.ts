import { SupportedTransports } from '../../../src/core/networking/networkDefinitions';

import { NetworkManager, NetworkManagerOptions } from '../../../src/core/networking/networkManager';
import { NetworkPeer } from '../../../src/core/networking/networkPeer';

import { Cube } from '../../../src/core/cube/cube';
import { CubeField, CubeFieldType, CubeFields, coreFieldParsers, coreTlvFieldParsers } from '../../../src/core/cube/cubeFields';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { Peer } from '../../../src/core/peering/peer';
import { PeerDB } from '../../../src/core/peering/peerDB';
import { logger } from '../../../src/core/logger';

import { multiaddr } from '@multiformats/multiaddr'
import sodium from 'libsodium-wrappers-sumo'
import { CubeKey } from '../../../src/core/cube/cubeDefinitions';
import { Settings } from '../../../src/core/settings';

// Note: Most general functionality concerning NetworkManager, NetworkPeer
// etc is described within the WebSocket tests while the libp2p tests are more
// focused on asserting the libp2p framework integrates into Verity as expected.

describe('networkManager - libp2p connections', () => {
  const reducedDifficulty = 0;
  const testCubeStoreParams = {
    enableCubePersistance: false,
    enableCubeRetentionPolicy: false,
    requiredDifficulty: 0
  }

  const networkManagerOptionsDisabled = {
    announceToTorrentTrackers: false,
    autoConnect: false,
    lightNode: false,
    peerExchange: false,
  }

  it('should open connection', async() => {
    const server = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17101/ws']]),
        networkManagerOptionsDisabled);
    await server.start();
    const client = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/webrtc']]),
      {  // disable optional features
        announceToTorrentTrackers: false,
        autoConnect: false,
        lightNode: false,
        peerExchange: false,
    });
    await client.start();
    const np = client.connect(new Peer('/ip4/127.0.0.1/tcp/17101/ws'));
    await np.conn.readyPromise;
    expect(client.outgoingPeers.length).toEqual(1);
    expect(client.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
    expect(server.incomingPeers.length).toEqual(1);
    expect(server.incomingPeers[0]).toBeInstanceOf(NetworkPeer);

    await client.shutdown();
    await server.shutdown();
  }, 3000);


  it('should exchange HELLO messages and report online after connection', async() => {
    const server = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17102/ws']]),
        networkManagerOptionsDisabled);
    await server.start();
    const client = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/webrtc']]),
      {  // disable optional features
        announceToTorrentTrackers: false,
        autoConnect: false,
        lightNode: false,
        peerExchange: false,
    });
    await client.start();
    const peerObj = client.connect(new Peer('/ip4/127.0.0.1/tcp/17102/ws'));

    // node still offline now as connect is obviously async
    expect(server.online).toBeFalsy();
    expect(client.online).toBeFalsy();
    expect(peerObj.online).toBeFalsy();

    // wait for connection to establish and HELLOs to be exchanged
    await peerObj.onlinePromise;

    // now they should be online!
    expect(peerObj.online).toBeTruthy();
    expect(server.online).toBeTruthy();
    expect(client.online).toBeTruthy();
    expect(client.outgoingPeers.length).toEqual(1);
    expect(client.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
    expect(client.outgoingPeers[0]).toBe(peerObj);
    expect(server.incomingPeers.length).toEqual(1);
    expect(server.incomingPeers[0]).toBeInstanceOf(NetworkPeer);

    // ensured HELLO has correctly exchanged peer IDs
    expect(client.outgoingPeers[0].idString).toEqual(server.idString);
    expect(server.incomingPeers[0].idString).toEqual(client.idString);

    await client.shutdown();
    await server.shutdown();
  })


  it('works with IPv6', async () => {
    // create two nodes and connect them via IPv6 loopback (::1)
    const protagonist = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip6/::1/tcp/17103/ws']]),
      networkManagerOptionsDisabled);
    const ipv6peer = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip6/::1/tcp/17104/ws']]),
      networkManagerOptionsDisabled);
    await Promise.all([protagonist.start(), ipv6peer.start()]);
    const peerObj = protagonist.connect(
      new Peer(multiaddr("/ip6/::1/tcp/17104/ws"))
    );
    // node still offline now as connect is obviously async
    expect(protagonist.online).toBeFalsy();
    expect(peerObj.online).toBeFalsy();

    await peerObj.onlinePromise;  // now them should be online!
    expect(protagonist.online).toBeTruthy();
    expect(peerObj.online).toBeTruthy();

    // shutdown
    await Promise.all([protagonist.shutdown(), ipv6peer.shutdown()]);
  });


  it.skip("shares it's own dialable address upon connection", async () => {
    // This test currently FAILS because our libp2p transport does not recognize
    // statically configured addresses as potentially dialable.
    // TODO fix
    const client = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip6/::1/tcp/17105/ws']]),
      networkManagerOptionsDisabled);
    const server = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip6/::1/tcp/17106/ws']]),
      networkManagerOptionsDisabled);
    await Promise.all([client.start(), server.start()]);
    const peerObj = client.connect(
      new Peer(multiaddr("/ip6/::1/tcp/17106/ws"))
    );
    await peerObj.onlinePromise;

    // Wait for client to share it's dialable address with server
    await new Promise<void>(resolve => server.on('updatepeer', resolve));
    expect(server.incomingPeers[0].address).toEqual(multiaddr('/ip6/::1/tcp/17105/ws'));

    // shutdown
    await Promise.all([client.shutdown(), server.shutdown()]);
  });


  it('syncs cubes between three nodes', async () => {
    const numberOfCubes = 10;
    const cubeStore = new CubeStore(testCubeStoreParams);
    const cubeStore2 = new CubeStore(testCubeStoreParams);
    const cubeStore3 = new CubeStore(testCubeStoreParams);
    const manager1 = new NetworkManager(
      cubeStore, new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17111/ws']]),
      networkManagerOptionsDisabled);
    const manager2 = new NetworkManager(
      cubeStore2, new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17112/ws']]),
      networkManagerOptionsDisabled);
    const manager3 = new NetworkManager(
      cubeStore3, new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17113/ws']]),
      networkManagerOptionsDisabled);

    // Start all three nodes
    const promise1_listening = manager1.start();
    const promise2_listening = manager2.start();
    const promise3_listening = manager3.start();
    await Promise.all([promise1_listening, promise2_listening, promise3_listening]);

    // Connect peer 2 to both peer 1 and peer 3
    manager2.connect(new Peer(multiaddr('/ip4/127.0.0.1/tcp/17111/ws')));
    manager2.connect(new Peer(multiaddr('/ip4/127.0.0.1/tcp/17113/ws')));
    expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
    expect(manager2.outgoingPeers[1]).toBeInstanceOf(NetworkPeer);

    await manager2.outgoingPeers[0].onlinePromise
    await manager2.outgoingPeers[1].onlinePromise

    // Create new cubes at peer 1
    for (let i = 0; i < numberOfCubes; i++) {
      const cube = Cube.Frozen({requiredDifficulty: reducedDifficulty});
      const buffer: Buffer = Buffer.alloc(1);
      buffer.writeInt8(i);
      await cubeStore.addCube(cube);
    }
    expect(cubeStore.getAllKeys().size).toEqual(numberOfCubes);

    // sync cubes from peer 1 to peer 2
    expect(manager1.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
    manager2.outgoingPeers[0].sendKeyRequest();
    // Verify cubes have been synced. Wait up to three seconds for that to happen.
    for (let i = 0; i < 30; i++) {
      if (cubeStore2.getAllKeys().size == numberOfCubes) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const hash of cubeStore.getAllKeys()) {
      expect(cubeStore2.getCube(hash)).toBeInstanceOf(Cube);
    }

    // sync cubes from peer 2 to peer 3
    expect(manager3.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
    manager3.incomingPeers[0].sendKeyRequest();
    // Verify cubes have been synced. Wait up to three seconds for that to happen.
    for (let i = 0; i < 30; i++) {
      if (cubeStore3.getAllKeys().size == numberOfCubes) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const hash of cubeStore2.getAllKeys()) {
      expect(cubeStore3.getCube(hash)).toBeInstanceOf(Cube);
    }

    // shutdown
    const promise1_shutdown = manager1.shutdown();
    const promise2_shutdown = manager2.shutdown();
    const promise3_shutdown = manager3.shutdown();
    await Promise.all([promise1_shutdown, promise2_shutdown, promise3_shutdown]);
  }, 10000);


  it('syncs MUC updates', async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();

    const cubeStore = new CubeStore(testCubeStoreParams);
    const cubeStore2 = new CubeStore(testCubeStoreParams);
    const manager1 = new NetworkManager(
        cubeStore, new PeerDB(),
        new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17114/ws']]),
        networkManagerOptionsDisabled);
    const manager2 = new NetworkManager(
        cubeStore2, new PeerDB(),
        new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17115/ws']]),
        networkManagerOptionsDisabled);

    // Start both nodes
    const promise1_listening = manager1.start();
    const promise2_listening = manager2.start();
    await Promise.all([promise1_listening, promise2_listening]);

    // Connect peer 1 to peer 2
    manager1.connect(new Peer(multiaddr('/ip4/127.0.0.1/tcp/17115/ws')));
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
      { fields: CubeField.Payload(counterBuffer), requiredDifficulty: reducedDifficulty}
    );
    mucKey = (await cubeStore.addCube(muc)).getKeyIfAvailable();
    const firstMucHash = await muc.getHash();
    expect(cubeStore.getAllKeys().size).toEqual(1);

    // sync MUC from peer 1 to peer 2
    expect(manager2.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
    manager2.incomingPeers[0].sendKeyRequest();
    // Verify MUC has been synced. Wait up to three seconds for that to happen.
    for (let i = 0; i < 30; i++) {
      if (cubeStore2.getCube(mucKey)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // check MUC has been received correctly at peer 2
    expect(cubeStore2.getAllKeys().size).toEqual(1);
    expect(cubeStore2.getCube(mucKey)).toBeInstanceOf(Cube);
    expect((await cubeStore2.getCube(mucKey)?.getHash())!.equals(
      firstMucHash)).toBeTruthy();
    receivedFields = cubeStore2.getCube(mucKey, coreTlvFieldParsers)?.fields!;
    expect(receivedFields?.getFirst(CubeFieldType.PAYLOAD).value.toString()).toEqual(
      "Prima versio cubi usoris mutabilis mei.");

    // update MUC at peer 1
    await new Promise(resolve => setTimeout(resolve, 1000));  // wait one second as we don't have better time resolution
    counterBuffer = Buffer.from("Secunda versio cubi usoris mutabilis mei.");
    muc = Cube.MUC(
      Buffer.from(keyPair.publicKey),
      Buffer.from(keyPair.privateKey),
      {fields: CubeField.Payload(counterBuffer), requiredDifficulty: reducedDifficulty});
    mucKey = (await cubeStore.addCube(muc)).getKeyIfAvailable();
    const secondMucHash = await muc.getHash();
    expect(cubeStore.getAllKeys().size).toEqual(1);  // still just one, new MUC version replaces old MUC version

    // sync MUC from peer 1 to peer 2, again
    manager2.incomingPeers[0].sendKeyRequest();
    // Verify MUC has been synced. Wait up to three seconds for that to happen.
    for (let i = 0; i < 30; i++) {
      if (cubeStore2.getCube(mucKey)?.getHashIfAvailable()?.equals(secondMucHash)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // check MUC has been updated correctly at peer 2
    expect(cubeStore2.getAllKeys().size).toEqual(1);
    expect(cubeStore2.getCube(mucKey)).toBeInstanceOf(Cube);
    expect((await cubeStore2.getCube(mucKey)?.getHash())!.equals(secondMucHash)).toBeTruthy();
    receivedFields = cubeStore2.getCube(mucKey, coreTlvFieldParsers)?.fields!;
    expect(receivedFields?.getFirst(CubeFieldType.PAYLOAD).value.toString()).toEqual(
      "Secunda versio cubi usoris mutabilis mei.");

    // teardown
    const promise1_shutdown = manager1.shutdown();
    const promise2_shutdown = manager2.shutdown();
    await Promise.all([promise1_shutdown, promise2_shutdown]);
  }, 10000);


  it('should block a peer when trying to connect to itself', async () => {
    const peerDB = new PeerDB();
    const manager = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      peerDB,
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17116/ws']]),
      networkManagerOptionsDisabled);
    await manager.start();

    expect(peerDB.peersBlocked.size).toEqual(0);

    // Trigger a connection to itself
    manager.connect(new Peer(multiaddr('/ip4/127.0.0.1/tcp/17116/ws')));

    // Wait for the 'blocklist' event to be triggered
    await new Promise<void>((resolve, reject) => {
      manager.on('blocklist', (bannedPeer: Peer) => {
        resolve();
      })
    });
    expect(peerDB.peersBlocked.size).toEqual(1);

    manager.shutdown();
  }, 3000);


  it('should exchange peers and auto-connect them', async () => {
    Settings.NODE_REQUEST_TIME = 1337; // Don't wait 10 seconds for the peer exchange
    const manager1 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17117/ws']]),
      {  // select feature set for this test
        announceToTorrentTrackers: false,
        autoConnect: true,
        lightNode: false,
        peerExchange: true,
      });
    const manager2 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17118/ws']]),
      {  // select feature set for this test
        announceToTorrentTrackers: false,
        autoConnect: true,
        lightNode: false,
        peerExchange: true,
      });
    const manager3 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17119/ws']]),
      {  // select feature set for this test
        announceToTorrentTrackers: false,
        autoConnect: true,
        lightNode: false,
        peerExchange: true,
      });
    await Promise.all([manager1.start(), manager2.start(), manager3.start()]);

    // connect node 1 to node 2
    const peer1 =
      manager1.connect(new Peer(multiaddr('/ip4/127.0.0.1/tcp/17118/ws')));
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
      manager2.connect(new Peer('/ip4/127.0.0.1/tcp/17119/ws'));
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
  }, 20000);


  it.skip('brokers direct WebRTC connections between clients', async() => {
    // TODO IMPLEMENT
  });

  // TODO DEBUG
  // I really don't understand why this test fails, but understanding it
  // could be the key to undestanding libp2p
  it.skip('keeps WebRTC peers connected even if the WS server goes down', async () => {
    // create two "browser" (= non listening) nodes and a "server" (= WS listening node)
    const serverOptions: NetworkManagerOptions = {
      announceToTorrentTrackers: false,
      autoConnect: true,
      lightNode: false,
      peerExchange: true,
      useRelaying: false,
    };
    const browserOptions: NetworkManagerOptions = {
      announceToTorrentTrackers: false,
      autoConnect: true,
      lightNode: false,
      peerExchange: true,
      useRelaying: true,
    };
    const browser1 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      browserOptions
    );
    const browser2 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      browserOptions
    );
    const server = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17294/ws']]),
      serverOptions
    );
    await server.start();

    // browsers learn the server as bootstrap node
    browser1.peerDB.learnPeer(new Peer('/ip4/127.0.0.1/tcp/17294/ws/'));
    browser2.peerDB.learnPeer(new Peer('/ip4/127.0.0.1/tcp/17294/ws/'));

    // start both browsers sequentially
    // and wait till they're both connected to the server
    await browser1.start();
    expect(browser1.outgoingPeers.length).toEqual(1);
    const browser1ServerNp = browser1.outgoingPeers[0];
    await browser1ServerNp.onlinePromise;

    await browser2.start();
    expect(browser2.outgoingPeers.length).toEqual(1);
    const browser2ServerNp = browser2.outgoingPeers[0];
    await browser2ServerNp.onlinePromise;

    // As we started browser 2 after the server already knew browser1,
    // server will send the first browser's details to browser 2 during
    // initial node exchange.
    // Wait up to 10 seconds for NodeExchange to happen
    for (let i = 0; i < 100; i++) {
      if (browser2.outgoingPeers.length >= 2) {
          break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(browser2.outgoingPeers.length).toEqual(2);

    // wait for browser 2 to have fully connected to browser 1
    await browser2.outgoingPeers[1].onlinePromise;
    // also wait for browser 1 to consider itself fully connected to browser2
    expect(browser1.incomingPeers.length).toEqual(1);
    await browser1.incomingPeers[0].onlinePromise;

    browser1.autoConnect = false;
    browser2.autoConnect = false;

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Shut down server
    const browser1Closed = new Promise(resolve => browser1.on("peerclosed", resolve));
    const browser2Closed = new Promise(resolve => browser2.on("peerclosed", resolve));
    await server.shutdown();
    logger.trace("SERVER CLOSED")
    await browser1Closed;
    logger.trace("BROWSER1CLOSED")
    await browser2Closed;
    logger.trace("BROWSER2CLOSED")

    // Verify both browsers lost their server connection but are still
    // connected to each other.
    expect(browser1.outgoingPeers.length).toEqual(0);  // initial server conn lost
    expect(browser1.incomingPeers.length).toEqual(1);  // browser-to-browser conn is incoming at browser1
    expect(browser2.outgoingPeers.length).toEqual(1);  // browser-to-browser conn is outgoing at browser2
    expect(browser2.incomingPeers.length).toEqual(0);  // never had one

    logger.trace("TEST: Remaining outgoing connection on browser2: " + browser2.outgoingPeers[0].toLongString());
    logger.trace("TEST: Remaining incoming connection on browser1: " + browser1.incomingPeers[0].toLongString());

    // Create a Cube and exchange it between browsers
    expect(browser1.cubeStore.getNumberOfStoredCubes()).toEqual(0);
    expect(browser2.cubeStore.getNumberOfStoredCubes()).toEqual(0);
    const cube: Cube = Cube.Frozen({requiredDifficulty: reducedDifficulty});  // no hashcash for faster testing
    cube.setFields(CubeField.Payload("Hic cubus directe ad collegam meum iturus est"));
    const cubeKey: Buffer = await cube.getKey();
    browser1.cubeStore.addCube(cube);

    // Expedite cube exchange for faster testing
    // TODO: This currently fails:     sendMessagBinary() called on destroyed channel
    // This is exactly what we did not want to see.
    // And strangely enough, it actually works in real world browser tests o.O
    logger.trace("TEST: Performing Cube exchange")
    browser2.outgoingPeers[0].sendKeyRequest();
    // Wait up to three seconds for cube to sync
    for (let i = 0; i < 30; i++) {
      if (browser2.cubeStore.getNumberOfStoredCubes() == 1) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const recovered: Cube = browser2.cubeStore.getCube(cubeKey);
    expect(recovered).toBeInstanceOf(Cube);
    expect(recovered.fields.getFirst(CubeFieldType.PAYLOAD).value).
      toEqual("Hic cubus directe ad collegam meum iturus est");

    await browser1.shutdown();
    await browser2.shutdown();
  }, 100000);

  it.skip('should fail gracefully when trying to connect to an invalid address', async () => {
    // TODO implement
  });

    // TODO write more tests
});
