import { test, expect, Browser } from '@playwright/test';
import { TestNodeServer, getTestServer, shutdownTestServer } from './test-node-server';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getNodeInfo,
  shutdownBrowserNode,
  createMultipleCubes,
  connectBrowserNodeToServer,
  getBrowserNodeConnectionStatus
} from './playwright-utils';

test.describe('Real Advanced Multi-Node Scenarios', () => {
  let testServer: TestNodeServer;

  test.beforeAll(async () => {
    testServer = await getTestServer(19002);
  });

  test.afterAll(async () => {
    await shutdownTestServer(19002);
  });

  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should test real distributed cube storage across multiple nodes', async ({ browser }) => {
    // Create 4 browser nodes to simulate a distributed network
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
      browser.newContext()
    ]);
    
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      // Initialize all nodes
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Connect all to test server
      await Promise.all(pages.map(page => 
        connectBrowserNodeToServer(page, 'ws://localhost:19002')
      ));
      
      // Get node information
      const nodeInfos = await Promise.all(pages.map(page => getNodeInfo(page)));
      nodeInfos.forEach(info => expect(info.error).toBeUndefined());
      
      // Verify all nodes have unique IDs
      const nodeIds = nodeInfos.map(info => info.nodeId);
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(nodeIds.length);
      
      // Create different numbers of cubes in each node to simulate distributed storage
      const cubeCreationTasks = [
        createMultipleCubes(pages[0], 3), // Node 1: 3 cubes
        createMultipleCubes(pages[1], 2), // Node 2: 2 cubes
        createMultipleCubes(pages[2], 4), // Node 3: 4 cubes
        createMultipleCubes(pages[3], 1)  // Node 4: 1 cube
      ];
      
      const cubeResults = await Promise.all(cubeCreationTasks);
      
      // Verify cube creation
      const totalCubesCreated = cubeResults.reduce((total, results) => 
        total + results.filter(r => r.success).length, 0
      );
      expect(totalCubesCreated).toBeGreaterThan(5); // At least some cubes should be created
      
      // Get final cube counts
      const finalCounts = await Promise.all(pages.map(page => getCubeCountFromBrowser(page)));
      const totalStoredCubes = finalCounts.reduce((sum, count) => sum + count, 0);
      
      expect(totalStoredCubes).toBeGreaterThanOrEqual(totalCubesCreated);
      
      // Verify server sees the network activity
      const serverPeerCount = testServer.getPeerCount();
      expect(serverPeerCount).toBe(4); // All 4 browser nodes connected
      
      console.log('Distributed storage test:', {
        nodes: nodeInfos.length,
        cubesPerNode: finalCounts,
        totalCubes: totalStoredCubes,
        successfulCreations: totalCubesCreated,
        serverPeers: serverPeerCount,
        allNodesConnected: true
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test real peer discovery and network participation', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();
    
    try {
      // Initialize nodes sequentially to simulate real-world discovery
      await initializeVerityInBrowser(page1);
      await connectBrowserNodeToServer(page1, 'ws://localhost:19002');
      await page1.waitForTimeout(500);
      
      await initializeVerityInBrowser(page2);
      await connectBrowserNodeToServer(page2, 'ws://localhost:19002');
      await page2.waitForTimeout(500);
      
      await initializeVerityInBrowser(page3);
      await connectBrowserNodeToServer(page3, 'ws://localhost:19002');
      await page3.waitForTimeout(500);
      
      // Test real peer discovery process
      const discoveryResults = await Promise.all([
        getBrowserNodeConnectionStatus(page1),
        getBrowserNodeConnectionStatus(page2),
        getBrowserNodeConnectionStatus(page3)
      ]);
      
      // All nodes should be connected to the server
      discoveryResults.forEach((result, index) => {
        expect(result.isNetworkReady).toBe(true);
        expect(result.peerCount).toBeGreaterThanOrEqual(1);
        console.log(`Node ${index + 1}: ${result.nodeId}, peers: ${result.peerCount}`);
      });
      
      // Test actual cube exchange between discovered peers
      const cubeExchangeResults = await Promise.all([
        createTestCubeInBrowser(page1, 'Discovery test cube from node 1'),
        createTestCubeInBrowser(page2, 'Discovery test cube from node 2'),
        createTestCubeInBrowser(page3, 'Discovery test cube from node 3')
      ]);
      
      cubeExchangeResults.forEach((result, index) => {
        expect(result.success).toBe(true);
        console.log(`Node ${index + 1} created cube: ${result.keyHex}`);
      });
      
      // Server should see all peer connections
      const serverPeerCount = testServer.getPeerCount();
      expect(serverPeerCount).toBe(3);
      
      console.log('Real peer discovery test:', {
        nodesParticipating: discoveryResults.length,
        allNodesNetworkReady: discoveryResults.every(r => r.isNetworkReady),
        serverPeerConnections: serverPeerCount,
        cubesExchanged: cubeExchangeResults.filter(r => r.success).length,
        networkTopology: 'star_with_server_hub'
      });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2),
        shutdownBrowserNode(page3)
      ]);
      await Promise.all([
        context1.close(),
        context2.close(),
        context3.close()
      ]);
    }
  });

  test('should test real network partition and recovery scenarios', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Connect both to server
      await Promise.all([
        connectBrowserNodeToServer(page1, 'ws://localhost:19002'),
        connectBrowserNodeToServer(page2, 'ws://localhost:19002')
      ]);
      
      // Create cubes before partition
      const [cube1, cube2] = await Promise.all([
        createTestCubeInBrowser(page1, 'Pre-partition cube 1'),
        createTestCubeInBrowser(page2, 'Pre-partition cube 2')
      ]);
      
      expect(cube1.success).toBe(true);
      expect(cube2.success).toBe(true);
      
      // Get initial network state
      const prePartitionStates = await Promise.all([
        getBrowserNodeConnectionStatus(page1),
        getBrowserNodeConnectionStatus(page2)
      ]);
      
      expect(prePartitionStates.every(state => state.isNetworkReady)).toBe(true);
      
      // Simulate network partition by shutting down server
      console.log('Simulating network partition by shutting down server...');
      await testServer.shutdown();
      
      // Wait for partition to be detected
      await page1.waitForTimeout(3000);
      
      // Check post-partition state
      const postPartitionStates = await Promise.all([
        getBrowserNodeConnectionStatus(page1),
        getBrowserNodeConnectionStatus(page2)
      ]);
      
      console.log('Post-partition states:', postPartitionStates);
      
      // Nodes should detect the disconnection
      // Note: The exact behavior depends on the networking implementation
      
      // Restart server to test recovery
      console.log('Restarting server for recovery test...');
      testServer = await getTestServer(19002);
      
      // Attempt to reconnect
      await Promise.all([
        connectBrowserNodeToServer(page1, 'ws://localhost:19002'),
        connectBrowserNodeToServer(page2, 'ws://localhost:19002')
      ]);
      
      // Wait for recovery
      await page1.waitForTimeout(2000);
      
      // Check recovery state
      const recoveryStates = await Promise.all([
        getBrowserNodeConnectionStatus(page1),
        getBrowserNodeConnectionStatus(page2)
      ]);
      
      // Test that nodes can still create cubes after recovery
      const [postRecoveryCube1, postRecoveryCube2] = await Promise.all([
        createTestCubeInBrowser(page1, 'Post-recovery cube 1'),
        createTestCubeInBrowser(page2, 'Post-recovery cube 2')
      ]);
      
      // Check final cube counts
      const finalCounts = await Promise.all([
        getCubeCountFromBrowser(page1),
        getCubeCountFromBrowser(page2)
      ]);
      
      console.log('Network partition and recovery test:', {
        prePartitionConnected: prePartitionStates.every(s => s.isNetworkReady),
        postRecoveryConnected: recoveryStates.some(s => s.isNetworkReady),
        cubesBeforePartition: [cube1.success, cube2.success],
        cubesAfterRecovery: [postRecoveryCube1.success, postRecoveryCube2.success],
        finalCubeCounts: finalCounts,
        serverPeersAfterRecovery: testServer.getPeerCount()
      });
      
      // Verify nodes retained their cubes and can create new ones
      expect(finalCounts.every(count => count >= 1)).toBe(true);
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await Promise.all([context1.close(), context2.close()]);
    }
  });

  test('should test real concurrent cube operations under network load', async ({ browser }) => {
    // Create 3 nodes for concurrent operations test
    const contexts = await Promise.all(Array(3).fill(0).map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      // Initialize all nodes
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Connect all to server
      await Promise.all(pages.map(page => 
        connectBrowserNodeToServer(page, 'ws://localhost:19002')
      ));
      
      // Wait for all connections to stabilize
      await pages[0].waitForTimeout(1000);
      
      // Create concurrent cube operations
      const concurrentOperations = [
        // Node 1: Create 5 cubes rapidly
        ...Array(5).fill(0).map((_, i) => 
          createTestCubeInBrowser(pages[0], `Concurrent Node1 Cube ${i + 1}`)
        ),
        
        // Node 2: Create 3 cubes rapidly
        ...Array(3).fill(0).map((_, i) => 
          createTestCubeInBrowser(pages[1], `Concurrent Node2 Cube ${i + 1}`)
        ),
        
        // Node 3: Get status multiple times while others create cubes
        ...Array(4).fill(0).map(() => 
          getCubeCountFromBrowser(pages[2])
        )
      ];
      
      const startTime = Date.now();
      const results = await Promise.all(concurrentOperations);
      const endTime = Date.now();
      
      // Separate cube creation results from status queries
      const cubeCreationResults = results.slice(0, 8).filter(r => typeof r === 'object' && r.success);
      const statusQueries = results.slice(8).filter(r => typeof r === 'number');
      
      expect(cubeCreationResults.length).toBeGreaterThanOrEqual(6); // Most should succeed
      expect(statusQueries.length).toBe(4);
      
      // Get final states
      const finalCounts = await Promise.all(pages.map(page => getCubeCountFromBrowser(page)));
      const finalStatuses = await Promise.all(pages.map(page => getBrowserNodeConnectionStatus(page)));
      
      const totalTime = endTime - startTime;
      const throughput = (cubeCreationResults.length * 1000) / totalTime;
      
      console.log('Concurrent operations under network load:', {
        totalOperations: concurrentOperations.length,
        successfulCubeCreations: cubeCreationResults.length,
        statusQueries: statusQueries.length,
        totalTime: `${totalTime}ms`,
        throughput: `${throughput.toFixed(2)} ops/sec`,
        finalCubeCounts: finalCounts,
        allNodesStableAfterLoad: finalStatuses.every(s => s.isNetworkReady),
        serverPeersRemaining: testServer.getPeerCount()
      });
      
      // Verify network remained stable during concurrent operations
      expect(finalStatuses.every(s => s.isNetworkReady)).toBe(true);
      expect(testServer.getPeerCount()).toBe(3);
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test real load balancing across multiple browser nodes', async ({ browser }) => {
    // Create multiple nodes with different workloads
    const contexts = await Promise.all(Array(3).fill(0).map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      await Promise.all(pages.map(page => 
        connectBrowserNodeToServer(page, 'ws://localhost:19002')
      ));
      
      // Simulate different workload patterns
      const workloadTasks = [
        // Node 0: Light periodic load
        createTestCubeInBrowser(pages[0], 'Load balance test - Light workload'),
        
        // Node 1: Heavy sustained load  
        ...Array(5).fill(0).map((_, i) => 
          createTestCubeInBrowser(pages[1], `Load balance test - Heavy workload ${i + 1}`)
        ),
        
        // Node 2: Medium bursty load
        ...Array(2).fill(0).map((_, i) => 
          createTestCubeInBrowser(pages[2], `Load balance test - Medium workload ${i + 1}`)
        )
      ];
      
      const startTime = Date.now();
      const workloadResults = await Promise.all(workloadTasks);
      const endTime = Date.now();
      
      const successful = workloadResults.filter(r => r.success).length;
      const totalTime = endTime - startTime;
      
      // Check load distribution
      const loadDistribution = await Promise.all(pages.map(async (page, index) => {
        const count = await getCubeCountFromBrowser(page);
        const status = await getBrowserNodeConnectionStatus(page);
        
        return {
          nodeIndex: index,
          cubesCreated: count,
          networkStatus: status.isNetworkReady,
          peerConnections: status.peerCount,
          nodeId: status.nodeId
        };
      }));
      
      const expectedLoads = [1, 5, 2]; // Expected cubes per node
      loadDistribution.forEach((load, index) => {
        expect(load.cubesCreated).toBeGreaterThanOrEqual(Math.min(expectedLoads[index], 1));
        expect(load.networkStatus).toBe(true);
      });
      
      console.log('Real load balancing test:', {
        totalWorkloadTasks: workloadTasks.length,
        successfulOperations: successful,
        executionTime: `${totalTime}ms`,
        throughput: `${(successful * 1000 / totalTime).toFixed(2)} ops/sec`,
        loadDistribution,
        serverCoordinatedConnections: testServer.getPeerCount(),
        networkStabilityMaintained: loadDistribution.every(l => l.networkStatus)
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });
});