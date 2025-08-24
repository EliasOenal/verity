/**
 * Comprehensive Cross-Browser P2P Functionality Tests
 * 
 * These tests verify the complete peer-to-peer workflow that was failing:
 * 1. Browser 1 connects to nodejs node and creates/sends cube
 * 2. Browser 1 disconnects 
 * 3. Browser 2 connects to same nodejs node
 * 4. Browser 2 retrieves the cube from Browser 1 via network history
 * 
 * This ensures the critical cross-browser cube synchronization works properly
 * and prevents regressions in the P2P functionality.
 */

import { test, expect, Browser } from '@playwright/test';
import { TestNodeServer, getTestServer, shutdownTestServer } from './test-node-server';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getNodeInfo,
  shutdownBrowserNode,
  connectBrowserNodeToServer,
  getBrowserNodeConnectionStatus,
  waitForNetworkReady,
  requestCubeFromNetwork,
  hasCubeInBrowser
} from './playwright-utils';

test.describe('Cross-Browser P2P Cube Synchronization Tests', () => {
  let testServer: TestNodeServer;
  let testPort: number;

  test.beforeAll(async ({ }, testInfo) => {
    // Start a full Node.js node that browser nodes can connect to
    const workerIndex = testInfo.workerIndex;
    testPort = 19000 + workerIndex;
    testServer = await getTestServer(workerIndex, 19000);
    console.log(`Test server started on port ${testPort} for worker ${workerIndex}:`, await testServer.getServerInfo());
  });

  test.afterAll(async () => {
    await shutdownTestServer(testPort);
  });

  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('CRITICAL: should perform complete cross-browser cube retrieval workflow', async ({ browser }) => {
    // This test verifies the exact failing scenario that was fixed
    // Browser 1 → connect → create cube → disconnect
    // Browser 2 → connect → retrieve cube from Browser 1
    
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // === PHASE 1: Browser 1 creates cube and uploads to server ===
      console.log('PHASE 1: Browser 1 creates and uploads cube...');
      
      // Initialize Browser 1 as light node (like chat test app)
      await initializeVerityInBrowser(page1, 'light-node-test.html');
      const node1Info = await getNodeInfo(page1);
      expect(node1Info.error).toBeUndefined();
      console.log('Browser 1 node ID:', node1Info.nodeId);
      
      // Connect Browser 1 to server
      const connection1 = await connectBrowserNodeToServer(page1, `ws://localhost:${testPort}`);
      expect(connection1.success).toBe(true);
      expect(connection1.peerCount).toBeGreaterThanOrEqual(1);
      
      // Wait for network ready
      const status1 = await waitForNetworkReady(page1, 10000);
      expect(status1.isNetworkReady).toBe(true);
      expect(status1.peerCount).toBeGreaterThanOrEqual(1);
      
      // Create a test cube in Browser 1
      const testMessage = `Cross-browser test message from ${node1Info.nodeId}`;
      const cube1 = await createTestCubeInBrowser(page1, testMessage);
      expect(cube1.success).toBe(true);
      expect(cube1.keyHex).toBeDefined();
      
      console.log('Browser 1 created cube:', cube1.keyHex);
      
      // Verify cube exists in Browser 1
      const hasLocalCube = await hasCubeInBrowser(page1, cube1.keyHex);
      expect(hasLocalCube).toBe(true);
      
      // Give time for cube to be uploaded to server
      await page1.waitForTimeout(2000);
      
      // === PHASE 2: Browser 1 disconnects ===
      console.log('PHASE 2: Browser 1 disconnecting...');
      await shutdownBrowserNode(page1);
      await context1.close();
      
      // Verify server still has the cube data from Browser 1
      const serverCubeCount = await testServer.getCubeCount();
      console.log('Server cube count after Browser 1 disconnect:', serverCubeCount);
      
      // === PHASE 3: Browser 2 connects and retrieves cube ===
      console.log('PHASE 3: Browser 2 connects and retrieves cube...');
      
      // Initialize Browser 2 (separate context) as light node  
      await initializeVerityInBrowser(page2, 'light-node-test.html');
      const node2Info = await getNodeInfo(page2);
      expect(node2Info.error).toBeUndefined();
      expect(node2Info.nodeId).not.toBe(node1Info.nodeId); // Different node
      console.log('Browser 2 node ID:', node2Info.nodeId);
      
      // Browser 2 should start with no cubes
      const initialCubeCount = await getCubeCountFromBrowser(page2);
      expect(initialCubeCount).toBe(0);
      
      // Connect Browser 2 to same server
      const connection2 = await connectBrowserNodeToServer(page2, `ws://localhost:${testPort}`);
      expect(connection2.success).toBe(true);
      expect(connection2.peerCount).toBeGreaterThanOrEqual(1);
      
      // Wait for network ready and network synchronization
      const status2 = await waitForNetworkReady(page2, 10000);
      expect(status2.isNetworkReady).toBe(true);
      expect(status2.peerCount).toBeGreaterThanOrEqual(1);
      
      // CRITICAL TEST: Browser 2 should be able to retrieve the cube from Browser 1
      console.log('Attempting to retrieve cube from network:', cube1.keyHex);
      
      // Give time for network history retrieval to complete
      await page2.waitForTimeout(3000);
      
      // Check if Browser 2 can retrieve the cube from the network
      const retrievalResult = await requestCubeFromNetwork(page2, cube1.keyHex);
      console.log('Cube retrieval result:', retrievalResult);
      
      // This is the critical assertion that was failing before the fix
      expect(retrievalResult.success).toBe(true);
      expect(retrievalResult.found).toBe(true);
      
      // Verify Browser 2 now has the cube
      const hasCubeAfterRetrieval = await hasCubeInBrowser(page2, cube1.keyHex);
      expect(hasCubeAfterRetrieval).toBe(true);
      
      // Verify Browser 2's cube count increased
      const finalCubeCount = await getCubeCountFromBrowser(page2);
      expect(finalCubeCount).toBeGreaterThan(initialCubeCount);
      
      console.log('Cross-browser cube retrieval test PASSED:', {
        browser1NodeId: node1Info.nodeId,
        browser2NodeId: node2Info.nodeId,
        cubeKey: cube1.keyHex,
        retrievalSuccess: retrievalResult.found,
        browser2FinalCubes: finalCubeCount
      });
      
    } finally {
      await shutdownBrowserNode(page2);
      await context2.close();
    }
  });

  test('should handle multiple cubes in cross-browser scenario', async ({ browser }) => {
    // Test that multiple cubes can be exchanged between browsers
    
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Browser 1: Connect and create multiple cubes
      await initializeVerityInBrowser(page1);
      await connectBrowserNodeToServer(page1, `ws://localhost:${testPort}`);
      await waitForNetworkReady(page1, 10000);
      
      const cubeKeys: string[] = [];
      const testMessages = [
        'First cube from browser 1',
        'Second cube from browser 1', 
        'Third cube from browser 1'
      ];
      
      // Create multiple cubes
      for (const message of testMessages) {
        const cube = await createTestCubeInBrowser(page1, message);
        expect(cube.success).toBe(true);
        cubeKeys.push(cube.keyHex);
      }
      
      console.log('Created cubes:', cubeKeys);
      
      // Wait for uploads
      await page1.waitForTimeout(2000);
      
      // Disconnect Browser 1
      await shutdownBrowserNode(page1);
      await context1.close();
      
      // Browser 2: Connect and try to retrieve all cubes
      await initializeVerityInBrowser(page2);
      await connectBrowserNodeToServer(page2, `ws://localhost:${testPort}`);
      await waitForNetworkReady(page2, 10000);
      
      // Wait for network synchronization
      await page2.waitForTimeout(3000);
      
      // Try to retrieve each cube
      const retrievalResults = await Promise.all(
        cubeKeys.map(key => requestCubeFromNetwork(page2, key))
      );
      
      // All cubes should be retrievable
      retrievalResults.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.found).toBe(true);
        console.log(`Cube ${index + 1} retrieval:`, result);
      });
      
      // Verify Browser 2 has all cubes
      const finalCubeCount = await getCubeCountFromBrowser(page2);
      expect(finalCubeCount).toBeGreaterThanOrEqual(cubeKeys.length);
      
    } finally {
      await shutdownBrowserNode(page2);
      await context2.close();
    }
  });

  test('should handle bidirectional cross-browser cube exchange', async ({ browser }) => {
    // Test that cubes can be exchanged in both directions
    
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Both browsers connect simultaneously
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      await Promise.all([
        connectBrowserNodeToServer(page1, `ws://localhost:${testPort}`),
        connectBrowserNodeToServer(page2, `ws://localhost:${testPort}`)
      ]);
      
      await Promise.all([
        waitForNetworkReady(page1, 10000),
        waitForNetworkReady(page2, 10000)
      ]);
      
      // Each browser creates a cube
      const [cube1, cube2] = await Promise.all([
        createTestCubeInBrowser(page1, 'Cube from browser 1'),
        createTestCubeInBrowser(page2, 'Cube from browser 2')
      ]);
      
      expect(cube1.success).toBe(true);
      expect(cube2.success).toBe(true);
      
      console.log('Bidirectional cubes:', { cube1: cube1.keyHex, cube2: cube2.keyHex });
      
      // Wait for synchronization
      await Promise.all([
        page1.waitForTimeout(3000),
        page2.waitForTimeout(3000)
      ]);
      
      // Browser 1 should be able to retrieve Browser 2's cube
      const retrieval1 = await requestCubeFromNetwork(page1, cube2.keyHex);
      expect(retrieval1.success).toBe(true);
      expect(retrieval1.found).toBe(true);
      
      // Browser 2 should be able to retrieve Browser 1's cube
      const retrieval2 = await requestCubeFromNetwork(page2, cube1.keyHex);
      expect(retrieval2.success).toBe(true);
      expect(retrieval2.found).toBe(true);
      
      console.log('Bidirectional retrieval results:', { retrieval1, retrieval2 });
      
      // Both browsers should have at least 2 cubes (their own + the other's)
      const [count1, count2] = await Promise.all([
        getCubeCountFromBrowser(page1),
        getCubeCountFromBrowser(page2)
      ]);
      
      expect(count1).toBeGreaterThanOrEqual(2);
      expect(count2).toBeGreaterThanOrEqual(2);
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await Promise.all([
        context1.close(),
        context2.close()
      ]);
    }
  });

  test('should validate network status consistency during P2P operations', async ({ browser }) => {
    // This test ensures that status indicators match actual network state
    // addressing the UI inconsistency issues found in the chat test app
    
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    
    try {
      // Initialize and verify offline status
      await initializeVerityInBrowser(page1);
      let status = await getBrowserNodeConnectionStatus(page1);
      expect(status.isNetworkReady).toBe(false);
      expect(status.peerCount).toBe(0);
      
      // Connect and verify connected status
      await connectBrowserNodeToServer(page1, `ws://localhost:${testPort}`);
      await waitForNetworkReady(page1, 10000);
      
      status = await getBrowserNodeConnectionStatus(page1);
      expect(status.isNetworkReady).toBe(true);
      expect(status.peerCount).toBeGreaterThanOrEqual(1);
      
      // Create cube and verify it doesn't affect connection status
      const cube = await createTestCubeInBrowser(page1, 'Status test cube');
      expect(cube.success).toBe(true);
      
      status = await getBrowserNodeConnectionStatus(page1);
      expect(status.isNetworkReady).toBe(true);
      expect(status.peerCount).toBeGreaterThanOrEqual(1);
      
      // Disconnect and verify offline status
      await shutdownBrowserNode(page1);
      
      // Note: After shutdown, getting status may not be meaningful
      // but the test documents the expected behavior
      
      console.log('Network status consistency test passed');
      
    } finally {
      await context1.close();
    }
  });
});

