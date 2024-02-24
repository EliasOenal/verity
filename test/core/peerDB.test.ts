import { logger } from '../../src/core/logger';
import { WebSocketAddress } from '../../src/core/peering/addressing';
import { Peer } from '../../src/core/peering/peer';
import { PeerDB } from '../../src/core/peering/peerDB';

describe ('PeerDB', () => {
    it.skip('should get peers from multiple trackers', async () => {
        const peerDB: PeerDB = new PeerDB();

        // Array to hold new peers received from trackers
        const newPeers: Peer[] = [];

        // Listen for 'newPeer' event
        peerDB.on('newPeer', (peer: Peer) => {
            newPeers.push(peer);
        });

        // Invoke announce function
        await peerDB.announce();

        // Check if we received any new peers
        expect(newPeers.length).toBeGreaterThan(0);
    }, 10000);

    it('should correctly parse a buffer of peers', () => {
        const peers = Buffer.from([192, 168, 0, 1, 0x1f, 0x90]); // IP: 192.168.0.1, Port: 8080
        const peers6 = Buffer.alloc(0); // No IPv6 peers

        const result = PeerDB.parsePeers(peers, peers6);

        expect(result).toEqual([new Peer(new WebSocketAddress('192.168.0.1', 8080))]);
    }, 3000);

    it('correctly blocklist peers', () => {
        const peerDB = new PeerDB();
        peerDB.learnPeer(new Peer(new WebSocketAddress("127.0.0.1", 1337)));
        peerDB.learnPeer(new Peer(new WebSocketAddress("127.0.0.1", 1338)));
        peerDB.verifyPeer(new Peer(new WebSocketAddress("127.0.0.1", 1339), Buffer.from("bd806506666ea6ae759878ac1463344e", 'hex')));
        peerDB.verifyPeer(new Peer(new WebSocketAddress("127.0.0.1", 1340), Buffer.from("a0cffa47a81fe5cf72e3a9ac1d0f2f16", 'hex')));
        peerDB.markPeerExchangeable(new Peer(new WebSocketAddress("127.0.0.1", 1341), Buffer.from("db03cb899bd15a941ff6d26581e41a12", 'hex')));
        expect(peerDB.peersUnverified.size).toEqual(2);
        expect(peerDB.peersVerified.size).toEqual(2);
        expect(peerDB.peersExchangeable.size).toEqual(1);
        expect(peerDB.peersBlocked.size).toEqual(0);

        peerDB.blocklistPeer(new Peer(new WebSocketAddress("127.0.0.1", 1338)));
        expect(peerDB.peersUnverified.size).toEqual(1);
        expect(peerDB.peersVerified.size).toEqual(2);
        expect(peerDB.peersExchangeable.size).toEqual(1);
        expect(peerDB.peersBlocked.size).toEqual(1);

        peerDB.blocklistPeer(new Peer(new WebSocketAddress("1.1.1.1", 40404), Buffer.from("bd806506666ea6ae759878ac1463344e", 'hex')));
        expect(peerDB.peersUnverified.size).toEqual(1);
        expect(peerDB.peersVerified.size).toEqual(1);
        expect(peerDB.peersExchangeable.size).toEqual(1);
        expect(peerDB.peersBlocked.size).toEqual(2);

        peerDB.blocklistPeer(new Peer(new WebSocketAddress("2.2.2.2", 33333), Buffer.from("db03cb899bd15a941ff6d26581e41a12", 'hex')));
        expect(peerDB.peersUnverified.size).toEqual(1);
        expect(peerDB.peersVerified.size).toEqual(1);
        expect(peerDB.peersExchangeable.size).toEqual(0);
        expect(peerDB.peersBlocked.size).toEqual(3);
    });
});
