/**
 * Playwright utilities for real browser testing of Verity nodes
 * 
 * This module provides utilities to test Verity functionality in real browser environments
 * using Playwright, including IndexedDB, WebRTC, and full browser APIs.
 */

import { Page, BrowserContext, expect } from '@playwright/test';

export interface NodeTestResult {
  success: boolean;
  nodeId?: string;
  error?: string;
  cubeCount?: number;
}

export interface CubeCreationResult {
  success: boolean;
  cubeKey?: string;
  error?: string;
  keyHex?: string;
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
  await page.evaluate(() => {
    try {
      const node = window.verity.node;
      if (node) {
        console.log('Applying test optimizations for faster execution...');
        
        // Enable in-memory mode if possible (equivalent to inMemory: true)
        if (node.cubeStore && typeof node.cubeStore.setInMemoryMode === 'function') {
          node.cubeStore.setInMemoryMode(true);
        }
        
        // Reduce timeouts for faster testing
        if (node.networkManager) {
          // Set shorter network timeouts
          if (node.networkManager.defaultTimeout !== undefined) {
            node.networkManager.defaultTimeout = 100;
          }
          
          // Disable external services for faster operation
          if (node.networkManager.announceToTorrentTrackers !== undefined) {
            node.networkManager.announceToTorrentTrackers = false;
          }
        }
        
        // Set cube operations to use minimal difficulty 
        if (node.setRequiredDifficulty) {
          node.setRequiredDifficulty(0);
        } else if (node.requiredDifficulty !== undefined) {
          node.requiredDifficulty = 0;
        }
        
        console.log('Test optimizations applied successfully');
      }
    } catch (error) {
      // Test optimizations are best effort - log but don't fail tests
      console.log('Test optimizations partially applied:', error.message);
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
  return await page.evaluate(async (content) => {
    try {
      if (!window.verity?.node?.cubeStore) {
        return { success: false, error: 'Verity node or cubeStore not available' };
      }
      
      const node = window.verity.node;
      const cubeStore = node.cubeStore;
      
      // Check if cockpit is available (for full implementations)
      if (window.verity.cockpit && window.verity.VerityField) {
        const cockpit = window.verity.cockpit;
        const VerityField = window.verity.VerityField;
        const nodeId = node.networkManager?.idString || 'unknown';
        
        // Get initial count
        const initialCount = await cubeStore.getNumberOfStoredCubes();
        
        // Add unique content to ensure different cubes are created
        const uniqueContent = content || `Test cube from ${nodeId} at ${Date.now()}-${Math.random()}`;
        
        // Create a veritum with unique content for semantic meaningfulness
        const payloadField = VerityField.Payload(uniqueContent);
        const veritum = cockpit.prepareVeritum({
          fields: payloadField
        });
        
        // Compile the veritum
        await veritum.compile();
        
        // Get the compiled cubes
        const cubes = Array.from(veritum.chunks);
        if (cubes.length === 0) {
          return { success: false, error: 'No cubes generated from veritum' };
        }
        
        const cube = cubes[0];
        
        // Get the cube key before adding to store
        const key = await cube.getKey();
        
        // Check if cube already exists
        const alreadyExists = await cubeStore.hasCube(key);
        if (alreadyExists) {
          return { 
            success: false, 
            error: 'Cube with this key already exists (duplicate key generated)',
            cubeKey: key,
            keyHex: key.toString('hex').substring(0, 32) + '...'
          };
        }
        
        // Add to the cube store
        await cubeStore.addCube(cube);
        
        // Verify it was actually stored
        const finalCount = await cubeStore.getNumberOfStoredCubes();
        const wasStored = finalCount > initialCount;
        
        if (!wasStored) {
          return {
            success: false,
            error: 'Cube was not stored successfully (storage failed)',
            cubeKey: key,
            keyHex: key.toString('hex').substring(0, 32) + '...'
          };
        }
        
        return {
          success: true,
          cubeKey: key,
          keyHex: key.toString('hex').substring(0, 32) + '...'
        };
      } else {
        // Fallback for test environments without full cockpit - use test utilities
        if (window.verity.testUtils && window.verity.testUtils.createTestCube) {
          const result = await window.verity.testUtils.createTestCube(content);
          return {
            success: result.success || false,
            error: result.error || (result.success ? undefined : 'Test cube creation failed'),
            cubeKey: result.cubeKey || undefined,
            keyHex: result.keyHex || result.cubeKey
          };
        } else {
          return { 
            success: false, 
            error: 'Neither cockpit nor test utilities available for cube creation' 
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
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
      if (!window.verity?.node?.cubeStore) {
        return false;
      }
      return await window.verity.node.cubeStore.hasCube(key);
    } catch (error) {
      return false;
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
      pages.map(page => 
        page.waitForFunction(() => {
          return window.verity?.node !== undefined;
        }, { timeout: timeoutMs })
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
  
  for (let i = 0; i < count; i++) {
    // Create unique content including index, timestamp, and random values
    const uniqueId = `${Date.now()}-${Math.random()}-${i}`;
    const result = await createTestCubeInBrowser(page, `Test cube ${i} - ${uniqueId}`);
    results.push(result);
    
    // Add more delay between cube creations to ensure uniqueness
    await page.waitForTimeout(150 + Math.random() * 100);
  }
  
  return results;
}

/**
 * Add global type declarations for browser context
 */
declare global {
  interface Window {
    verity: {
      node: any;
      cockpit: any;
      identityController: any;
      peerController: any;
    };
  }
}

/**
 * Connect a browser node to a test server
 */
export async function connectBrowserNodeToServer(page: Page, serverAddress: string): Promise<{ success: boolean; peerCount: number; error?: string }> {
  return await page.evaluate(async (address) => {
    try {
      const node = window.verity.node;
      if (!node || !node.networkManager) {
        return { success: false, peerCount: 0, error: 'Node or NetworkManager not available' };
      }

      // Parse server address (e.g., "ws://localhost:19000")
      const url = new URL(address);
      const host = url.hostname;
      const port = parseInt(url.port);

      // Need to import the classes for proper connection
      // First check if they're available on the window
      if (!window.verity.Peer || !window.verity.WebSocketAddress) {
        return { success: false, peerCount: 0, error: 'Peer and WebSocketAddress classes not available' };
      }

      // Create proper Peer object with WebSocketAddress
      const wsAddress = new window.verity.WebSocketAddress(host, port);
      const peer = new window.verity.Peer(wsAddress);
      
      // Connect to the test server using the proper Peer object
      const networkPeer = node.networkManager.connect(peer);

      // Wait for connection with timeout
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000);
        
        if (networkPeer.onlinePromise) {
          networkPeer.onlinePromise.then(() => {
            clearTimeout(timeout);
            resolve(true);
          }).catch((error) => {
            clearTimeout(timeout);
            reject(error);
          });
        } else {
          clearTimeout(timeout);
          reject(new Error('NetworkPeer does not have onlinePromise'));
        }
      });

      return {
        success: true,
        peerCount: node.networkManager.onlinePeers.length,
        connectedTo: address
      };
    } catch (error) {
      return { 
        success: false, 
        peerCount: 0, 
        error: error.message 
      };
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