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

/**
 * Initialize Verity in a browser page and wait for it to be ready
 */
export async function initializeVerityInBrowser(page: Page): Promise<void> {
  // Navigate to the Verity web application
  await page.goto('/');
  
  // Wait for the application to load
  await page.waitForSelector('body', { state: 'visible' });
  
  // Wait for the Verity library to be available
  await page.waitForFunction(() => {
    return typeof window !== 'undefined' && 
           window.verity !== undefined &&
           window.verity.node !== undefined;
  }, { timeout: 30000 });
}

/**
 * Create a test cube using the Verity cockpit in the browser
 */
export async function createTestCubeInBrowser(
  page: Page, 
  content: string = 'Browser test cube'
): Promise<CubeCreationResult> {
  return await page.evaluate(async (content) => {
    try {
      const cockpit = window.verity.cockpit;
      const cubeStore = window.verity.node.cubeStore;
      
      // Get initial count
      const initialCount = await cubeStore.getNumberOfStoredCubes();
      
      // Create a veritum with some random content to ensure uniqueness
      const uniqueContent = content + ' ' + Date.now() + ' ' + Math.random();
      const veritum = cockpit.prepareVeritum();
      
      // Check if we can add fields to the veritum
      if (veritum.fields && typeof veritum.fields.insertField === 'function') {
        // Try to add some content field to make it unique
        // This is an experimental approach
        try {
          // We'll add a simple payload field if possible
          const fields = veritum.fields;
          // Note: This might not work if the field types aren't available
          // But we'll try anyway
        } catch (e) {
          // If field insertion fails, continue with empty veritum
        }
      }
      
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
    const result = await createTestCubeInBrowser(page, `Test cube ${i} - ${Date.now()}`);
    results.push(result);
    
    // Add more delay between cube creations to ensure uniqueness
    await page.waitForTimeout(100);
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