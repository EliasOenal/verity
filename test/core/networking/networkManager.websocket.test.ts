import { SupportedTransports } from '../../../src/core/networking/networkDefinitions';

import { NetworkManager } from '../../../src/core/networking/networkManager';
import { NetworkPeer } from '../../../src/core/networking/networkPeer';
import { WebSocketTransport } from '../../../src/core/networking/transport/webSocket/webSocketTransport';
import { WebSocketServer } from '../../../src/core/networking/transport/webSocket/webSocketServer';
import { WebSocketConnection } from '../../../src/core/networking/transport/webSocket/webSocketConnection';

import { CubeKey } from '../../../src/core/cube/cubeDefinitions';
import { Cube } from '../../../src/core/cube/cube';
import { CubeField, CubeFieldType, CubeFields, coreTlvFieldParsers } from '../../../src/core/cube/cubeFields';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { WebSocketAddress } from '../../../src/core/peering/addressing';
import { Peer } from '../../../src/core/peering/peer';
import { PeerDB } from '../../../src/core/peering/peerDB';
import { logger } from '../../../src/core/logger';

import WebSocket from 'isomorphic-ws';
import sodium from 'libsodium-wrappers-sumo'
import { Settings } from '../../../src/core/settings';

// Note: Most general functionality concerning NetworkManager, NetworkPeer
// etc is described within the WebSocket tests while the libp2p tests are more
// focused on asserting the libp2p framework integrates into Verity as expected.

