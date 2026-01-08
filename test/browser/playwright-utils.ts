/**
 * Playwright utilities for real browser testing of Verity nodes
 *
 * This module provides utilities to test Verity functionality in real browser environments
 * using Playwright, including IndexedDB, WebRTC, and full browser APIs.
 */

import { Page } from '@playwright/test';
// Import library types actually exposed / used
import type { VerityUI } from '../../src/webui/verityUI';
import type { VerityNode } from '../../src/cci/verityNode';
import type { CubeKey } from '../../src/core/cube/coreCube.definitions';
import type { NetworkManagerIf } from '../../src/core/networking/networkManagerIf';
import type { CubeStore } from '../../src/core/cube/cubeStore';
import type { Peer } from '../../src/core/peering/peer';
import type { WebSocketAddress } from '../../src/core/peering/addressing';

export interface NodeTestResult {
  success: boolean;
  nodeId?: string;
  error?: string;
  cubeCount?: number;
}

export interface CubeCreationResult {
  success: boolean;
  cubeKey?: string; // full hex key
  error?: string;
  keyHex?: string; // truncated for logging
}

export interface StagedCubeResult {
  success: boolean;
  cubeKey?: string; // full hex key
  keyHex?: string;  // truncated for logging
  error?: string;
}

/**
 * Stage (sculpt & compile) a cube but do NOT add it to the store yet.
 * Returns its key so another browser can start requesting it prior to publication.
 */
export async function stageTestCubeInBrowser(
  page: Page,
  content: string = 'Staged browser test cube'
): Promise<StagedCubeResult> {
  return await page.evaluate(async (c) => {
    try {
      const g: any = (window as any);
      const Cube = g.verity?.Cube || g.Cube;
      const VerityField = g.verity?.VerityField || g.VerityField || g.verityField;
      if (!Cube || !VerityField) {
        return { success: false, error: 'Cube or VerityField not exposed globally' };
      }
      const payload = `${c} :: ${Date.now()} :: ${Math.random()} :: ${(crypto as any)?.randomUUID?.() ?? Math.random()}`;
      const cube = Cube.Create({
        fields: [VerityField.Payload(payload)],
        requiredDifficulty: 0,
      });
      await cube.getBinaryData(); // compile
      const key = await cube.getKey();
      const hexFull = key.toString('hex');
      g.__stagedCubes = g.__stagedCubes || new Map();
      g.__stagedCubes.set(hexFull, cube);
      return { success: true, cubeKey: hexFull, keyHex: hexFull.slice(0,32)+'...' };
    } catch(e:any) {
      return { success: false, error: e?.message };
    }
  }, content);
}

/**
 * Publish a previously staged cube by key and broadcast its key.
 */
export async function publishStagedCubeInBrowser(page: Page, cubeKey: string): Promise<{ success: boolean; error?: string }> {
  return await page.evaluate(async (key) => {
    try {
      const g: any = (window as any);
      const cubeStore = g.verity?.node?.cubeStore;
      const networkManager = g.verity?.node?.networkManager;
      if (!cubeStore || !networkManager) {
        return { success: false, error: 'cubeStore or networkManager unavailable' };
      }
      const staged = g.__stagedCubes?.get(key);
      if (!staged) return { success: false, error: 'staged cube not found' };
      const added = await cubeStore.addCube(staged);
      if (!added) return { success: false, error: 'addCube returned undefined' };
      try {
        const info = await staged.getCubeInfo();
        if (info) networkManager.broadcastKey([info]);
      } catch {}
      return { success: true };
    } catch(e:any) {
      return { success: false, error: e?.message };
    }
  }, cubeKey);
}

export interface TestServerInfo {
  isRunning: boolean;
  port: number;
  nodeId: string;
  cubeCount: number;
  peerCount: number;
  address: string;
}

/**
 * Initialize Verity in a browser page and wait for it to be ready
 * Automatically applies test optimizations for faster execution (equivalent to testCoreOptions)
 */
