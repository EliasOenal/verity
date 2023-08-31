import { PeerDB, Peer } from '../../src/model/peerDB';

describe('announce', () => {
    it.skip('should get peers from multiple trackers', async () => {
        let peerDB: PeerDB = new PeerDB();

        // Array to hold new peers received from trackers
        let newPeers: Peer[] = [];

        // Listen for 'newPeer' event
        peerDB.on('newPeer', (peer: Peer) => {
            newPeers.push(peer);
        });

        // Invoke announce function
        await peerDB.announce();

        // Check if we received any new peers
        expect(newPeers.length).toBeGreaterThan(0);
    }, 10000);
});

describe('parsePeers', () => {
    it('should correctly parse a buffer of peers', () => {
        const peers = Buffer.from([192, 168, 0, 1, 0x1f, 0x90]); // IP: 192.168.0.1, Port: 8080
        const peers6 = Buffer.alloc(0); // No IPv6 peers

        const result = PeerDB.parsePeers(peers, peers6);

        expect(result).toEqual([
            { ip: '192.168.0.1', port: 8080 },
        ]);
    }, 1000);
});
