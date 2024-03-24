import { Settings } from '../../../src/core/settings';

import { SupportedTransports } from '../../../src/core/networking/networkDefinitions';
import { NetworkManager, NetworkManagerOptions } from '../../../src/core/networking/networkManager';
import { NetworkPeer } from '../../../src/core/networking/networkPeer';
import { Libp2pConnection } from '../../../src/core/networking/transport/libp2p/libp2pConnection';
import { Libp2pTransport } from '../../../src/core/networking/transport/libp2p/libp2pTransport';
import { AddressAbstraction } from '../../../src/core/peering/addressing';

import { CubeKey } from '../../../src/core/cube/cubeDefinitions';
import { Cube, coreTlvCubeFamily } from '../../../src/core/cube/cube';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';
import { CubeField, CubeFieldType } from '../../../src/core/cube/cubeField';
import { CubeFields } from '../../../src/core/cube/cubeFields';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { Peer } from '../../../src/core/peering/peer';
import { PeerDB } from '../../../src/core/peering/peerDB';
import { logger } from '../../../src/core/logger';

import { multiaddr } from '@multiformats/multiaddr'
import sodium from 'libsodium-wrappers-sumo'

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

  const networkManagerOptionsDisabled: NetworkManagerOptions = {
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
    const clientToServer: NetworkPeer =
      client.connect(new Peer('/ip4/127.0.0.1/tcp/17102/ws'));

    // node still offline now as connect is obviously async
    expect(server.online).toBeFalsy();
    expect(client.online).toBeFalsy();
    expect(clientToServer.online).toBeFalsy();

    // anticipate incoming connection on server
    let serverToClient: NetworkPeer;
    const serverToClientPromise = new Promise<void>(
      (resolve) => server.once('incomingPeer', (np: NetworkPeer) => {
        serverToClient = np;
        resolve();
    }));

    // wait for connection to establish and HELLOs to be exchanged
    await clientToServer.onlinePromise;
    await serverToClientPromise;
    expect(serverToClient).toBeInstanceOf(NetworkPeer);
    await serverToClient.onlinePromise;

    // now they should be online!
    expect(clientToServer.online).toBeTruthy();
    expect(client.online).toBeTruthy();
    expect(server.online).toBeTruthy();
    expect(client.outgoingPeers.length).toEqual(1);
    expect(client.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
    expect(client.outgoingPeers[0]).toBe(clientToServer);
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
    receivedFields = cubeStore2.getCube(mucKey, coreTlvCubeFamily)?.fields!;
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
    receivedFields = cubeStore2.getCube(mucKey, coreTlvCubeFamily)?.fields!;
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


  // TODO: This test *sometimes* fails, probably because of the strange issues
  // we keep experiencing with libp2p streams, due to which connections are
  // sometimes prematurely closed:
  // Libp2pConnection to /ip4/127.0.0.1/tcp/17119/ws: Tried to send() data but stream is not open. This should not happen! Stream status is undefined. Closing connection.
  it.skip('should exchange peers and auto-connect them', async () => {
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
    // give it some more time -- TODO: this should actually not be needed, but
    // the test *sometimes* fails without it
    await new Promise(resolve => setTimeout(resolve, 1000));  // give it some time
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


  // This test currently FAILs either due to my fundamental misunderstanding
  // of libp2p, or because libp2p's WebRTC transport is just broken in NodeJS.
  // Raised https://github.com/libp2p/js-libp2p/issues/2425 to find out which
  // it is.
  it.skip('brokers WebRTC connections between clients and keeps them open even after the WS server offline', async() => {
    const networkManagerOptions: NetworkManagerOptions = {
      announceToTorrentTrackers: false,
      autoConnect: false,
      lightNode: false,
      peerExchange: false,
      useRelaying: true,
    }

    // Create two "browser" (= non listening) nodes and a "server" (= WS listening node)
    // All connections are initiated manually in this test, peer exchange is
    // disabled.
    const browser1 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      networkManagerOptions
    );
    const browser2 = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
      networkManagerOptions
    );
    const server = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      new Map([[SupportedTransports.libp2p, '/ip4/127.0.0.1/tcp/17290/ws']]),
      networkManagerOptions
    );
    await server.start();
    await browser1.start();
    await browser2.start();

    // assert we have libp2p transport
    expect(server.transports.size).toEqual(1);
    const serverlibp2pTransport: Libp2pTransport = server.transports.get(
      SupportedTransports.libp2p) as Libp2pTransport;
    expect(serverlibp2pTransport).toBeInstanceOf(Libp2pTransport);
    expect(browser1.transports.size).toEqual(1);
    const b1libp2pTransport: Libp2pTransport = browser1.transports.get(
      SupportedTransports.libp2p) as Libp2pTransport;
    expect(b1libp2pTransport).toBeInstanceOf(Libp2pTransport);
    expect(browser2.transports.size).toEqual(1);
    const b2libp2pTransport: Libp2pTransport = browser2.transports.get(
      SupportedTransports.libp2p) as Libp2pTransport;
    expect(b2libp2pTransport).toBeInstanceOf(Libp2pTransport);

    // assert there are no connections yet and auto-connect is off
    expect(server.outgoingPeers.length).toEqual(0);
    expect(browser1.outgoingPeers.length).toEqual(0);
    expect(browser2.outgoingPeers.length).toEqual(0);
    expect(server.incomingPeers.length).toEqual(0);
    expect(browser1.incomingPeers.length).toEqual(0);
    expect(browser2.incomingPeers.length).toEqual(0);
    expect(browser1.autoConnect).toBeFalsy();
    expect(browser2.autoConnect).toBeFalsy();

    // connect both browsers to the server;
    // double-check server also considers itself connected to both browsers
    const b1ToServerNp = browser1.connect(new Peer(multiaddr('/ip4/127.0.0.1/tcp/17290/ws')));
    expect(browser1.outgoingPeers.length).toEqual(1);
    await b1ToServerNp.onlinePromise;
    expect(server.incomingPeers.length).toEqual(1);
    const serverToB1Np = server.incomingPeers[0];
    await serverToB1Np.onlinePromise;
    expect(server.outgoingPeers.length).toEqual(0);
    expect(browser1.outgoingPeers.length).toEqual(1);
    expect(browser2.outgoingPeers.length).toEqual(0);
    expect(server.incomingPeers.length).toEqual(1);
    expect(browser1.incomingPeers.length).toEqual(0);
    expect(browser2.incomingPeers.length).toEqual(0);

    const b2ToServerNp = browser2.connect(new Peer(multiaddr('/ip4/127.0.0.1/tcp/17290/ws')));
    expect(browser2.outgoingPeers.length).toEqual(1);
    await b2ToServerNp.onlinePromise;
    expect(server.incomingPeers.length).toEqual(2);
    const serverToB2Np = server.incomingPeers[1];
    await serverToB2Np.onlinePromise;
    expect(server.outgoingPeers.length).toEqual(0);
    expect(browser1.outgoingPeers.length).toEqual(1);
    expect(browser2.outgoingPeers.length).toEqual(1);
    expect(server.incomingPeers.length).toEqual(2);
    expect(browser1.incomingPeers.length).toEqual(0);
    expect(browser2.incomingPeers.length).toEqual(0);

    // server conns should never be transient
    expect((b1ToServerNp.conn as Libp2pConnection).conn.transient).toBeFalsy();
    expect((b2ToServerNp.conn as Libp2pConnection).conn.transient).toBeFalsy();
    expect((serverToB1Np.conn as Libp2pConnection).conn.transient).toBeFalsy();
    expect((serverToB2Np.conn as Libp2pConnection).conn.transient).toBeFalsy();

    // double check that all are connected as expected by comparing their IDs
    // (Verity random IDs that is, not libp2p IDs)
    expect(b1ToServerNp.idString).toEqual(server.idString);
    expect(b2ToServerNp.idString).toEqual(server.idString);
    expect(serverToB1Np.idString).toEqual(browser1.idString);
    expect(serverToB2Np.idString).toEqual(browser2.idString);

    // thanks to the browser's libp2p circuitRelayServer, both browsers should
    // now have a dialable address via server, i.e. including the server's
    // libp2p ID
    await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
    b1libp2pTransport.addressChange();  // HACKHACK: poll for dialable address due to
    b2libp2pTransport.addressChange();  // lack of sensible event handler
    expect(b1libp2pTransport.dialableAddress).toBeInstanceOf(AddressAbstraction);
    expect(b2libp2pTransport.dialableAddress).toBeInstanceOf(AddressAbstraction);
    const serverLibp2pId = serverlibp2pTransport.node.peerId.toString();
    expect(b1libp2pTransport.dialableAddress.toString().includes(serverLibp2pId)).toBeTruthy();
    expect(b2libp2pTransport.dialableAddress.toString().includes(serverLibp2pId)).toBeTruthy();

    // connect browser1 to browser2
    const b1ToB2Np = browser1.connect(new Peer(b2libp2pTransport.dialableAddress));
    await b1ToB2Np.onlinePromise;

    // expect connected
    expect(server.outgoingPeers.length).toEqual(0);
    expect(browser1.outgoingPeers.length).toEqual(2);
    expect(browser2.outgoingPeers.length).toEqual(1);
    expect(server.incomingPeers.length).toEqual(2);
    expect(browser1.incomingPeers.length).toEqual(0);
    expect(browser2.incomingPeers.length).toEqual(1);

    // wait for HELLO exchange to have completed both ways
    const b2ToB1Np = browser2.incomingPeers[0];
    await b2ToB1Np.onlinePromise;

    // double check browser 1 and 2 are connected as expected by comparing their
    // IDs (Verity random IDs again, not libp2p IDs)
    expect(b1ToB2Np.idString).toEqual(browser2.idString);
    expect(b2ToB1Np.idString).toEqual(browser1.idString);

    // share a Cube between the browsers
    {  // browser1 to browser2
      const cubeSent: Cube = Cube.Frozen({
        fields: CubeField.Payload("Hic cubus directe ad collegam meum iturus est"),
        requiredDifficulty: reducedDifficulty  // no hashcash for faster testing
      });
      await browser1.cubeStore.addCube(cubeSent);
      // anticipate arrival of Cube at browser 2
      expect(browser2.cubeStore.getNumberOfStoredCubes()).toEqual(0);
      let cubeReceived: Cube = undefined;
      const cubeReceivedPromise = new Promise<void>(
        (resolve) => browser2.cubeStore.once('cubeAdded', (cubeInfo: CubeInfo) => {
          cubeReceived = cubeInfo.getCube(coreTlvCubeFamily);
          resolve();
      }));
      // Send the Cube --
      // hack: gratuitous cube shares not cleanly implemented yet, so let's
      // just pretent browser2 somehow learned about this cube and requests it
      b2ToB1Np.sendCubeRequest([await cubeSent.getKey()]);
      await cubeReceivedPromise;
      expect(browser2.cubeStore.getNumberOfStoredCubes()).toEqual(1);
      expect(cubeReceived).toBeInstanceOf(Cube);
      expect(cubeReceived.fields.getFirst(CubeFieldType.PAYLOAD).
        value.toString('utf8')).toEqual(
          "Hic cubus directe ad collegam meum iturus est");
    }

    // Shut down the server
    await b1ToServerNp.close();
    await b2ToServerNp.close();
    await serverToB1Np.close();
    await serverToB2Np.close();
    await server.shutdown();
    expect(serverlibp2pTransport.node.status).toEqual("stopped");
    await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
    expect(browser1.outgoingPeers.length).toEqual(1);
    expect(browser2.outgoingPeers.length).toEqual(0);
    expect(browser1.incomingPeers.length).toEqual(0);
    expect(browser2.incomingPeers.length).toEqual(1);
    expect(b1libp2pTransport.node.status).toEqual("started");
    expect(b2libp2pTransport.node.status).toEqual("started");
    expect((b1ToB2Np.conn as Libp2pConnection).conn.status).toEqual("open");
    expect((b2ToB1Np.conn as Libp2pConnection).conn.status).toEqual("open");
    expect((b1ToB2Np.conn as Libp2pConnection).rawStream.status).toEqual("open");
    expect((b2ToB1Np.conn as Libp2pConnection).rawStream.status).toEqual("open");

    // Now with the server guaranteed to no longer be present, share another Cube
    // between the browsers
    {  // browser2 to browser1
      const cubeSent: Cube = Cube.Frozen({
        fields: CubeField.Payload("Gratias collega, cubus tuus aestimatur."),
        requiredDifficulty: reducedDifficulty  // no hashcash for faster testing
      });
      await browser2.cubeStore.addCube(cubeSent);
      expect(browser1.cubeStore.getNumberOfStoredCubes()).toEqual(1);
      expect(browser2.cubeStore.getNumberOfStoredCubes()).toEqual(2);

      // anticipate arrival of Cube at browser 1
      let cubeReceived: Cube = undefined;
      const cubeReceivedPromise = new Promise<void>(
        (resolve) => browser1.cubeStore.on('cubeAdded', (cubeInfo: CubeInfo) => {
          cubeReceived = cubeInfo.getCube();
          resolve();
      }));
      // Send the Cube --
      // hack: gratuitous cube shares not cleanly implemented yet, so let's
      // just pretent browser1 somehow learned about this cube and requests it
      b1ToB2Np.sendCubeRequest([await cubeSent.getKey()]);

      // FAIL: this never happens
      await cubeReceivedPromise;
      // Instead, the WebRTC connection gets closed.
      // Even though using the debugger it absolutely looked like a genuine,
      // direct WebRTC connection using a genuine, native WebRTC stream

      expect(browser1.cubeStore.getNumberOfStoredCubes()).toEqual(2);
      expect(cubeReceived).toBeInstanceOf(Cube);
      expect(cubeReceived.fields.getFirst(CubeFieldType.PAYLOAD).
        value.toString('hex')).toEqual(
          "Gratias collega, cubus tuus aestimatur.");
    }

    await browser1.shutdown();
    await browser2.shutdown();
    await server.shutdown();
    expect(b1libp2pTransport.node.status).toEqual("stopped");
    expect(b2libp2pTransport.node.status).toEqual("stopped");
    expect(serverlibp2pTransport.node.status).toEqual("stopped");
  }, 300000);



  // TODO DEBUG
  // I really don't understand why this test fails, but understanding it
  // could be the key to undestanding libp2p
  it.skip('auto-connects WebRTC peers and keeps them connected even if the WS server goes down', async () => {
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

    // browser-to-browser connections should have been upgrade to non-transient,
    // i.e. a direct, non-tunnelled connection
    const libp2pConnAtBrowser1 =
      (browser1.incomingPeers[1].conn as Libp2pConnection).conn;
    const libp2pConnAtBrowser2 =
      (browser2.outgoingPeers[1].conn as Libp2pConnection).conn;
    expect(libp2pConnAtBrowser2.transient).toBeFalsy();
    expect(libp2pConnAtBrowser1.transient).toBeFalsy();

    // that's all the connections we want, disable auto-connect
    browser1.autoConnect = false;
    browser2.autoConnect = false;

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
    const cube: Cube = Cube.Frozen({
      fields: CubeField.Payload("Hic cubus directe ad collegam meum iturus est"),
      requiredDifficulty: reducedDifficulty  // no hashcash for faster testing
    });
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
