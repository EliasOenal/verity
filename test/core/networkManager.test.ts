import { SupportedTransports } from '../../src/core/networkDefinitions';

import { NetworkManager } from '../../src/core/networkManager';
import { NetworkPeer } from '../../src/core/networkPeer';
import { WebSocketPeerConnection } from '../../src/core/networkPeerConnection';
import { CubeStore } from '../../src/core/cubeStore';
import { Cube, CubeKey } from '../../src/core/cube';
import { CubeField, CubeFieldType, CubeFields, cubeFieldDefinition } from '../../src/core/cubeFields';
import { PeerDB, Peer, WebSocketAddress } from '../../src/core/peerDB';
import { logger } from '../../src/core/logger';

import WebSocket from 'isomorphic-ws';
import sodium, { KeyPair } from 'libsodium-wrappers'

describe('networkManager', () => {
    describe('WebSockets and general functionality', () => {
        it('should create a WebSocket server on instantiation', () => {
            const manager = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                new PeerDB(),
                new Map([[SupportedTransports.ws, 3000]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            manager.start();
            // @ts-ignore Checking private attributes
            expect(manager.servers[0].server).toBeInstanceOf(WebSocket.Server);
            manager.shutdown();
        }, 3000);

        it('should create a NetworkPeer on incoming connection', done => {
            const manager = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
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
            manager.servers[0].server.on('connection', () => {
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
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                new PeerDB(),
                new Map([[SupportedTransports.ws, 3003]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            const listeningPromise = new Promise((resolve) => manager.on('listening', resolve));
            manager.start();
            await listeningPromise;

            const server = new WebSocket.Server({ port: 3002 });

            // Wait for server2 to start listening
            await new Promise((resolve) => server?.on('listening', resolve));

            await manager.connect(new Peer(new WebSocketAddress('localhost', 3002)));

            expect(manager.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
            server.close();
            manager.shutdown();
        }, 3000);

        it('correctly opens and closes multiple connections', async () => {
            // create a server and two clients
            const listener = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                new PeerDB(),
                new Map([[SupportedTransports.ws, 4000]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            const client1 = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                new PeerDB(),
                undefined,  // no listeners
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            const client2 = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                new PeerDB(),
                undefined,  // no listeners
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            // wait for server to be listening
            const listenerPromise = new Promise((resolve) => listener.on('listening', resolve));
                listener.start();
            await listenerPromise;

            // connect clients to server
            client1.connect(new Peer(new WebSocketAddress("127.0.0.1", 4000)));
            client2.connect(new Peer(new WebSocketAddress("127.0.0.1", 4000)));
            // make sure all are well connected
            expect(client1.outgoingPeers.length).toEqual(1);
            expect(client2.outgoingPeers.length).toEqual(1);
            await client1.outgoingPeers[0].onlinePromise;
            await client2.outgoingPeers[0].onlinePromise;
            expect(listener.incomingPeers.length).toEqual(2);
            await listener.incomingPeers[0].onlinePromise;
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
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                new PeerDB(),
                new Map([[SupportedTransports.ws, 4000]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            const manager2 = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                new PeerDB(),
                new Map([[SupportedTransports.ws, 4001]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });

            const promise1_listening = new Promise<void>(resolve => manager1.on('listening', resolve));
            const promise2_listening = new Promise<void>(resolve => manager2.on('listening', resolve));
            const promise1_shutdown = new Promise<void>(resolve => manager1.on('shutdown', resolve));
            const promise2_shutdown = new Promise<void>(resolve => manager2.on('shutdown', resolve));

            manager1.start();
            manager2.start();
            await promise1_listening;
            await promise2_listening;

            manager2.connect(new Peer(new WebSocketAddress("localhost", 4000)));
            expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
            await manager2.outgoingPeers[0].onlinePromise
            await manager1.incomingPeers[0].onlinePromise;
            expect(manager1.online).toBeTruthy();
            expect(manager2.online).toBeTruthy();
            expect(manager1.incomingPeers[0]).toBeInstanceOf(NetworkPeer);

            manager1.shutdown();
            manager2.shutdown();
            await Promise.all([promise1_shutdown, promise2_shutdown]);
        });

        it('sync cubes between three nodes', async () => {
            const reduced_difficulty = 0;
            const numberOfCubes = 10;
            const cubeStore = new CubeStore(
                {enableCubePersistance: false, requiredDifficulty: 0});
            const cubeStore2 = new CubeStore(
                {enableCubePersistance: false, requiredDifficulty: 0});
            const cubeStore3 = new CubeStore(
                {enableCubePersistance: false, requiredDifficulty: 0});
            const manager1 = new NetworkManager(
                cubeStore, new PeerDB(),
                new Map([[SupportedTransports.ws, 4000]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            const manager2 = new NetworkManager(
                cubeStore2, new PeerDB(),
                new Map([[SupportedTransports.ws, 4001]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            const manager3 = new NetworkManager(
                cubeStore3, new PeerDB(),
                new Map([[SupportedTransports.ws, 4002]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });

            const promise1_listening = new Promise<void>(resolve => manager1.on('listening', resolve));
            const promise2_listening = new Promise<void>(resolve => manager2.on('listening', resolve));
            const promise3_listening = new Promise<void>(resolve => manager3.on('listening', resolve));
            const promise1_shutdown = new Promise<void>(resolve => manager1.on('shutdown', resolve));
            const promise2_shutdown = new Promise<void>(resolve => manager2.on('shutdown', resolve));
            const promise3_shutdown = new Promise<void>(resolve => manager3.on('shutdown', resolve));

            // Start all three nodes
            manager1.start();
            manager2.start();
            manager3.start();
            await Promise.all([promise1_listening, promise2_listening, promise3_listening]);

            // Connect peer 2 to both peer 1 and peer 3
            manager2.connect(new Peer(new WebSocketAddress("localhost", 4000)));
            manager2.connect(new Peer(new WebSocketAddress('localhost', 4002)));
            expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
            expect(manager2.outgoingPeers[1]).toBeInstanceOf(NetworkPeer);

            await manager2.outgoingPeers[0].onlinePromise
            await manager2.outgoingPeers[1].onlinePromise

            // Create new cubes at peer 1
            for (let i = 0; i < numberOfCubes; i++) {
                const cube = new Cube(undefined, reduced_difficulty);
                const buffer: Buffer = Buffer.alloc(1);
                buffer.writeInt8(i);
                cube.setFields(new CubeField(CubeFieldType.PAYLOAD, 1, buffer));
                await cubeStore.addCube(cube);
            }

            expect(cubeStore.getAllStoredCubeKeys().size).toEqual(numberOfCubes);

            // sync cubes from peer 1 to peer 2
            expect(manager1.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
            manager2.outgoingPeers[0].sendKeyRequest();
            // Verify cubes have been synced. Wait up to three seconds for that to happen.
            for (let i = 0; i < 30; i++) {
                if (cubeStore2.getAllStoredCubeKeys().size == numberOfCubes) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            for (const hash of cubeStore.getAllStoredCubeKeys()) {
                expect(cubeStore2.getCube(hash)).toBeInstanceOf(Cube);
            }

            // sync cubes from peer 2 to peer 3
            expect(manager3.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
            manager3.incomingPeers[0].sendKeyRequest();
            // Verify cubes have been synced. Wait up to three seconds for that to happen.
            for (let i = 0; i < 30; i++) {
                if (cubeStore3.getAllStoredCubeKeys().size == numberOfCubes) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            for (const hash of cubeStore2.getAllStoredCubeKeys()) {
                expect(cubeStore3.getCube(hash)).toBeInstanceOf(Cube);
            }

            manager1.shutdown();
            manager2.shutdown();
            manager3.shutdown();
            await Promise.all([promise1_shutdown, promise2_shutdown, promise3_shutdown]);
        }, 10000);

        it('sync MUC updates', async () => {
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();

            const cubeStore = new CubeStore(
                {enableCubePersistance: false, requiredDifficulty: 0});
            const cubeStore2 = new CubeStore(
                {enableCubePersistance: false, requiredDifficulty: 0});
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

            const promise1_listening = new Promise(resolve => manager1.on('listening', resolve));
            const promise2_listening = new Promise(resolve => manager2.on('listening', resolve));
            const promise1_shutdown = new Promise(resolve => manager1.on('shutdown', resolve));
            const promise2_shutdown = new Promise(resolve => manager2.on('shutdown', resolve));

            // Start both nodes
            manager1.start();
            manager2.start();
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
            counterBuffer = Buffer.from("My first MUC version");
            muc = Cube.MUC(
                Buffer.from(keyPair.publicKey),
                Buffer.from(keyPair.privateKey),
                CubeField.Payload(counterBuffer)
            );
            mucKey = (await cubeStore.addCube(muc)).getKeyIfAvailable();
            const firstMucHash = await muc.getHash();
            expect(cubeStore.getAllStoredCubeKeys().size).toEqual(1);

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
            expect(cubeStore2.getAllStoredCubeKeys().size).toEqual(1);
            expect(cubeStore2.getCube(mucKey)).toBeInstanceOf(Cube);
            expect((await cubeStore2.getCube(mucKey)?.getHash())!.equals(firstMucHash)).toBeTruthy();
            receivedFields = cubeStore2.getCube(mucKey)?.getFields()!;
            expect(receivedFields?.getFirstField(CubeFieldType.PAYLOAD).value.toString()).toEqual("My first MUC version");

            // update MUC at peer 1
            await new Promise(resolve => setTimeout(resolve, 1000));  // wait one second as we don't have better time resolution
            counterBuffer = Buffer.from("My second MUC version");
            muc = Cube.MUC(
                Buffer.from(keyPair.publicKey),
                Buffer.from(keyPair.privateKey),
                CubeField.Payload(counterBuffer)
            );
            mucKey = (await cubeStore.addCube(muc)).getKeyIfAvailable();
            const secondMucHash = await muc.getHash();
            expect(cubeStore.getAllStoredCubeKeys().size).toEqual(1);  // still just one, new MUC version replaces old MUC version

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
            expect(cubeStore2.getAllStoredCubeKeys().size).toEqual(1);
            expect(cubeStore2.getCube(mucKey)).toBeInstanceOf(Cube);
            expect((await cubeStore2.getCube(mucKey)?.getHash())!.equals(secondMucHash)).toBeTruthy();
            receivedFields = cubeStore2.getCube(mucKey)?.getFields()!;
            expect(receivedFields?.getFirstField(CubeFieldType.PAYLOAD).value.toString()).toEqual("My second MUC version");

            // teardown
            manager1.shutdown();
            manager2.shutdown();
            await Promise.all([promise1_shutdown, promise2_shutdown]);
        }, 10000);

        it('should blacklist a peer when trying to connect to itself', async () => {
            const peerDB = new PeerDB();
            const manager = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                peerDB,
                new Map([[SupportedTransports.ws, 6004]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            manager.start();

            // Wait for server to start listening
            await new Promise((resolve) => manager.on('listening', resolve));
            expect(peerDB.peersBlacklisted.size).toEqual(0);

            // Trigger a connection to itself
            manager.connect(new Peer(new WebSocketAddress('localhost', 6004)));

            // Wait for the 'blacklist' event to be triggered
            await new Promise<void>((resolve, reject) => {
                manager.on('blacklist', (bannedPeer: Peer) => {
                    resolve();
                })
            });
            expect(peerDB.peersBlacklisted.size).toEqual(1);

            manager.shutdown();
        }, 3000);

        it('should close the connection to duplicate peer addressed', async () => {
            const myPeerDB = new PeerDB();
            const myManager = new NetworkManager(
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
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
                new CubeStore({enableCubePersistance: false, requiredDifficulty: 0}),
                otherPeerDB,
                new Map([[SupportedTransports.ws, 7005]]),
                {  // disable optional features
                    announceToTorrentTrackers: false,
                    autoConnect: false,
                    lightNode: false,
                    peerExchange: false,
                });
            const otherListens = new Promise((resolve) => otherManager.on('listening', resolve));
                otherManager.start();
            await otherListens;

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
            expect(myManager.outgoingPeers[0].id?.equals(otherManager.peerID));
            expect(otherManager.outgoingPeers.length).toEqual(0);
            expect(otherManager.incomingPeers.length).toEqual(1);
            expect(otherManager.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
            const othersFirstNp: NetworkPeer = otherManager.incomingPeers[0];
            expect(othersFirstNp.id?.equals(myManager.peerID));
            expect(myPeerDB.peersVerified.size).toEqual(0);  // outgoing peers get exchangeable on verification
            expect(myPeerDB.peersExchangeable.size).toEqual(1);
            expect(otherPeerDB.peersVerified.size).toEqual(1);
            expect(otherPeerDB.peersExchangeable.size).toEqual(0);  // incoming ones don't
            expect(myManager.outgoingPeers[0].conn).toBeInstanceOf(WebSocketPeerConnection);
            expect((myManager.outgoingPeers[0].conn as WebSocketPeerConnection).
                ws.readyState).toEqual(WebSocket.OPEN);
            expect(myFirstNp.conn).toBeInstanceOf(WebSocketPeerConnection);
            expect((myFirstNp.conn as WebSocketPeerConnection).
                ws.readyState).toEqual(WebSocket.OPEN);
            expect(othersFirstNp.conn).toBeInstanceOf(WebSocketPeerConnection);
            expect((othersFirstNp.conn as WebSocketPeerConnection).
                ws.readyState).toEqual(WebSocket.OPEN);

            // Connect again through different address.
            // This will trigger the duplicatepeer signal on both peers.
            // Wait for these signals; if they don't come, this test will fail
            // due to *timeout only*.
            const iNotedDuplicate = new Promise((resolve) =>
                myManager.on('duplicatepeer', resolve));
            const otherNotedDuplicate = new Promise((resolve) =>
                otherManager.on('duplicatepeer',  resolve));
            const bothNotedDuplicate = Promise.all([iNotedDuplicate, otherNotedDuplicate]);
            const myDuplicateNp: NetworkPeer =
                myManager.connect(new Peer(new WebSocketAddress('127.0.0.1', 7005)));
            let othersDuplicateNp;
            otherManager.on("incomingPeer", peer => othersDuplicateNp = peer);
            await bothNotedDuplicate;

            expect(myPeerDB.peersBlacklisted.size).toEqual(0);  // duplicate is not / no longer blacklisting
            expect(otherPeerDB.peersBlacklisted.size).toEqual(0);  // duplicate is not / no longer blacklisting
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
            expect((myFirstNp.conn as WebSocketPeerConnection).
                ws.readyState).toEqual(WebSocket.OPEN);
            expect((othersFirstNp.conn as WebSocketPeerConnection).
                ws.readyState).toEqual(WebSocket.OPEN);
            expect((myDuplicateNp.conn as WebSocketPeerConnection).
                ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
            expect((othersDuplicateNp.conn as WebSocketPeerConnection).
                ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);

            // maybe implement further tests:
            // Will not attempt to reconnect to an already blacklisted peer
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
            expect((myFirstNp.conn as WebSocketPeerConnection).
                ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
            expect((othersFirstNp.conn as WebSocketPeerConnection).
                ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
            expect((myDuplicateNp.conn as WebSocketPeerConnection).
                ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
            expect((othersDuplicateNp.conn as WebSocketPeerConnection).
                ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);
        }, 10000);

        it('should exchange peers and connect them', async () => {
            // TODO implement
        });
        it('should not auto-connect peers if disabled', async () => {
            // TODO implement
        });
        it('should not exchange peers if disabled', async () => {
            // TODO implement
        });
    });  // WebSockets and general functionality

    describe('libp2p connections', () => {
        // TODO write tests
    });
});


