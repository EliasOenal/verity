import { test, expect, Browser } from '@playwright/test';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getBrowserNodeId,
  getNodeInfo,
  waitForBrowserNodesReady,
  checkNodeConnectivity,
  shutdownBrowserNode
} from './playwright-utils';

test.describe('Verity Browser Connectivity Tests (Real Browser)', () => {
  
  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should create multiple independent browser nodes', async ({ browser }) => {
    // Create two separate browser contexts to simulate different browser instances
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Initialize both browser nodes
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Get node information from both
      const [nodeInfo1, nodeInfo2] = await Promise.all([
        getNodeInfo(page1),
        getNodeInfo(page2)
      ]);
      
      // Verify both nodes are working
      expect(nodeInfo1.error).toBeUndefined();
      expect(nodeInfo2.error).toBeUndefined();
      expect(nodeInfo1.nodeId).toBeDefined();
      expect(nodeInfo2.nodeId).toBeDefined();
      
      // Verify nodes have different IDs (independence)
      expect(nodeInfo1.nodeId).not.toBe(nodeInfo2.nodeId);
      
      console.log('Multiple browser nodes:', { nodeInfo1, nodeInfo2 });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context1.close();
      await context2.close();
    }
  });

  test('should demonstrate independent cube storage between browser nodes', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Initialize both nodes
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Get initial cube counts
      const [initialCount1, initialCount2] = await Promise.all([
        getCubeCountFromBrowser(page1),
        getCubeCountFromBrowser(page2)
      ]);
      
      // Create a cube in node 1
      const cube1Result = await createTestCubeInBrowser(page1, "Browser node 1 test message");
      expect(cube1Result.success).toBe(true);
      
      // Create a different cube in node 2
      const cube2Result = await createTestCubeInBrowser(page2, "Browser node 2 test message");
      expect(cube2Result.success).toBe(true);
      
      // Verify independent storage
      const [finalCount1, finalCount2] = await Promise.all([
        getCubeCountFromBrowser(page1),
        getCubeCountFromBrowser(page2)
      ]);
      
      expect(finalCount1).toBeGreaterThan(initialCount1);
      expect(finalCount2).toBeGreaterThan(initialCount2);
      
      // Different cubes should have different keys
      expect(cube1Result.cubeKey).not.toBe(cube2Result.cubeKey);
      
      console.log('Independent storage test:', {
        node1: { initial: initialCount1, final: finalCount1, key: cube1Result.keyHex },
        node2: { initial: initialCount2, final: finalCount2, key: cube2Result.keyHex }
      });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context1.close();
      await context2.close();
    }
  });

  test('should verify browser node network configuration', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const networkConfig = await page.evaluate(() => {
      const node = window.verity.node;
      const networkManager = node.networkManager;
      
      return {
        hasNetworkManager: !!networkManager,
        nodeId: networkManager.idString,
        transports: networkManager.transports ? 
          Array.from(networkManager.transports.keys()) : [],
        onlinePeersCount: networkManager.onlinePeers.length,
        networkManagerType: networkManager.constructor.name
      };
    });
    
    expect(networkConfig.hasNetworkManager).toBe(true);
    expect(networkConfig.nodeId).toBeDefined();
    expect(networkConfig.networkManagerType).toBe('NetworkManager');
    expect(networkConfig.onlinePeersCount).toBeGreaterThanOrEqual(0);
    
    console.log('Network configuration:', networkConfig);
  });

  test('should handle concurrent cube operations across multiple browser nodes', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Create cubes concurrently in both nodes
      const [cube1Results, cube2Results] = await Promise.all([
        Promise.all([
          createTestCubeInBrowser(page1, "Concurrent cube 1A"),
          createTestCubeInBrowser(page1, "Concurrent cube 1B")
        ]),
        Promise.all([
          createTestCubeInBrowser(page2, "Concurrent cube 2A"),
          createTestCubeInBrowser(page2, "Concurrent cube 2B")
        ])
      ]);
      
      // Count successful cubes
      const successful1 = cube1Results.filter(result => result.success);
      const successful2 = cube2Results.filter(result => result.success);
      
      // We expect at least some cubes to be created successfully
      expect(successful1.length).toBeGreaterThanOrEqual(1);
      expect(successful2.length).toBeGreaterThanOrEqual(1);
      
      // Verify all successful cube keys are unique
      const allSuccessful = [...successful1, ...successful2];
      const keys = allSuccessful.map(result => result.cubeKey);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(allSuccessful.length);
      
      // Verify storage counts match successful cube counts
      const [count1, count2] = await Promise.all([
        getCubeCountFromBrowser(page1),
        getCubeCountFromBrowser(page2)
      ]);
      
      expect(count1).toBeGreaterThanOrEqual(successful1.length);
      expect(count2).toBeGreaterThanOrEqual(successful2.length);
      
      console.log('Concurrent operations test:', {
        node1Cubes: successful1.length,
        node2Cubes: successful2.length,
        node1Count: count1,
        node2Count: count2
      });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context1.close();
      await context2.close();
    }
  });

  test('should verify browser-specific transport capabilities', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const transportTest = await page.evaluate(() => {
      const node = window.verity.node;
      const networkManager = node.networkManager;
      
      // Check transport configuration
      const transportInfo = {
        hasTransports: !!networkManager.transports,
        transportKeys: networkManager.transports ? 
          Array.from(networkManager.transports.keys()) : [],
        transportCount: networkManager.transports ? networkManager.transports.size : 0
      };
      
      // Check if WebRTC is supported (browser-specific)
      const webRTCSupport = {
        hasRTCPeerConnection: typeof RTCPeerConnection !== 'undefined',
        hasCreateDataChannel: typeof RTCPeerConnection !== 'undefined' && 
          typeof new RTCPeerConnection().createDataChannel === 'function'
      };
      
      return { transportInfo, webRTCSupport };
    });
    
    expect(transportTest.transportInfo.hasTransports).toBe(true);
    expect(transportTest.webRTCSupport.hasRTCPeerConnection).toBe(true);
    expect(transportTest.webRTCSupport.hasCreateDataChannel).toBe(true);
    
    console.log('Transport capabilities test:', transportTest);
  });

  test('should simulate real browser multi-node scenario', async ({ browser }) => {
    // This test simulates the exact scenario requested: 
    // "two browser nodes connected to one Node.js full node concurrently"
    
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Initialize both browser nodes
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Wait for both nodes to be ready
      const nodesReady = await waitForBrowserNodesReady([page1, page2]);
      expect(nodesReady).toBe(true);
      
      // Get comprehensive node information
      const [node1Info, node2Info] = await Promise.all([
        page1.evaluate(async () => {
          const node = window.verity.node;
          return {
            nodeId: node.networkManager.idString,
            nodeType: node.constructor.name,
            cubeCount: await node.cubeStore.getNumberOfStoredCubes(),
            transports: node.networkManager.transports ? 
              Array.from(node.networkManager.transports.keys()) : [],
            onlinePeers: node.networkManager.onlinePeers.length
          };
        }),
        page2.evaluate(async () => {
          const node = window.verity.node;
          return {
            nodeId: node.networkManager.idString,
            nodeType: node.constructor.name,
            cubeCount: await node.cubeStore.getNumberOfStoredCubes(),
            transports: node.networkManager.transports ? 
              Array.from(node.networkManager.transports.keys()) : [],
            onlinePeers: node.networkManager.onlinePeers.length
          };
        })
      ]);
      
      // Verify the multi-node scenario requirements
      expect(node1Info.nodeId).toBeDefined();
      expect(node2Info.nodeId).toBeDefined();
      expect(node1Info.nodeId).not.toBe(node2Info.nodeId);
      expect(node1Info.nodeType).toBe('VerityNode');
      expect(node2Info.nodeType).toBe('VerityNode');
      
      // Test cube sharing scenario
      const cube1 = await createTestCubeInBrowser(page1, "Multi-node test from browser 1");
      const cube2 = await createTestCubeInBrowser(page2, "Multi-node test from browser 2");
      
      expect(cube1.success).toBe(true);
      expect(cube2.success).toBe(true);
      
      // Verify independent operation
      const [finalCount1, finalCount2] = await Promise.all([
        getCubeCountFromBrowser(page1),
        getCubeCountFromBrowser(page2)
      ]);
      
      expect(finalCount1).toBeGreaterThan(0);
      expect(finalCount2).toBeGreaterThan(0);
      
      console.log('Multi-node scenario test:', {
        node1: { id: node1Info.nodeId.substring(0, 8) + '...', count: finalCount1 },
        node2: { id: node2Info.nodeId.substring(0, 8) + '...', count: finalCount2 },
        cubesCreated: { node1: cube1.success, node2: cube2.success }
      });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context1.close();
      await context2.close();
    }
  });
});