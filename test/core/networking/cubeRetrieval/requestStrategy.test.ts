import { BestScoreStrategy, RandomStrategy } from "../../../../src/core/networking/cubeRetrieval/requestStrategy";
import { NetworkPeerIf } from "../../../../src/core/networking/networkPeerIf";
import { DummyNetworkPeer } from "../../../../src/core/networking/testingDummies/networkPeerDummy";

describe('RequestScheduler request strategies', () => {

  describe('RandomStrategy', () => {
    it('should select a random node', () => {
      // create 10 mock network peers
      const peers: NetworkPeerIf[] = [];
      for (let i = 0; i < 10; i++) peers.push(new DummyNetworkPeer());
      const strategy = new RandomStrategy();
      // select a random peer 10000 times
      const selectionHistogram: Map<NetworkPeerIf, number> = new Map();
      for (let i = 0; i < 10000; i++) {
        const peer = strategy.select(peers);
        if (selectionHistogram.has(peer)) {
          selectionHistogram.set(peer, selectionHistogram.get(peer)! + 1);
        } else selectionHistogram.set(peer, 1);
      }
      // check that the selection is random
      expect(selectionHistogram.size).toEqual(peers.length);
      for (const [peer, count] of selectionHistogram) {
        expect(peers.includes(peer)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(848);
        // this test has at least 99.99999% chance of succeeding
        // (if ChatGPT calculated the distribution correctly)
      }
    });
  });  // RandomStrategy


  describe('BestScoreStrategy', () => {
    it('should select the best score', () => {
      const peers: NetworkPeerIf[] = [];
      for (let i = 0; i < 10; i++) {
        const dummy = new DummyNetworkPeer();
        // give peers increasingly higher scores
        for (let j = 0; j < i; j++) dummy.scoreMessage();
        peers[i] = dummy;
      }
      const strategy = new BestScoreStrategy();
      const peer = strategy.select(peers);
      // check that the selected peer has the highest score
      expect(peer).toBe(peers[9]);
    });
  });
});
