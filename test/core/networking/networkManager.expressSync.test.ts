import { CubeStore } from "../../../src/core/cube/cubeStore";
import { NetworkManager } from "../../../src/core/networking/networkManager";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/dummyNetworkManager";
import { DummyNetworkPeer } from "../../../src/core/networking/testingDummies/dummyNetworkPeer";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { requiredDifficulty, testCoreOptions } from "../testcore.definition";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { NodeType, SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { KeyResponseMessage, KeyRequestMode } from "../../../src/core/networking/networkMessage";
import { asCubeKey } from "../../../src/core/cube/keyUtil";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// Extend DummyNetworkPeer to add remoteNodeType property for testing
class TestNetworkPeer extends DummyNetworkPeer {
  remoteNodeType?: NodeType;
}

describe('NetworkManager cube offering', () => {
  let networkManager: NetworkManager;
  let cubeStore: CubeStore;
  let peerDB: PeerDB;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore(testCoreOptions);
    await cubeStore.readyPromise;
    peerDB = new PeerDB();
    
    networkManager = new NetworkManager(cubeStore, peerDB, {
      transports: new Map(),
      lightNode: false // Make sure we're testing as a full node
    });
  });

  afterEach(async () => {
    await networkManager.shutdown();
  });

  test('expressSync should do nothing with empty cubeInfos array', () => {
    // Should not throw or cause any issues
    networkManager.expressSync([]);
    networkManager.expressSync(null as any);
    networkManager.expressSync(undefined as any);
  });

  test('expressSync should do nothing when no full nodes are connected', () => {
    const cubeInfo = new CubeInfo({
      key: asCubeKey(Buffer.alloc(32, 1)),
      cubeType: 1,
      difficulty: 0,
      date: Date.now() / 1000,
      updatecount: 0
    });

    // Create a light node peer
    const lightPeer = new TestNetworkPeer(networkManager);
    lightPeer.remoteNodeType = NodeType.Light;
    lightPeer.online = true;
    networkManager.incomingPeers.push(lightPeer);

    // Should not send anything since no full nodes are connected
    const sendMessageSpy = vi.spyOn(lightPeer, 'sendMessage');
    
    networkManager.expressSync([cubeInfo]);
    
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  test('expressSync should send KeyResponse to connected full nodes only', () => {
    const cubeInfo = new CubeInfo({
      key: asCubeKey(Buffer.alloc(32, 1)),
      cubeType: 1,
      difficulty: 0,
      date: Date.now() / 1000,
      updatecount: 0
    });

    // Create a full node peer
    const fullPeer = new TestNetworkPeer(networkManager);
    fullPeer.remoteNodeType = NodeType.Full;
    fullPeer.online = true;
    networkManager.incomingPeers.push(fullPeer);

    // Create a light node peer
    const lightPeer = new TestNetworkPeer(networkManager);
    lightPeer.remoteNodeType = NodeType.Light;
    lightPeer.online = true;
    networkManager.outgoingPeers.push(lightPeer);

    // Create an offline full node peer
    const offlineFullPeer = new TestNetworkPeer(networkManager);
    offlineFullPeer.remoteNodeType = NodeType.Full;
    offlineFullPeer.online = false;
    networkManager.outgoingPeers.push(offlineFullPeer);

    const fullPeerSendSpy = vi.spyOn(fullPeer, 'sendMessage');
    const lightPeerSendSpy = vi.spyOn(lightPeer, 'sendMessage');
    const offlineFullPeerSendSpy = vi.spyOn(offlineFullPeer, 'sendMessage');
    
    networkManager.expressSync([cubeInfo]);
    
    // Only the online full node should receive the offer
    expect(fullPeerSendSpy).toHaveBeenCalledTimes(1);
    expect(lightPeerSendSpy).not.toHaveBeenCalled();
    expect(offlineFullPeerSendSpy).not.toHaveBeenCalled();

    // Verify the message sent is a KeyResponse with ExpressSync mode
    const sentMessage = fullPeerSendSpy.mock.calls[0][0];
    expect(sentMessage).toBeInstanceOf(KeyResponseMessage);
    expect((sentMessage as KeyResponseMessage).mode).toBe(KeyRequestMode.ExpressSync);
    expect((sentMessage as KeyResponseMessage).keyCount).toBe(1);
  });

  test('expressSync should handle multiple cubes and multiple full nodes', () => {
    const cubeInfo1 = new CubeInfo({
      key: asCubeKey(Buffer.alloc(32, 1)),
      cubeType: 1,
      difficulty: 0,
      date: Date.now() / 1000,
      updatecount: 0
    });

    const cubeInfo2 = new CubeInfo({
      key: asCubeKey(Buffer.alloc(32, 2)),
      cubeType: 1,
      difficulty: 0,
      date: Date.now() / 1000,
      updatecount: 0
    });

    // Create two full node peers
    const fullPeer1 = new TestNetworkPeer(networkManager);
    fullPeer1.remoteNodeType = NodeType.Full;
    fullPeer1.online = true;
    networkManager.incomingPeers.push(fullPeer1);

    const fullPeer2 = new TestNetworkPeer(networkManager);
    fullPeer2.remoteNodeType = NodeType.Full;
    fullPeer2.online = true;
    networkManager.outgoingPeers.push(fullPeer2);

    const fullPeer1SendSpy = vi.spyOn(fullPeer1, 'sendMessage');
    const fullPeer2SendSpy = vi.spyOn(fullPeer2, 'sendMessage');
    
    networkManager.expressSync([cubeInfo1, cubeInfo2]);
    
    // Both full nodes should receive the offer
    expect(fullPeer1SendSpy).toHaveBeenCalledTimes(1);
    expect(fullPeer2SendSpy).toHaveBeenCalledTimes(1);

    // Verify the message contains both cubes
    const sentMessage1 = fullPeer1SendSpy.mock.calls[0][0] as KeyResponseMessage;
    const sentMessage2 = fullPeer2SendSpy.mock.calls[0][0] as KeyResponseMessage;
    
    expect(sentMessage1.mode).toBe(KeyRequestMode.ExpressSync);
    expect(sentMessage1.keyCount).toBe(2);
    expect(sentMessage2.mode).toBe(KeyRequestMode.ExpressSync);
    expect(sentMessage2.keyCount).toBe(2);
  });

  test('expressSync should handle sendMessage errors gracefully', () => {
    const cubeInfo = new CubeInfo({
      key: asCubeKey(Buffer.alloc(32, 1)),
      cubeType: 1,
      difficulty: 0,
      date: Date.now() / 1000,
      updatecount: 0
    });

    const fullPeer = new TestNetworkPeer(networkManager);
    fullPeer.remoteNodeType = NodeType.Full;
    fullPeer.online = true;
    networkManager.incomingPeers.push(fullPeer);

    // Make sendMessage throw an error
    vi.spyOn(fullPeer, 'sendMessage').mockImplementation(() => {
      throw new Error('Network error');
    });
    
    // Should not throw despite the sendMessage error
    expect(() => {
      networkManager.expressSync([cubeInfo]);
    }).not.toThrow();
  });

  test('expressSync should use ExpressSync mode specifically', () => {
    const cubeInfo = new CubeInfo({
      key: asCubeKey(Buffer.alloc(32, 1)),
      cubeType: 1,
      difficulty: 0,
      date: Date.now() / 1000,
      updatecount: 0
    });

    const fullPeer = new TestNetworkPeer(networkManager);
    fullPeer.remoteNodeType = NodeType.Full;
    fullPeer.online = true;
    networkManager.incomingPeers.push(fullPeer);

    const sendMessageSpy = vi.spyOn(fullPeer, 'sendMessage');
    
    networkManager.expressSync([cubeInfo]);
    
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const sentMessage = sendMessageSpy.mock.calls[0][0] as KeyResponseMessage;
    
    // Verify it's using the new ExpressSync mode, not SlidingWindow
    expect(sentMessage.mode).toBe(KeyRequestMode.ExpressSync);
    expect(sentMessage.mode).not.toBe(KeyRequestMode.SlidingWindow);
    expect(sentMessage.mode).not.toBe(KeyRequestMode.Legacy);
    expect(sentMessage.mode).not.toBe(KeyRequestMode.SequentialStoreSync);
    expect(sentMessage.keyCount).toBe(1);
  });

  test('DummyNetworkManager should have a no-op implementation', () => {
    const dummyManager = new DummyNetworkManager(cubeStore, peerDB, {});
    const cubeInfo = new CubeInfo({
      key: asCubeKey(Buffer.alloc(32, 1)),
      cubeType: 1,
      difficulty: 0,
      date: Date.now() / 1000,
      updatecount: 0
    });

    // Should not throw
    expect(() => {
      dummyManager.expressSync([cubeInfo]);
    }).not.toThrow();
  });
});