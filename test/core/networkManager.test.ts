import { NetworkManager } from '../../src/core/networkManager';
import { NetworkPeer } from '../../src/core/networkPeer';
import { CubeStore } from '../../src/core/cubeStore';
import { Cube, CubeKey } from '../../src/core/cube';
import { CubeField, CubeFieldType, CubeFields, cubeFieldDefinition } from '../../src/core/cubeFields';
import { PeerDB, Peer } from '../../src/core/peerDB';
import { logger } from '../../src/core/logger';

import WebSocket from 'isomorphic-ws';
import sodium, { KeyPair } from 'libsodium-wrappers'
import { FieldParser } from '../../src/core/fieldParser';

describe('networkManager', () => {
    beforeEach((done) => {
        done();
    });

    afterEach((done) => {
        done();
    });

    test('should create a WebSocket server on instantiation', done => {
        const manager = new NetworkManager(3000, new CubeStore(false), new PeerDB(), false)
        manager.start();
        expect(manager.server).toBeInstanceOf(WebSocket.Server);
        manager.shutdown();
        done();
    }, 3000);

    test('should create a NetworkPeer on incoming connection', done => {
        const manager = new NetworkManager(3001, new CubeStore(false), new PeerDB(), false);
        manager.start();
        manager.server = manager.server;
        manager.server?.on('connection', () => {
            expect(manager?.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        });

        const client = new WebSocket('ws://localhost:3001');
        client.on('open', () => {
            client.close();
            manager.shutdown();
            done();
        });
    }, 3000);

    test('should create a NetworkPeer on outgoing connection', async () => {
        const manager = new NetworkManager(3003, new CubeStore(false), new PeerDB(), false);
        manager.start();

        // Wait for server to start listening
        await new Promise((resolve) => manager?.server?.on('listening', resolve));

        const server = new WebSocket.Server({ port: 3002 });

        // Wait for server2 to start listening
        await new Promise((resolve) => server?.on('listening', resolve));

        await manager.connect('ws://localhost:3002');

        expect(manager.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        server.close();
        manager.shutdown();
    }, 3000);

    test('sync cubes between three nodes', async () => {
        const reduced_difficulty = 0;
        const numberOfCubes = 10;
        const cubeStore = new CubeStore(false, reduced_difficulty);  // no persistence
        const cubeStore2 = new CubeStore(false, reduced_difficulty);
        const cubeStore3 = new CubeStore(false, reduced_difficulty);
        const manager1 = new NetworkManager(4000, cubeStore, new PeerDB(), false, false);
        const manager2 = new NetworkManager(4001, cubeStore2, new PeerDB(), false, false);
        const manager3 = new NetworkManager(4002, cubeStore3, new PeerDB(), false, false);

        const promise1_listening = new Promise(resolve => manager1.on('listening', resolve));
        const promise2_listening = new Promise(resolve => manager2.on('listening', resolve));
        const promise3_listening = new Promise(resolve => manager3.on('listening', resolve));
        const promise1_shutdown = new Promise(resolve => manager1.on('shutdown', resolve));
        const promise2_shutdown = new Promise(resolve => manager2.on('shutdown', resolve));
        const promise3_shutdown = new Promise(resolve => manager3.on('shutdown', resolve));

        // Start all three nodes
        manager1.start();
        manager2.start();
        manager3.start();
        await Promise.all([promise1_listening, promise2_listening, promise3_listening]);

        // Connect peer 2 to both peer 1 and peer 3
        manager2.connect('ws://localhost:4000');
        manager2.connect('ws://localhost:4002');
        expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        expect(manager2.outgoingPeers[1]).toBeInstanceOf(NetworkPeer);
        await manager2.outgoingPeers[0].online()
        await manager2.outgoingPeers[1].online()

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
        manager2.outgoingPeers[0].sendHashRequest();
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
        manager3.incomingPeers[0].sendHashRequest();
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
    }, 20000);

    test('sync MUC updates', async () => {
        await sodium.ready;
        const keyPair = sodium.crypto_sign_keypair();

        const cubeStore = new CubeStore(false);
        const cubeStore2 = new CubeStore(false);
        const manager1 = new NetworkManager(4000, cubeStore, new PeerDB(), false, false);
        const manager2 = new NetworkManager(4001, cubeStore2, new PeerDB(), false, false);

        const promise1_listening = new Promise(resolve => manager1.on('listening', resolve));
        const promise2_listening = new Promise(resolve => manager2.on('listening', resolve));
        const promise1_shutdown = new Promise(resolve => manager1.on('shutdown', resolve));
        const promise2_shutdown = new Promise(resolve => manager2.on('shutdown', resolve));

        // Start both nodes
        manager1.start();
        manager2.start();
        await Promise.all([promise1_listening, promise2_listening]);

        // Connect peer 1 to peer 2
        manager1.connect('ws://localhost:4001');
        expect(manager1.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        await manager1.outgoingPeers[0].online();

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
        mucKey = await cubeStore.addCube(muc);
        const firstMucHash = await muc.getHash();
        expect(cubeStore.getAllStoredCubeKeys().size).toEqual(1);

        // sync MUC from peer 1 to peer 2
        expect(manager2.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        manager2.incomingPeers[0].sendHashRequest();
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
        mucKey = await cubeStore.addCube(muc);
        const secondMucHash = await muc.getHash();
        expect(cubeStore.getAllStoredCubeKeys().size).toEqual(1);  // still just one, new MUC version replaces old MUC version

        // sync MUC from peer 1 to peer 2, again
        manager2.incomingPeers[0].sendHashRequest();
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
    }, 20000);

    test('should blacklist a peer when trying to connect to itself', async () => {
        const peerDB = new PeerDB();
        const manager = new NetworkManager(3004, new CubeStore(false), peerDB, false);
        manager.start();

        // Wait for server to start listening
        await new Promise((resolve) => manager.server?.on('listening', resolve));

        // Trigger a connection to itself
        manager.connect(`ws://localhost:3004`);

        let peer: Peer;
        // Wait for the 'blacklist' event to be triggered
        await new Promise((resolve, reject) => {
            manager.on('blacklist', (bannedPeer: Peer) => {
                logger.warn(`Peer ${bannedPeer.ip}:${bannedPeer.port} was blacklisted`);
                peer = bannedPeer;
                expect(bannedPeer).toBeInstanceOf(Peer);
                const blacklistedPeers = peerDB.getPeersBlacklisted();
                expect(blacklistedPeers).toContain(peer);
                resolve(undefined);
            });
        });

        manager.shutdown();
    }, 3000);

    test('should blacklist a peer when ID is equal to existing peer', async () => {
        const myPeerDB = new PeerDB();
        const myManager = new NetworkManager(3004, new CubeStore(false), myPeerDB, false);
        myManager.start();

        const otherPeerDB = new PeerDB();
        const otherManager = new NetworkManager(3005, new CubeStore(false), otherPeerDB, false);
        otherManager.start();

        // Wait for server to start listening
        const iListen = new Promise((resolve) => myManager.server?.on('listening', resolve));
        const otherListens = new Promise((resolve) => otherManager.server?.on('listening', resolve));
        const bothListen = Promise.all([iListen, otherListens]);
        await bothListen;

        // connect to peer and wait till connected
        // (= wait for the peeronline signal, which is emitted after the
        //    hello exchange is completed)
        const iHaveConnected = new Promise((resolve) => myManager.on('peeronline', resolve));
        const otherHasConnected = new Promise((resolve) => otherManager.on('peeronline', resolve));
        const bothHaveConnected = Promise.all([iHaveConnected, otherHasConnected]);
        myManager.connect('ws://localhost:3005');
        await bothHaveConnected;

        // ensure connected
        expect(myManager.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        expect(myManager.outgoingPeers[0].stats.peerID?.equals(otherManager.peerID));
        expect(otherManager.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        expect(otherManager.incomingPeers[0].stats.peerID?.equals(myManager.peerID));

        // Connect again through different address.
        // This will trigger the blacklist signal on both peers.
        // Wait for these signals; if they don't come, this test will fail
        // due to *timeout only*.
        const iHaveBlacklisted = new Promise((resolve) => {
            myManager.on('blacklist', () => { resolve(undefined); })
        });
        const otherHasBlacklisted = new Promise((resolve) => {
            otherManager.on('blacklist', () => { resolve(undefined); })
        });
        const bothHaveBlacklisted = Promise.all([iHaveBlacklisted, otherHasBlacklisted]);
        myManager.connect('ws://127.0.0.1:3005');
        await bothHaveBlacklisted;

        expect(myPeerDB.getPeersBlacklisted()[0]).toBeInstanceOf(Peer);
        expect(myPeerDB.getPeersBlacklisted()[0].address()).toEqual('127.0.0.1:3005');
        expect(otherPeerDB.getPeersBlacklisted()[0]).toBeInstanceOf(Peer);
        expect(myManager.outgoingPeers.length).toEqual(1);
        expect(myManager.incomingPeers.length).toEqual(0);
        expect(otherManager.outgoingPeers.length).toEqual(0);
        expect(otherManager.incomingPeers.length).toEqual(1);
        expect(myPeerDB.getPeersVerified().length).toEqual(1);
        expect(otherPeerDB.getPeersVerified().length).toEqual(1);

        // Will not attempt to reconnect to an already blacklisted peer
        //...

        // Teardown
        myManager.shutdown();
        otherManager.shutdown();
    }, 20000);

});