describe('networkManager - WebSocket connections', () => {
    const reducedDifficulty = 0;
    const testCubeStoreParams = {
        enableCubePersistance: false,
        enableCubeRetentionPolicy: false,
        requiredDifficulty: 0
    }

    it('creates and cleanly shuts down a WebSocket server', async() => {
        const manager: NetworkManager = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 3000]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        expect(manager.transports.size).toEqual(1);
        expect(manager.transports.get(SupportedTransports.ws)).
            toBeInstanceOf(WebSocketTransport);
        await manager.start();
        expect(manager.transports.get(SupportedTransports.ws).servers[0]).
            toBeInstanceOf(WebSocketServer);
        await manager.shutdown();
    }, 3000);

    it('should create a NetworkPeer on incoming connection', done => {
        const manager = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 3001]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        manager.start();
        // @ts-ignore Checking private attributes
        (manager.transports.get(SupportedTransports.ws).servers[0] as WebSocketServer).server.on('connection', () => {
            expect(manager?.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        });

        const client = new WebSocket('ws://localhost:3001');
        client.on('open', () => {
            client.close();
            manager.shutdown();
            done();
        });
    }, 3000);

    it('should create a NetworkPeer on outgoing connection', async () => {
        const manager = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 3003]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
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
            new Map([[SupportedTransports.ws, 4000]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        const client1 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            undefined,  // no listeners
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        const client2 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            undefined,  // no listeners
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
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
            new Map([[SupportedTransports.ws, 4010]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        const manager2 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 4011]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });

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
            new Map([[SupportedTransports.ws, 3010]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        const ipv6peer = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 3011]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        await Promise.all([protagonist.start(), ipv6peer.start()]);
        const peerObj = protagonist.connect(
            new Peer(new WebSocketAddress("[::1]", 3011))
        );
        // node still offline now as connect is obviously async
        expect(protagonist.online).toBeFalsy();
        expect(peerObj.online).toBeFalsy();

        await peerObj.onlinePromise;  // now them should be online!
        expect(protagonist.online).toBeTruthy();
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


    it('syncs cubes between three nodes', async () => {
        const numberOfCubes = 10;
        const cubeStore = new CubeStore(testCubeStoreParams);
        const cubeStore2 = new CubeStore(testCubeStoreParams);
        const cubeStore3 = new CubeStore(testCubeStoreParams);
        const manager1 = new NetworkManager(
            cubeStore, new PeerDB(),
            new Map([[SupportedTransports.ws, 4020]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        const manager2 = new NetworkManager(
            cubeStore2, new PeerDB(),
            new Map([[SupportedTransports.ws, 4021]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        const manager3 = new NetworkManager(
            cubeStore3, new PeerDB(),
            new Map([[SupportedTransports.ws, 4022]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });

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
            new Map([[SupportedTransports.ws, 5002]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        const manager2 = new NetworkManager(
            cubeStore2, new PeerDB(),
            new Map([[SupportedTransports.ws, 5001]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });

        // Start both nodes
        const promise1_listening = manager1.start();
        const promise2_listening = manager2.start();
        await Promise.all([promise1_listening, promise2_listening]);

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
        expect((await cubeStore2.getCube(mucKey)?.getHash())!.equals(firstMucHash)).toBeTruthy();
        receivedFields = cubeStore2.getCube(mucKey, coreTlvFieldParsers)?.fields!;
        expect(receivedFields?.getFirst(CubeFieldType.PAYLOAD).value.toString()).toEqual("Prima versio cubi usoris mutabilis mei.");

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
        expect(receivedFields?.getFirst(CubeFieldType.PAYLOAD).value.toString()).toEqual("Secunda versio cubi usoris mutabilis mei.");

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
            new Map([[SupportedTransports.ws, 6004]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
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
            undefined,  // no listener
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        myManager.start();

        const otherPeerDB = new PeerDB();
        const otherManager = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            otherPeerDB,
            new Map([[SupportedTransports.ws, 7005]]),
            {  // disable optional features
                announceToTorrentTrackers: false,
                autoConnect: false,
                lightNode: false,
                peerExchange: false,
            });
        await otherManager.start();

        // connect to peer and wait till connected
        // (= wait for the peeronline signal, which is emitted after the
        //    hello exchange is completed)
        const iHaveConnected = new Promise((resolve) => myManager.on('peeronline', resolve));
        const otherHasConnected = new Promise((resolve) => otherManager.on('peeronline', resolve));
        const bothHaveConnected = Promise.all([iHaveConnected, otherHasConnected]);
        const myFirstNp: NetworkPeer =
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
        const othersFirstNp: NetworkPeer = otherManager.incomingPeers[0];
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
            otherManager.on('peerclosed',  resolve));
        const myDuplicateNp: NetworkPeer =
            myManager.connect(new Peer(new WebSocketAddress('127.0.0.1', 7005)));
        let othersDuplicateNp;
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
        expect((othersDuplicateNp.conn as WebSocketConnection).
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
        expect((othersDuplicateNp.conn as WebSocketConnection).
            ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
    }, 500000);

    it('should exchange peers and auto-connect them', async () => {
        Settings.NODE_REQUEST_TIME = 1337; // Don't wait 10 seconds for the peer exchange
        const manager1 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 7011]]),
            {  // select feature set for this test
                announceToTorrentTrackers: false,
                autoConnect: true,
                lightNode: false,
                peerExchange: true,
            });
        const manager2 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 7012]]),
            {  // select feature set for this test
                announceToTorrentTrackers: false,
                autoConnect: true,
                lightNode: false,
                peerExchange: true,
            });
        const manager3 = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            new PeerDB(),
            new Map([[SupportedTransports.ws, 7013]]),
            {  // select feature set for this test
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
    }, 20000);

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
                new Map([[SupportedTransports.ws, 28000+i]]),
                {  // select feature set for this test
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                }
            );
            goodPeers.push(node);
            goodPeerIds.push(node.idString);
            const peerObj = new Peer(new WebSocketAddress("127.0.0.1", 28000+i));
            peerObj.trustScore = 1000;  // very good peer indeed
            peerDB.learnPeer(peerObj);
            peerStartPromises.push(node.start());
        }
        // create twice as many bad peers
        for (let i = 0; i < maximumConnections * 2; i++) {
            const node = new NetworkManager(
                new CubeStore(testCubeStoreParams),
                new PeerDB(),
                new Map([[SupportedTransports.ws, 29000+i]]),
                {  // select feature set for this test
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                }
            );
            badPeers.push(node);
            badPeerIds.push(node.idString);
            const peerObj = new Peer(new WebSocketAddress("127.0.0.1", 29000+i));
            peerObj.trustScore = -10000;  // very bad peer indeed
            peerDB.learnPeer(peerObj);
            peerStartPromises.push(node.start());
        }
        await Promise.all(peerStartPromises);

        const protagonist = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            peerDB,
            new Map([[SupportedTransports.ws, 7999]]),
            {  // select feature set for this test
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
                new Map([[SupportedTransports.ws, 10000+i]]),
                {  // select feature set for this test
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                }
            );
            badPeers.push(node);
            badPeerIds.push(node.idString);
            const peerObj = new Peer(new WebSocketAddress("127.0.0.1", 10000+i));
            peerObj.trustScore = -10000;  // very bad peer indeed
            peerDB.learnPeer(peerObj);
            peerStartPromises.push(node.start());
        }
        await Promise.all(peerStartPromises);

        const protagonist = new NetworkManager(
            new CubeStore(testCubeStoreParams),
            peerDB,
            new Map([[SupportedTransports.ws, 11000]]),
            {  // select feature set for this test
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

    it.skip('should fail gracefully when trying to connect to an invalid address', async () => {
        // TODO implement
    });

    it.skip('only accepts incoming connections when enabled', async() => {
        // TODO implement
    })
});
