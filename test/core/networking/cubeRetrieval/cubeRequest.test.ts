import { NetworkRequestMonitor } from "../../../../src/core/networking/cubeRetrieval/pendingRequest";
import { DummyNetworkPeer } from "../../../../src/core/networking/testingDummies/networkPeerDummy";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('NetworkRequestMonitor', () => {
  it('represents "no request sent" after creation', () => {
    const monitor = new NetworkRequestMonitor();
    expect(monitor.peer).toBeUndefined();
    expect(monitor.settled).toBe(false);
    expect(monitor.timedOut).toBe(false);
    // checking internal timer
    expect((monitor as any).networkRequestTimeout).toBeUndefined();
  });

  it('represents a pending request after calling requestSent()', () => {
    const monitor = new NetworkRequestMonitor();
    const peer = new DummyNetworkPeer();
    monitor.requestSent(peer);
    expect(monitor.peer).toBe(peer);
    expect(monitor.settled).toBe(false);
    expect(monitor.timedOut).toBe(false);
    // checking internal timer
    expect((monitor as any).networkRequestTimeout).toBeDefined();
    // cleanup
    monitor.terminated();
  });

  it('times out correctly', async () => {
    const monitor = new NetworkRequestMonitor();
    const peer = new DummyNetworkPeer();
    peer.options.networkTimeoutMillis = 0;  // this peer times out immediately
    monitor.requestSent(peer);
    expect(monitor.peer).toBe(peer);
    expect(monitor.settled).toBe(false);
    expect(monitor.timedOut).toBe(false);
    // checking internal timer
    expect((monitor as any).networkRequestTimeout).toBeDefined();
    // timing out will resolve the monitor's promise
    await monitor.settledPromise;
    expect(monitor.peer).toBe(peer);
    expect(monitor.settled).toBe(true);
    expect(monitor.timedOut).toBe(true);
  });

  it('represents a terminated but not timed out request after calling terminated()', async() => {
    const monitor = new NetworkRequestMonitor();
    const peer = new DummyNetworkPeer();
    monitor.requestSent(peer);
    expect(monitor.peer).toBe(peer);
    expect(monitor.settled).toBe(false);
    expect(monitor.timedOut).toBe(false);

    // mark the request as terminated externally
    monitor.terminated();
    // terminating will resolve the monitor's promise
    await monitor.settledPromise;
    expect(monitor.peer).toBe(peer);
    expect(monitor.settled).toBe(true);
    expect(monitor.timedOut).toBe(false);
  });
});

describe('CubeRequest', () => {
  it.todo('write tests');
});

describe('SubscriptionRequest', () => {
  it.todo('write tests');
});