export async function initializeVerityInBrowser(page: Page, testApp: string = 'full-node-test.html'): Promise<void> {
  // Navigate to the specific Verity test application
  await page.goto(`/${testApp}`);

  // Wait for the application to load
  await page.waitForSelector('body', { state: 'visible' });

  // Wait for the Verity library to be available
  await page.waitForFunction(() => {
    return typeof window !== 'undefined' &&
           window.verity !== undefined &&
           window.verity.node !== undefined;
  }, { timeout: 30000 });

  // Apply test optimizations for faster execution (equivalent to testCoreOptions)
  await applyTestOptimizations(page);
}

/**
 * Apply test optimizations to browser nodes for faster execution
 * Applies optimizations equivalent to testCoreOptions for browser-based nodes
 */
export async function applyTestOptimizations(page: Page): Promise<void> {
  // Only adjust the existing runtime options that are actually supported.
  await page.evaluate(() => {
    try {
      const ui = window.verity as VerityUI | undefined;
      const node = ui?.node as VerityNode | undefined;
      if (!node) return;
      // Disable announcing (already disabled in browser startup but enforce again)
      if (node.networkManager?.options) {
        node.networkManager.options.announceToTorrentTrackers = false;
        // Lower network timeout to speed up failed lookups in tests
        node.networkManager.options.networkTimeoutMillis = 100;
      }
      // Ensure required difficulty for cube verification is minimal
      if (node.cubeStore?.options) {
        node.cubeStore.options.requiredDifficulty = 0;
      }
      // Turn lightNode on to avoid heavy sync unless tests need otherwise
      if (node.networkManager?.options) {
        node.networkManager.options.lightNode = true;
        node.networkManager.options.autoConnect = false; // we will manually connect
      }
    } catch (err) {
      console.log('applyTestOptimizations warning', (err as any)?.message);
    }
  });
}

/**
 * Create a test cube using the Verity cockpit in the browser with unique content
 */
export async function createTestCubeInBrowser(
  page: Page,
  content: string = 'Browser test cube'
): Promise<CubeCreationResult> {
  return await page.evaluate(async (c) => {
    try {
      const ui = (window as any).verity as any;
      const node = ui?.node;
      const cubeStore: any = node?.cubeStore;
      const networkManager: any = node?.networkManager;
      if (!cubeStore || !networkManager) {
        return { success: false, error: 'cubeStore or networkManager unavailable' };
      }
      const initialCount = await cubeStore.getNumberOfStoredCubes();

  // Access CCI constructors from global bundle (prefer namespaced exports)
  const Cube = (window as any).verity?.Cube || (window as any).Cube;
  const VerityField = (window as any).verity?.VerityField || (window as any).VerityField || (window as any).verityField;
      if (!Cube || !VerityField) {
        return { success: false, error: 'Cube or VerityField not exposed globally' };
      }

      // Generate unique payload (Nonce + Date fields will also add uniqueness)
      const payload = `${c} :: ${Date.now()} :: ${Math.random()} :: ${(crypto as any)?.randomUUID?.() ?? Math.random()}`;

      let cube: any;
      try {
        console.log('[createTestCubeInBrowser] Sculpting CCI cube');
        cube = Cube.Create({
          fields: [VerityField.Payload(payload)],
          requiredDifficulty: 0,
        });
      } catch (e:any) {
        console.error('[createTestCubeInBrowser] Cube.Frozen failed', e?.message);
        return { success: false, error: 'Cube.Frozen failed: ' + e?.message };
      }

      // Compile explicitly to surface errors early
      try {
  // Access binary data to trigger compile (as done in cci tests via getBinaryData())
  await cube.getBinaryData();
      } catch (e:any) {
        console.error('[createTestCubeInBrowser] compile failed', e?.message);
        return { success: false, error: 'compile failed: ' + e?.message };
      }

      // Add cube to store (returns Cube or undefined)
      let addedCube: any;
      try {
        addedCube = await cubeStore.addCube(cube);
      } catch (e:any) {
        console.error('[createTestCubeInBrowser] cubeStore.addCube failed', e?.message);
        return { success: false, error: 'addCube failed: ' + e?.message };
      }
      if (!addedCube) {
        console.warn('[createTestCubeInBrowser] addCube returned undefined');
        return { success: false, error: 'addCube returned undefined' };
      }

      // Broadcast key so other nodes can retrieve it (full nodes only)
      try {
        const cubeInfo = await cube.getCubeInfo();
        if (cubeInfo) networkManager.broadcastKey([cubeInfo]);
      } catch (e:any) {
        // Not fatal for local success; just log
        console.warn('[createTestCubeInBrowser] broadcastKey failed', e?.message);
      }

      // Validate presence & count increment
      let key: any; let hexFull: string;
      try { key = await cube.getKey(); hexFull = key.toString('hex'); } catch (e:any) {
        return { success: false, error: 'getKey failed: ' + e?.message };
      }
      const hasCube = await cubeStore.hasCube(key);
      const finalCount = await cubeStore.getNumberOfStoredCubes();
      if (!hasCube) {
        console.error('[createTestCubeInBrowser] cube missing after add', { initialCount, finalCount });
        return { success: false, error: 'Cube missing after add', cubeKey: hexFull, keyHex: hexFull.slice(0,32)+'...' };
      }
      if (finalCount < initialCount + 1) {
        console.warn('[createTestCubeInBrowser] cube count did not increase', { initialCount, finalCount });
      }
      return { success: true, cubeKey: hexFull, keyHex: hexFull.slice(0,32)+'...' };
    } catch (e:any) {
      console.error('[createTestCubeInBrowser] error', e?.message);
      return { success: false, error: e?.message };
    }
  }, content);
}

