import { PeerDB, Peer } from '../../src/core/peerDB';

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

        expect(result).toEqual([
            { ip: '192.168.0.1', port: 8080 },
        ]);
    }, 3000);

    it('correctly blacklists peers', () => {
        const peerDB = new PeerDB();
        peerDB.setPeersVerified([
            new Peer("127.0.0.1", 1337),
            new Peer("127.0.0.1", 1338, Buffer.from("bd806506666ea6ae759878ac1463344e", 'hex'))
        ]);
        peerDB.setPeersUnverified([
            new Peer("127.0.0.1", 1339),
            new Peer("127.0.0.1", 1340, Buffer.from("a0cffa47a81fe5cf72e3a9ac1d0f2f16", 'hex'))
        ]);
        expect(peerDB.getPeersVerified().length).toEqual(2);
        expect(peerDB.getPeersUnverified().length).toEqual(2);
        expect(peerDB.getPeersBlacklisted().length).toEqual(0);

        peerDB.setPeersBlacklisted([new Peer("127.0.0.1", 1337)]);
        expect(peerDB.getPeersVerified().length).toEqual(1);
        expect(peerDB.getPeersUnverified().length).toEqual(2);
        expect(peerDB.getPeersBlacklisted().length).toEqual(1);

        peerDB.setPeersBlacklisted([new Peer("1.1.1.1", 40404, Buffer.from("a0cffa47a81fe5cf72e3a9ac1d0f2f16", 'hex'))]);
        expect(peerDB.getPeersVerified().length).toEqual(1);
        expect(peerDB.getPeersUnverified().length).toEqual(1);
        expect(peerDB.getPeersBlacklisted().length).toEqual(2);
    });
});
