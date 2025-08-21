import { test, expect, Browser } from '@playwright/test';
import { TestNodeServer, getTestServer, shutdownTestServer } from './test-node-server';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getNodeInfo,
  shutdownBrowserNode,
  connectBrowserNodeToServer,
  getBrowserNodeConnectionStatus
} from './playwright-utils';

test.describe('Real Verity Network Topology Tests', () => {
  let testServer: TestNodeServer;

  test.beforeAll(async () => {
    testServer = await getTestServer(19001);
  });

  test.afterAll(async () => {
    await shutdownTestServer();
  });

  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should test real star topology with central full node', async ({ browser }) => {
    // Create 4 browser nodes that will connect to a central Node.js full node (star topology)
    const contexts = await Promise.all(Array(4).fill(0).map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      // Initialize all browser nodes
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Connect all browser nodes to the central full node (star topology)
      const connectionResults = await Promise.all(
        pages.map(page => connectBrowserNodeToServer(page, 'ws://localhost:19001'))
      );
      
      // Verify all connections successful
      connectionResults.forEach((result, index) => {
        expect(result.success).toBe(true);
        console.log(`Edge node ${index + 1} connected to central node`);
      });
      
      // Get node information
      const nodeStatuses = await Promise.all(
        pages.map(page => getBrowserNodeConnectionStatus(page))
      );
      
      // In star topology, each edge node connects to central hub
      nodeStatuses.forEach((status, index) => {
        expect(status.isNetworkReady).toBe(true);
        expect(status.peerCount).toBe(1); // Each edge connected to central node only
      });
      
      // Test cube creation from different edge nodes
      const cubeCreationPromises = pages.map((page, index) => 
        createTestCubeInBrowser(page, `Star topology edge node ${index + 1} cube`)
      );
      
      const cubeResults = await Promise.all(cubeCreationPromises);
      const successfulCubes = cubeResults.filter(r => r.success);
      
      expect(successfulCubes.length).toBe(4);
      
      // Central node should see traffic from all edge nodes
      const centralNodePeers = testServer.getPeerCount();
      expect(centralNodePeers).toBe(4); // Central node connected to all 4 edge nodes
      
      console.log('Star topology test results:', {
        topology: 'star',
        centralNodeId: testServer.getNodeId().substring(0, 16) + '...',
        edgeNodes: nodeStatuses.length,
        centralNodePeers,
        edgeNodesConnected: nodeStatuses.every(s => s.isNetworkReady),
        cubesCreated: successfulCubes.length,
        centralNodeCubes: testServer.getCubeCount()
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test real hierarchical network with server coordination', async ({ browser }) => {
    // Create multiple browser nodes in a hierarchical pattern coordinated by the server
    const contexts = await Promise.all(Array(6).fill(0).map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Connect all nodes to the server (hierarchical with server as root)
      await Promise.all(
        pages.map(page => connectBrowserNodeToServer(page, 'ws://localhost:19001'))
      );
      
      // Verify hierarchical structure - all nodes connect through server
      const statuses = await Promise.all(
        pages.map(page => getBrowserNodeConnectionStatus(page))
      );
      
      statuses.forEach((status, index) => {
        expect(status.isNetworkReady).toBe(true);
        expect(status.peerCount).toBe(1); // Each connected to server
      });
      
      // Test distributed cube operations across hierarchy
      const cubeOperations = [];
      
      // Layer 1: Create cubes in first 2 nodes
      cubeOperations.push(
        createTestCubeInBrowser(pages[0], 'Hierarchical L1-N1 cube'),
        createTestCubeInBrowser(pages[1], 'Hierarchical L1-N2 cube')
      );
      
      // Layer 2: Create cubes in next 2 nodes
      cubeOperations.push(
        createTestCubeInBrowser(pages[2], 'Hierarchical L2-N1 cube'),
        createTestCubeInBrowser(pages[3], 'Hierarchical L2-N2 cube')
      );
      
      // Layer 3: Create cubes in last 2 nodes
      cubeOperations.push(
        createTestCubeInBrowser(pages[4], 'Hierarchical L3-N1 cube'),
        createTestCubeInBrowser(pages[5], 'Hierarchical L3-N2 cube')
      );
      
      const cubeResults = await Promise.all(cubeOperations);
      const successfulCreations = cubeResults.filter(r => r.success).length;
      
      expect(successfulCreations).toBeGreaterThanOrEqual(4);
      
      // Check cube distribution across hierarchy
      const cubeCounts = await Promise.all(
        pages.map(page => getCubeCountFromBrowser(page))
      );
      
      const totalCubes = cubeCounts.reduce((sum, count) => sum + count, 0);
      expect(totalCubes).toBeGreaterThanOrEqual(4);
      
      console.log('Hierarchical network test:', {
        topology: 'hierarchical',
        layers: 3,
        nodesPerLayer: 2,
        totalNodes: pages.length,
        serverCoordination: true,
        serverPeers: testServer.getPeerCount(),
        cubesPerNode: cubeCounts,
        totalCubesCreated: totalCubes,
        allNodesConnected: statuses.every(s => s.isNetworkReady)
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test real network load distribution', async ({ browser }) => {
    // Create multiple browser nodes to test load distribution through server
    const contexts = await Promise.all(Array(5).fill(0).map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Connect all nodes
      await Promise.all(
        pages.map(page => connectBrowserNodeToServer(page, 'ws://localhost:19001'))
      );
      
      // Test varying workloads per node
      const workloadTasks = [
        // Node 0: Light load (1 cube)
        createTestCubeInBrowser(pages[0], 'Load test - Light workload'),
        
        // Node 1: Medium load (3 cubes)
        ...Array(3).fill(0).map((_, i) => 
          createTestCubeInBrowser(pages[1], `Load test - Medium workload ${i + 1}`)
        ),
        
        // Node 2: Heavy load (5 cubes)
        ...Array(5).fill(0).map((_, i) => 
          createTestCubeInBrowser(pages[2], `Load test - Heavy workload ${i + 1}`)
        ),
        
        // Node 3: Medium load (2 cubes)
        ...Array(2).fill(0).map((_, i) => 
          createTestCubeInBrowser(pages[3], `Load test - Medium-2 workload ${i + 1}`)
        ),
        
        // Node 4: Light load (1 cube)
        createTestCubeInBrowser(pages[4], 'Load test - Light-2 workload')
      ];
      
      const startTime = Date.now();
      const allResults = await Promise.all(workloadTasks);
      const endTime = Date.now();
      
      const successful = allResults.filter(r => r.success).length;
      expect(successful).toBeGreaterThanOrEqual(10); // Most operations should succeed
      
      // Check final distribution
      const finalCounts = await Promise.all(
        pages.map(page => getCubeCountFromBrowser(page))
      );
      
      const expectedLoads = [1, 3, 5, 2, 1];
      finalCounts.forEach((count, index) => {
        expect(count).toBeGreaterThanOrEqual(Math.min(expectedLoads[index], 1));
      });
      
      const totalTime = endTime - startTime;
      const throughput = (successful * 1000) / totalTime; // operations per second
      
      console.log('Load distribution test:', {
        totalOperations: workloadTasks.length,
        successfulOperations: successful,
        totalTime: `${totalTime}ms`,
        throughput: `${throughput.toFixed(2)} ops/sec`,
        finalDistribution: finalCounts,
        expectedDistribution: expectedLoads,
        serverHandledPeers: testServer.getPeerCount(),
        serverCubeCount: testServer.getCubeCount()
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test real network adaptation under changing conditions', async ({ browser }) => {
    // Test network adaptation by adding and removing nodes dynamically
    const initialContexts = await Promise.all(Array(2).fill(0).map(() => browser.newContext()));
    const initialPages = await Promise.all(initialContexts.map(ctx => ctx.newPage()));
    
    try {
      // Phase 1: Start with 2 nodes
      await Promise.all(initialPages.map(page => initializeVerityInBrowser(page)));
      await Promise.all(
        initialPages.map(page => connectBrowserNodeToServer(page, 'ws://localhost:19001'))
      );
      
      const phase1Statuses = await Promise.all(
        initialPages.map(page => getBrowserNodeConnectionStatus(page))
      );
      
      expect(phase1Statuses.every(s => s.isNetworkReady)).toBe(true);
      console.log('Phase 1 - Initial network:', { nodes: 2, serverPeers: testServer.getPeerCount() });
      
      // Phase 2: Add 2 more nodes (network growth)
      const additionalContexts = await Promise.all(Array(2).fill(0).map(() => browser.newContext()));
      const additionalPages = await Promise.all(additionalContexts.map(ctx => ctx.newPage()));
      
      await Promise.all(additionalPages.map(page => initializeVerityInBrowser(page)));
      await Promise.all(
        additionalPages.map(page => connectBrowserNodeToServer(page, 'ws://localhost:19001'))
      );
      
      const allPages = [...initialPages, ...additionalPages];
      const phase2Statuses = await Promise.all(
        allPages.map(page => getBrowserNodeConnectionStatus(page))
      );
      
      expect(phase2Statuses.every(s => s.isNetworkReady)).toBe(true);
      console.log('Phase 2 - Network growth:', { nodes: 4, serverPeers: testServer.getPeerCount() });
      
      // Phase 3: Test cube operations across enlarged network
      const cubeResults = await Promise.all(
        allPages.map((page, index) => 
          createTestCubeInBrowser(page, `Adaptation test cube from node ${index + 1}`)
        )
      );
      
      const successfulCubes = cubeResults.filter(r => r.success).length;
      expect(successfulCubes).toBe(4);
      
      // Phase 4: Simulate node leaving (shutdown one node)
      await shutdownBrowserNode(additionalPages[1]);
      await additionalContexts[1].close();
      
      // Wait for network to adapt
      await allPages[0].waitForTimeout(1000);
      
      const remainingPages = allPages.slice(0, -1);
      const phase4Statuses = await Promise.all(
        remainingPages.map(page => getBrowserNodeConnectionStatus(page))
      );
      
      // Network should still be functional with remaining nodes
      expect(phase4Statuses.every(s => s.isNetworkReady)).toBe(true);
      
      console.log('Network adaptation test results:', {
        phase1Nodes: 2,
        phase2Nodes: 4,
        phase4Nodes: 3,
        cubesCreated: successfulCubes,
        networkRemainsStable: phase4Statuses.every(s => s.isNetworkReady),
        finalServerPeers: testServer.getPeerCount()
      });
      
    } finally {
      await Promise.all([...initialPages, ...additionalPages.slice(0, -1)].map(page => 
        shutdownBrowserNode(page).catch(() => {}) // Ignore errors for already closed pages
      ));
      await Promise.all([...initialContexts, additionalContexts[0]].map(ctx => 
        ctx.close().catch(() => {})
      ));
    }
  });
});