/**
 * Get the number of stored cubes in the browser node
 */
export async function getCubeCountFromBrowser(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    if (!window.verity?.node?.cubeStore) {
      return 0;
    }
    return await window.verity.node.cubeStore.getNumberOfStoredCubes();
  });
}

/**
 * Get browser node ID
 */
export async function getBrowserNodeId(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    if (!window.verity?.node?.networkManager) {
      return null;
    }
    return window.verity.node.networkManager.idString;
  });
}

/**
 * Check if browser APIs are available
 */
export async function checkBrowserAPIs(page: Page): Promise<{
  indexedDB: boolean;
  crypto: boolean;
  webRTC: boolean;
  localStorage: boolean;
}> {
  return await page.evaluate(() => {
    return {
      indexedDB: typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function',
      crypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
      webRTC: typeof RTCPeerConnection !== 'undefined',
      localStorage: typeof localStorage !== 'undefined'
    };
  });
}

/**
 * Check if a cube exists in the browser node's cube store
 */
export async function hasCubeInBrowser(page: Page, cubeKey: string): Promise<boolean> {
  return await page.evaluate(async (key) => {
    try {
      const ui = window.verity as VerityUI | undefined;
      const store = ui?.node?.cubeStore as CubeStore | undefined;
      if (!store) return false;
      // Convert hex string back to Buffer
      const buf = Buffer.from(key, 'hex');
      const exists = await store.hasCube(buf as unknown as CubeKey);
      if (!exists) {
        const count = await store.getNumberOfStoredCubes();
        console.log('[hasCubeInBrowser] cube missing', { key: key.slice(0,32)+'...', count });
      }
      return exists;
    } catch {
      return false;
    }
  }, cubeKey);
}

/**
 * Strong verification similar to e2e tests: fetch CubeInfo via key (hex) and assert presence.
 */
export async function getCubeInfoFromBrowser(page: Page, cubeKey: string): Promise<{found: boolean; error?: string}> {
  return await page.evaluate(async (key) => {
    try {
      const store = (window as any).verity?.node?.cubeStore;
      if (!store) return { found: false, error: 'cubeStore unavailable' };
      const info = await store.getCubeInfo(key, true);
      if (info) return { found: true };
      // enumerate a few keys for diagnostics
      const iterator: any = store.getKeyRange?.({ limit: 5 });
      const sample: string[] = [];
      if (iterator) {
        for await (const k of iterator) { sample.push(k); if (sample.length >= 5) break; }
      }
      console.log('[getCubeInfoFromBrowser] not found', { key: key.slice(0,32)+'...', sample });
      return { found: false };
    } catch (e:any) {
      return { found: false, error: e?.message };
    }
  }, cubeKey);
}

