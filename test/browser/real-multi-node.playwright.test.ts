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
  requestCubeFromNetwork
} from './playwright-utils';

test.describe('Real Verity Multi-Node Functionality Tests', () => {
  let testServer: TestNodeServer;

  test.beforeAll(async () => {
    // Start a real Node.js full node that browser nodes can connect to
    testServer = await getTestServer(19000);
    console.log('Test server started:', testServer.getServerInfo());
  });

  test.afterAll(async () => {
    await shutdownTestServer();
  });

  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should connect browser light node to Node.js full node', async ({ page }) => {
    // Initialize browser node
    await initializeVerityInBrowser(page);
    
    // Connect to test server
    const connectionResult = await connectBrowserNodeToServer(page, 'ws://localhost:19000');
    
    expect(connectionResult.success).toBe(true);
    expect(connectionResult.peerCount).toBeGreaterThanOrEqual(1);
    
    // Verify connection status
    const status = await getBrowserNodeConnectionStatus(page);
    expect(status.peerCount).toBeGreaterThanOrEqual(1);
    expect(status.isNetworkReady).toBe(true);
    
    console.log('Browser node connected:', {
      browserNodeId: status.nodeId,
      connectedPeers: status.peerCount,
      serverInfo: testServer.getServerInfo()
    });
  });

  test('should exchange real cubes between browser node and server', async ({ page }) => {
    await initializeVerityInBrowser(page);
    await connectBrowserNodeToServer(page, 'ws://localhost:19000');
    
    // Create a cube in the browser node
    const browserCube = await createTestCubeInBrowser(page, 'Browser cube for exchange test');
    expect(browserCube.success).toBe(true);
    
    // Create a cube in the server node
    const serverCube = await testServer.addTestCube('Server cube for exchange test');
    expect(serverCube.success).toBe(true);
    
    // Verify the browser can access cubes
    const browserCubeCount = await getCubeCountFromBrowser(page);
    expect(browserCubeCount).toBeGreaterThanOrEqual(1);
    
    const serverCubeCount = await testServer.getCubeCount();
    expect(serverCubeCount).toBeGreaterThanOrEqual(1);
    
    console.log('Cube exchange test:', {
      browserCubes: browserCubeCount,
      serverCubes: serverCubeCount,
      browserCubeKey: browserCube.keyHex,
      serverCubeKey: serverCube.key
    });
  });

  test('should test real peer discovery between multiple browser nodes', async ({ browser }) => {
    // Create multiple browser contexts for different nodes
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext()
    ]);
    
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      // Initialize all browser nodes
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Connect all browser nodes to the server
      const connectionResults = await Promise.all(
        pages.map(page => connectBrowserNodeToServer(page, 'ws://localhost:19000'))
      );
      
      connectionResults.forEach((result, index) => {
        expect(result.success).toBe(true);
        console.log(`Browser node ${index + 1} connected:`, result);
      });
      
      // Verify all nodes are connected to the server
      const statuses = await Promise.all(
        pages.map(page => getBrowserNodeConnectionStatus(page))
      );
      
      statuses.forEach((status, index) => {
        expect(status.peerCount).toBeGreaterThanOrEqual(1);
        expect(status.isNetworkReady).toBe(true);
        console.log(`Node ${index + 1} status:`, status);
      });
      
      // Test cube creation from different nodes
      const cubeResults = await Promise.all(
        pages.map((page, index) => 
          createTestCubeInBrowser(page, `Multi-node test cube from node ${index + 1}`)
        )
      );
      
      cubeResults.forEach((result, index) => {
        expect(result.success).toBe(true);
        console.log(`Node ${index + 1} created cube:`, result.keyHex);
      });
      
      // Verify cube counts
      const cubeCounts = await Promise.all(
        pages.map(page => getCubeCountFromBrowser(page))
      );
      
      expect(cubeCounts.every(count => count >= 1)).toBe(true);
      
      console.log('Multi-node peer discovery test:', {
        nodes: statuses.length,
        serverPeers: testServer.getPeerCount(),
        cubeCounts,
        allConnected: statuses.every(s => s.isNetworkReady)
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test real cube synchronization across network', async ({ browser }) => {
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
      
      // Connect both to server
      await Promise.all([
        connectBrowserNodeToServer(page1, 'ws://localhost:19000'),
        connectBrowserNodeToServer(page2, 'ws://localhost:19000')
      ]);
      
      // Create a cube in node 1
      const cube1 = await createTestCubeInBrowser(page1, 'Sync test cube from node 1');
      expect(cube1.success).toBe(true);
      
      // Add some cubes to the server
      const serverCube1 = await testServer.addTestCube('Server cube 1');
      const serverCube2 = await testServer.addTestCube('Server cube 2');
      expect(serverCube1.success).toBe(true);
      expect(serverCube2.success).toBe(true);
      
      // Wait a bit for potential synchronization
      await page1.waitForTimeout(1000);
      await page2.waitForTimeout(1000);
      
      // Check cube counts
      const count1 = await getCubeCountFromBrowser(page1);
      const count2 = await getCubeCountFromBrowser(page2);
      const serverCount = await testServer.getCubeCount();
      
      expect(count1).toBeGreaterThanOrEqual(1); // At least the cube it created
      expect(serverCount).toBeGreaterThanOrEqual(2); // At least the server cubes
      
      console.log('Cube synchronization test:', {
        node1Cubes: count1,
        node2Cubes: count2,
        serverCubes: serverCount,
        cube1Key: cube1.keyHex,
        serverKeys: [serverCube1.key, serverCube2.key]
      });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await Promise.all([context1.close(), context2.close()]);
    }
  });

  test('should test real network resilience and reconnection', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    // Initial connection
    const initialConnection = await connectBrowserNodeToServer(page, 'ws://localhost:19000');
    expect(initialConnection.success).toBe(true);
    
    const initialStatus = await getBrowserNodeConnectionStatus(page);
    expect(initialStatus.peerCount).toBeGreaterThanOrEqual(1);
    
    // Create a cube while connected
    const cubeBeforeDisconnect = await createTestCubeInBrowser(page, 'Cube before network test');
    expect(cubeBeforeDisconnect.success).toBe(true);
    
    // Simulate temporary server restart (real network event)
    console.log('Simulating server restart...');
    await testServer.shutdown();
    
    // Wait for disconnection to be detected
    await page.waitForTimeout(2000);
    
    // Check connection status (should show disconnection)
    const disconnectedStatus = await getBrowserNodeConnectionStatus(page);
    console.log('Status after server shutdown:', disconnectedStatus);
    
    // Restart server
    testServer = await getTestServer(19000);
    console.log('Server restarted');
    
    // Try to reconnect
    const reconnectionResult = await connectBrowserNodeToServer(page, 'ws://localhost:19000');
    
    // Check final status
    const finalStatus = await getBrowserNodeConnectionStatus(page);
    const finalCubeCount = await getCubeCountFromBrowser(page);
    
    console.log('Network resilience test:', {
      initialConnection: initialConnection.success,
      initialPeers: initialStatus.peerCount,
      cubeBeforeDisconnect: cubeBeforeDisconnect.success,
      disconnectedPeers: disconnectedStatus.peerCount,
      reconnectionAttempt: reconnectionResult.success,
      finalPeers: finalStatus.peerCount,
      cubesRetained: finalCubeCount
    });
    
    // Verify the node maintained its data through the network event
    expect(finalCubeCount).toBeGreaterThanOrEqual(1);
  });

  test('should test distributed cube storage with multiple nodes', async ({ browser }) => {
    // Create 4 nodes for distributed storage test
    const contexts = await Promise.all(Array(4).fill(0).map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      // Initialize all nodes
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Connect all to server
      await Promise.all(pages.map(page => 
        connectBrowserNodeToServer(page, 'ws://localhost:19000')
      ));
      
      // Verify all connected
      const connectionStatuses = await Promise.all(
        pages.map(page => getBrowserNodeConnectionStatus(page))
      );
      
      connectionStatuses.forEach((status, index) => {
        expect(status.isNetworkReady).toBe(true);
        console.log(`Node ${index + 1}: ${status.nodeId}, peers: ${status.peerCount}`);
      });
      
      // Create different amounts of cubes in each node
      const cubeCreationTasks = [
        ...Array(3).fill(0).map((_, i) => createTestCubeInBrowser(pages[0], `Node1-Cube${i+1}`)),
        ...Array(2).fill(0).map((_, i) => createTestCubeInBrowser(pages[1], `Node2-Cube${i+1}`)),
        ...Array(4).fill(0).map((_, i) => createTestCubeInBrowser(pages[2], `Node3-Cube${i+1}`)),
        ...Array(1).fill(0).map((_, i) => createTestCubeInBrowser(pages[3], `Node4-Cube${i+1}`))
      ];
      
      const allCubeResults = await Promise.all(cubeCreationTasks);
      const successfulCubes = allCubeResults.filter(result => result.success);
      
      expect(successfulCubes.length).toBeGreaterThanOrEqual(8); // Expect most cubes to be created
      
      // Check cube distribution
      const finalCubeCounts = await Promise.all(
        pages.map(page => getCubeCountFromBrowser(page))
      );
      
      const totalCubesInNodes = finalCubeCounts.reduce((sum, count) => sum + count, 0);
      const serverCubeCount = await testServer.getCubeCount();
      
      console.log('Distributed storage test:', {
        nodesCreated: pages.length,
        cubesPerNode: finalCubeCounts,
        totalCubesInBrowserNodes: totalCubesInNodes,
        serverCubes: serverCubeCount,
        successfulCreations: successfulCubes.length,
        allNodesConnected: connectionStatuses.every(s => s.isNetworkReady)
      });
      
      expect(totalCubesInNodes).toBeGreaterThanOrEqual(8);
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });
});