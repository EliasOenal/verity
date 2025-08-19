import { test, expect } from '@playwright/test';
import { 
  initializeVerityInBrowser, 
  checkBrowserAPIs, 
  getNodeInfo, 
  shutdownBrowserNode 
} from './playwright-utils';

test.describe('Verity Browser Environment (Real Browser)', () => {
  
  test.afterEach(async ({ page }) => {
    // Clean shutdown after each test
    await shutdownBrowserNode(page);
  });

  test('should load Verity web application', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the page to load
    await page.waitForSelector('body', { state: 'visible' });
    
    // Check that the page title is correct
    await expect(page).toHaveTitle('Verity');
    
    // Check for essential page elements
    await expect(page.locator('#veralogo')).toBeVisible();
    await expect(page.locator('#verityLeftnav')).toBeVisible();
    await expect(page.locator('#verityContentArea')).toBeVisible();
  });

  test('should have access to browser-specific APIs', async ({ page }) => {
    await page.goto('/');
    
    const apis = await checkBrowserAPIs(page);
    
    // Verify browser APIs are available
    expect(apis.indexedDB).toBe(true);
    expect(apis.crypto).toBe(true);
    expect(apis.webRTC).toBe(true);
    expect(apis.localStorage).toBe(true);
  });

  test('should have Verity node available and running', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const nodeInfo = await getNodeInfo(page);
    
    expect(nodeInfo.error).toBeUndefined();
    expect(nodeInfo.nodeId).toBeDefined();
    expect(nodeInfo.nodeType).toBe('VerityNode');
    expect(nodeInfo.cubeCount).toBeGreaterThanOrEqual(0);
    expect(nodeInfo.isReady).toBe(true);
    
    console.log('Node info:', nodeInfo);
  });

  test('should verify browser-specific Verity configuration', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const config = await page.evaluate(() => {
      const node = window.verity.node;
      return {
        hasNetworkManager: !!node.networkManager,
        hasCubeStore: !!node.cubeStore,
        hasPeerDB: !!node.peerDB,
        transports: node.networkManager?.transports ? 
          Array.from(node.networkManager.transports.keys()) : [],
        isLightNode: true, // Browser nodes are typically light nodes
      };
    });
    
    expect(config.hasNetworkManager).toBe(true);
    expect(config.hasCubeStore).toBe(true);
    expect(config.hasPeerDB).toBe(true);
    expect(config.transports).toBeDefined();
    
    console.log('Browser node configuration:', config);
  });

  test('should handle page refresh and node reinitialization', async ({ page }) => {
    // Initialize Verity
    await initializeVerityInBrowser(page);
    const firstNodeId = await page.evaluate(() => window.verity.node.networkManager.idString);
    
    // Refresh the page
    await page.reload();
    
    // Reinitialize and verify new node
    await initializeVerityInBrowser(page);
    const secondNodeId = await page.evaluate(() => window.verity.node.networkManager.idString);
    
    // After refresh, we should get a new node with different ID
    expect(secondNodeId).toBeDefined();
    expect(secondNodeId).not.toBe(firstNodeId);
  });

  test('should verify IndexedDB storage functionality', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    // Test IndexedDB operations
    const indexedDBTest = await page.evaluate(async () => {
      try {
        // Test basic IndexedDB operations
        const dbName = 'verity-test-db';
        const request = indexedDB.open(dbName, 1);
        
        return new Promise((resolve) => {
          request.onsuccess = () => {
            const db = request.result;
            db.close();
            // Clean up
            indexedDB.deleteDatabase(dbName);
            resolve({ success: true });
          };
          
          request.onerror = () => {
            resolve({ success: false, error: request.error?.message });
          };
          
          request.onupgradeneeded = (event) => {
            const db = (event.target as any).result;
            db.createObjectStore('testStore', { keyPath: 'id' });
          };
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(indexedDBTest.success).toBe(true);
  });

  test('should verify WebRTC capabilities', async ({ page }) => {
    await page.goto('/');
    
    const webRTCTest = await page.evaluate(async () => {
      try {
        // Test basic WebRTC functionality
        const pc = new RTCPeerConnection();
        const hasCreateDataChannel = typeof pc.createDataChannel === 'function';
        const hasCreateOffer = typeof pc.createOffer === 'function';
        
        pc.close();
        
        return {
          hasRTCPeerConnection: true,
          hasCreateDataChannel,
          hasCreateOffer
        };
      } catch (error) {
        return { error: error.message };
      }
    });
    
    expect(webRTCTest.hasRTCPeerConnection).toBe(true);
    expect(webRTCTest.hasCreateDataChannel).toBe(true);
    expect(webRTCTest.hasCreateOffer).toBe(true);
  });
});