/**
 * Get detailed node information from the browser
 */
export async function getNodeInfo(page: Page): Promise<any> {
  return await page.evaluate(async () => {
    try {
      const node = window.verity.node;
      return {
        nodeId: node.networkManager.idString,
        cubeCount: await node.cubeStore.getNumberOfStoredCubes(),
        onlinePeers: node.networkManager.onlinePeers.length,
        nodeType: node.constructor.name,
        isReady: !!node.readyPromise,
        transports: node.networkManager.transports ?
          Array.from(node.networkManager.transports.keys()) : []
      };
    } catch (error) {
      return { error: error.message };
    }
  });
}

/**
 * Shutdown browser node gracefully
 */
export async function shutdownBrowserNode(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (window.verity?.node) {
      try {
        await window.verity.node.shutdown();
      } catch (error) {
        console.warn('Browser node shutdown failed:', error);
      }
    }
  });
}

/**
 * Wait for multiple browser nodes to be ready
 */
export async function waitForBrowserNodesReady(
  pages: Page[],
  timeoutMs: number = 30000
): Promise<boolean> {
  try {
    await Promise.all(
      pages.map(p =>
        p.waitForFunction(() => window.verity?.node !== undefined, { timeout: timeoutMs })
      )
    );
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check network connectivity between browser nodes
 * Note: In the current implementation, browser nodes are light nodes
 * and may not directly connect to each other
 */
export async function checkNodeConnectivity(page: Page): Promise<{
  onlinePeers: number;
  networkReady: boolean;
}> {
  return await page.evaluate(() => {
    try {
      const node = window.verity.node;
      return {
        onlinePeers: node.networkManager.onlinePeers.length,
        networkReady: !!node.networkManager
      };
    } catch (error) {
      return { onlinePeers: 0, networkReady: false };
    }
  });
}

/**
 * Create multiple unique test cubes in a browser
 */
export async function createMultipleCubes(
  page: Page,
  count: number
): Promise<CubeCreationResult[]> {
  const results: CubeCreationResult[] = [];
  const createdKeys: string[] = [];

  for (let i = 0; i < count; i++) {
    // Create unique content including index, timestamp, and random values
    const uniqueId = `${Date.now()}-${Math.random()}-${i}`;
    const result = await createTestCubeInBrowser(page, `Test cube ${i} - ${uniqueId}`);
    results.push(result);
  if (result.cubeKey) createdKeys.push(result.cubeKey);

    // Add more delay between cube creations to ensure uniqueness
    await page.waitForTimeout(150 + Math.random() * 100);
  }
  // Allow final stabilization for cubeStore indexing before counts are checked by tests
  await page.waitForTimeout(200);
  console.log('[createMultipleCubes] created', { count: results.length, createdKeys: createdKeys.map(k=>k.slice(0,16)+'...') });

  return results;
}

/**
 * Add global type declarations for browser context
 */
declare global {
  interface Window { verity: VerityUI }
}

/**
 * Connect a browser node to a test server
 */
export async function connectBrowserNodeToServer(page: Page, serverAddress: string): Promise<{ success: boolean; peerCount: number; error?: string }> {
  return await page.evaluate(async (address) => {
    try {
      const ui = window.verity as VerityUI | undefined;
      const node = ui?.node as VerityNode | undefined;
      const nm: NetworkManagerIf | undefined = node?.networkManager;
      if (!nm) return { success: false, peerCount: 0, error: 'NetworkManager unavailable' };
  // Try multiple locations for exported classes (bundle dependent)
  const WebSocketAddress = (window as any).WebSocketAddress || (window as any).verity?.WebSocketAddress;
  const Peer = (window as any).Peer || (window as any).verity?.Peer;
  if (!WebSocketAddress || !Peer) return { success: false, peerCount: 0, error: 'Peer classes not exposed globally' };
      const url = new URL(address);
      const wsAddr: WebSocketAddress = new WebSocketAddress(url.hostname, parseInt(url.port));
      const peer: Peer = new Peer(wsAddr);
      const networkPeer = nm.connect(peer);
      await new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('Timeout connecting peer')), 5000);
        (networkPeer as any).onlinePromise?.then(() => { clearTimeout(to); resolve(); }).catch((e: any)=>{ clearTimeout(to); reject(e); });
      });
      return { success: true, peerCount: nm.onlinePeers.length };
    } catch (e:any) {
      return { success: false, peerCount: 0, error: e?.message };
    }
  }, serverAddress);
}

