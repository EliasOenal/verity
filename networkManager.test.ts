import { NetworkManager } from './networkManager';
import { NetworkPeer } from './networkPeer';
import { BlockStorage } from './blockStorage';
import WebSocket from 'ws';
import { Block, FieldType } from './block';
import { PeerDB, Peer } from './peerDB';
import { logger } from './logger';

describe('networkManager', () => {

    beforeEach((done) => {
        done();
    });

    afterEach((done) => {
        done();
    });

    test('should create a WebSocket server on instantiation', done => {
        let manager = new NetworkManager(3000, new BlockStorage(), new PeerDB(), false)
        manager.start();
        expect(manager.server).toBeInstanceOf(WebSocket.Server);
        manager.shutdown();
        done();
    }, 1000);

    test('should create a NetworkPeer on incoming connection', done => {
        let manager = new NetworkManager(3001, new BlockStorage(), new PeerDB(), false);
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
        let manager = new NetworkManager(3003, new BlockStorage(), new PeerDB(), false);
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

    test('sync blocks between three nodes', async () => {
        const numberOfBlocks = 50;
        let blockStorage = new BlockStorage();
        let blockStorage2 = new BlockStorage();
        let blockStorage3 = new BlockStorage();
        let manager1 = new NetworkManager(4000, blockStorage, new PeerDB(), false, false);
        let manager2 = new NetworkManager(4001, blockStorage2, new PeerDB(), false, false);
        let manager3 = new NetworkManager(4002, blockStorage3, new PeerDB(), false, false);

        let promise1_listening = new Promise(resolve => manager1.on('listening', resolve));
        let promise2_listening = new Promise(resolve => manager2.on('listening', resolve));
        let promise3_listening = new Promise(resolve => manager3.on('listening', resolve));
        let promise1_shutdown = new Promise(resolve => manager1.on('shutdown', resolve));
        let promise2_shutdown = new Promise(resolve => manager2.on('shutdown', resolve));
        let promise3_shutdown = new Promise(resolve => manager3.on('shutdown', resolve));

        manager1.start();
        manager2.start();
        manager3.start();

        await Promise.all([promise1_listening, promise2_listening, promise3_listening]);
        await new Promise<NetworkPeer>(resolve => {
            manager2.connect('ws://localhost:4000').then(peer => resolve(peer));
        });
        await new Promise<NetworkPeer>(resolve => {
            manager2.connect('ws://localhost:4002').then(peer => resolve(peer));
        });

        expect(manager2.outgoingPeers[0]).toBeInstanceOf(NetworkPeer);
        expect(manager2.outgoingPeers[1]).toBeInstanceOf(NetworkPeer);

        for (let i = 0; i < numberOfBlocks; i++) {
            let block = new Block();
            let buffer: Buffer = Buffer.alloc(1);
            buffer.writeInt8(i);
            block.setFields([{ type: FieldType.PAYLOAD, length: 1, value: buffer }]);
            await blockStorage.addBlock(block);
        }
        expect(manager1.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        manager2.outgoingPeers[0].sendHashRequest();
        // wait 3 seconds for the hash request to be sent
        for (let i = 0; i < 30; i++) {
            if (blockStorage2.getAllHashes().length == numberOfBlocks) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(manager3.incomingPeers[0]).toBeInstanceOf(NetworkPeer);
        manager3.incomingPeers[0].sendHashRequest();
        // wait 2 seconds for the hash request to be sent
        for (let i = 0; i < 30; i++) {
            if (blockStorage3.getAllHashes().length == numberOfBlocks) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // verify blocks are synced
        for (let hash of blockStorage2.getAllHashes()) {
            expect(blockStorage.getBlock(hash)).toBeInstanceOf(Block);
        }
        for (let hash of blockStorage3.getAllHashes()) {
            expect(blockStorage.getBlock(hash)).toBeInstanceOf(Block);
        }

        //manager2!.prettyPrintStats();

        manager1.shutdown();
        manager2.shutdown();
        manager3.shutdown();
        await Promise.all([promise1_shutdown, promise2_shutdown, promise3_shutdown]);
    }, 5000);

    test('should blacklist a peer when trying to connect to itself', async () => {
        const peerDB = new PeerDB();
        let manager = new NetworkManager(3004, new BlockStorage(), peerDB, false);
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


