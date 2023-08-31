import { NetworkManager } from '../../src/model/networkManager';
import { NetworkPeer } from '../../src/model/networkPeer';
import { CubeStore } from '../../src/model/cubeStore';
import { Cube } from '../../src/model/cube';
import { Field, FieldType, Fields } from '../../src/model/fieldProcessing';
import { PeerDB, Peer } from '../../src/model/peerDB';
import { logger } from '../../src/model/logger';

import WebSocket from 'isomorphic-ws';

describe('networkManager', () => {

    beforeEach((done) => {
        done();
    });

    afterEach((done) => {
        done();
    });

    test('should create a WebSocket server on instantiation', done => {
        let manager = new NetworkManager(3000, new CubeStore(false), new PeerDB(), false)
        manager.start();
        expect(manager.server).toBeInstanceOf(WebSocket.Server);
        manager.shutdown();
        done();
    }, 1000);

    test('should create a NetworkPeer on incoming connection', done => {
        let manager = new NetworkManager(3001, new CubeStore(false), new PeerDB(), false);
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
    }, 1000);

    test('should create a NetworkPeer on outgoing connection', async () => {
        let manager = new NetworkManager(3003, new CubeStore(false), new PeerDB(), false);
        manager.start();

        // Wait for server to start listening
        await new Promise((resolve) => manager?.server?.on('listening', resolve));

        let server = new WebSocket.Server({ port: 3002 });

        // Wait for server2 to start listening
        await new Promise((resolve) => server?.on('listening', resolve));

        await manager.connect('ws://localhost:3002');

        expect(manager.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        server.close();
        manager.shutdown();
    }, 1000);

    test('sync cubes between three nodes', async () => {
        const numberOfCubes = 10;
        let cubeStore = new CubeStore(false, false);  // no persistence, no annotations
        let cubeStore2 = new CubeStore(false, false);
        let cubeStore3 = new CubeStore(false, false);
        let manager1 = new NetworkManager(4000, cubeStore, new PeerDB(), false, false);
        let manager2 = new NetworkManager(4001, cubeStore2, new PeerDB(), false, false);
        let manager3 = new NetworkManager(4002, cubeStore3, new PeerDB(), false, false);

        let promise1_listening = new Promise(resolve => manager1.on('listening', resolve));
        let promise2_listening = new Promise(resolve => manager2.on('listening', resolve));
        let promise3_listening = new Promise(resolve => manager3.on('listening', resolve));
        let promise1_shutdown = new Promise(resolve => manager1.on('shutdown', resolve));
        let promise2_shutdown = new Promise(resolve => manager2.on('shutdown', resolve));
        let promise3_shutdown = new Promise(resolve => manager3.on('shutdown', resolve));

        // Start all three nodes
        manager1.start();
        manager2.start();
        manager3.start();
        await Promise.all([promise1_listening, promise2_listening, promise3_listening]);

        // Connect peer 2 to both peer 1 and peer 3
        await new Promise<NetworkPeer>(resolve => {
            manager2.connect('ws://localhost:4000').then(peer => resolve(peer));
        });
        await new Promise<NetworkPeer>(resolve => {
            manager2.connect('ws://localhost:4002').then(peer => resolve(peer));
        });
        expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        expect(manager2.outgoingPeers[1]).toBeInstanceOf(NetworkPeer);

        // Create new cubes at peer 1
        for (let i = 0; i < numberOfCubes; i++) {
            let cube = new Cube();
            let buffer: Buffer = Buffer.alloc(1);
            buffer.writeInt8(i);
            cube.setFields(new Field(FieldType.PAYLOAD, 1, buffer));
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
        for (let hash of cubeStore.getAllStoredCubeKeys()) {
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
        for (let hash of cubeStore2.getAllStoredCubeKeys()) {
            expect(cubeStore3.getCube(hash)).toBeInstanceOf(Cube);
        }

        manager1.shutdown();
        manager2.shutdown();
        manager3.shutdown();
        await Promise.all([promise1_shutdown, promise2_shutdown, promise3_shutdown]);
    }, 20000);

    test('should blacklist a peer when trying to connect to itself', async () => {
        const peerDB = new PeerDB();
        let manager = new NetworkManager(3004, new CubeStore(false), peerDB, false);
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
    }, 1000);

});