/**
 * Get connection status of a browser node
 */
export async function getBrowserNodeConnectionStatus(page: Page): Promise<{
  nodeId: string;
  peerCount: number;
  onlinePeers: string[];
  isNetworkReady: boolean;
}> {
  return await page.evaluate(async () => {
    const node = window.verity.node;
    if (!node || !node.networkManager) {
      return {
        nodeId: 'unknown',
        peerCount: 0,
        onlinePeers: [],
        isNetworkReady: false
      };
    }

    const onlinePeers = node.networkManager.onlinePeers.map(peer =>
      peer.idString ? peer.idString.substring(0, 16) + '...' : 'unknown'
    );

    return {
      nodeId: node.networkManager.idString.substring(0, 16) + '...',
      peerCount: node.networkManager.onlinePeers.length,
      onlinePeers,
      isNetworkReady: node.networkManager.online
    };
  });
}

/**
 * Wait for a browser node to be network ready with retry logic
 */
export async function waitForNetworkReady(page: Page, timeoutMs: number = 15000): Promise<{
  nodeId: string;
  peerCount: number;
  onlinePeers: string[];
  isNetworkReady: boolean;
}> {
  const startTime = Date.now();
  let lastStatus = null;

  while (Date.now() - startTime < timeoutMs) {
    const status = await getBrowserNodeConnectionStatus(page);
    lastStatus = status;

    console.log(`waitForNetworkReady check: isReady=${status.isNetworkReady}, peers=${status.peerCount}, elapsed=${Date.now() - startTime}ms`);

    if (status.isNetworkReady && status.peerCount > 0) {
      console.log(`Network ready achieved in ${Date.now() - startTime}ms`);
      return status;
    }

    // Wait a bit before checking again
    await page.waitForTimeout(300);
  }

  console.warn(`waitForNetworkReady timeout after ${timeoutMs}ms. Final status:`, lastStatus);
  // Return final status even if not ready (for debugging)
  return lastStatus || await getBrowserNodeConnectionStatus(page);
}

/**
 * Request a cube from the network (real cube retrieval)
 */
export async function requestCubeFromNetwork(page: Page, cubeKey: string): Promise<{ success: boolean; found: boolean; error?: string }> {
  return await page.evaluate(async (key) => {
    try {
      const node = window.verity.node;
      if (!node) {
        return { success: false, found: false, error: 'Node not available' };
      }

      // Check if cube exists locally first
      const hasLocally = await node.cubeStore.hasCube(key);
      if (hasLocally) {
        return { success: true, found: true };
      }

      // Attempt to retrieve from network
      if (node.cubeRetriever) {
        try {
          const cube = await node.cubeRetriever.getCube(key);
          return { success: true, found: !!cube };
        } catch (error) {
          return { success: true, found: false, error: 'Cube not found in network' };
        }
      }

      return { success: false, found: false, error: 'CubeRetriever not available' };
    } catch (error) {
      return { success: false, found: false, error: error.message };
    }
  }, cubeKey);
}

/**
 * Poll until a cube with the given hex key is present locally (or retrieved successfully) or timeout.
 * Mirrors core e2e requestCube pattern by actively requesting the cube if missing.
 */
export async function waitForCubeDelivery(
  page: Page,
  cubeKey: string,
  timeoutMs: number = 8000,
  intervalMs: number = 300
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await requestCubeFromNetwork(page, cubeKey);
    if (result.found) return true;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}