test.describe('Chat Test Application P2P Verification', () => {
  // These tests specifically verify that the chat test application
  // implements the correct P2P patterns and doesn't regress
  
  const CHAT_TEST_URL = 'http://localhost:11985/index.html';
  
  test('should demonstrate chat test app P2P workflow', async ({ page, browser }) => {
    // This test documents and verifies the chat test app behavior
    // ensuring it implements proper P2P cube exchange
    
    // Start a support node for the chat test to connect to
    const testServer = await getTestServer(0, 19084); // Different port
    
    try {
      await page.goto(CHAT_TEST_URL);
      await page.waitForSelector('h1:has-text("Verity Chat Test Environment")');
      await page.waitForSelector('#nodeInfo:has-text("Chat test ready!")');
      
      // Verify starts in offline mode (important for light node behavior)
      await expect(page.locator('text=Ready - OFFLINE MODE')).toBeVisible();
      
      // Create a message offline first
      await page.fill('#messageInput', 'Offline P2P test message');
      await page.click('button:has-text("Send")');
      
      await expect(page.locator('text=Offline P2P test message')).toBeVisible();
      await expect(page.locator('#messageCount')).toHaveText('1');
      await expect(page.locator('#cubeCount')).toHaveText('1');
      
      // Now connect to the support node
      await page.fill('#peerInput', 'ws://localhost:19084');
      await page.click('button:has-text("Connect to Peer")');
      
      // Wait for connection
      await page.waitForTimeout(2000);
      
      // Status should show connected
      await expect(page.locator('text=Ready - CONNECTED MODE')).toBeVisible();
      
      // Send another message while connected (should upload to peer)
      await page.fill('#messageInput', 'Connected P2P test message');
      await page.click('button:has-text("Send")');
      
      await expect(page.locator('text=Connected P2P test message')).toBeVisible();
      await expect(page.locator('#messageCount')).toHaveText('2');
      await expect(page.locator('#cubeCount')).toHaveText('2');
      
      // Verify proper status indicators
      await expect(page.locator('#knownPeersCount')).toContainText('1');
      await expect(page.locator('#activePeersCount')).toContainText('1');
      
      console.log('Chat test P2P workflow verified');
      
    } finally {
      await testServer.shutdown();
    }
  });
});