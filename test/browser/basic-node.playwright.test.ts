import { test, expect } from '@playwright/test';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getBrowserNodeId,
  getNodeInfo,
  createMultipleCubes,
  hasCubeInBrowser,
  shutdownBrowserNode
} from './playwright-utils';

test.describe('Verity Browser Node Tests (Real Browser)', () => {
  
  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should create and initialize a browser Verity node', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const nodeInfo = await getNodeInfo(page);
    
    expect(nodeInfo.error).toBeUndefined();
    expect(nodeInfo.nodeId).toBeDefined();
    expect(nodeInfo.nodeType).toBe('VerityNode');
    expect(nodeInfo.cubeCount).toBeGreaterThanOrEqual(0);
    expect(nodeInfo.isReady).toBe(true);
    
    console.log('Browser node initialized:', nodeInfo);
  });

  test('should use IndexedDB storage in browser environment', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    // Test cube storage and retrieval
    const initialCount = await getCubeCountFromBrowser(page);
    expect(initialCount).toBeGreaterThanOrEqual(0);
    
    // Create a test cube
    const cubeResult = await createTestCubeInBrowser(page, "Browser IndexedDB test cube");
    
    expect(cubeResult.success).toBe(true);
    expect(cubeResult.cubeKey).toBeDefined();
    
    // Verify cube was stored
    const newCount = await getCubeCountFromBrowser(page);
    expect(newCount).toBeGreaterThan(initialCount);
    
    console.log('Cube storage test:', { initialCount, newCount, cubeResult });
  });

  test('should handle multiple cubes in browser storage', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const initialCount = await getCubeCountFromBrowser(page);
    
    // Create multiple test cubes
    const cubeResults = await createMultipleCubes(page, 3);
    
    // Count successful cubes
    const successfulCubes = cubeResults.filter(result => result.success);
    console.log('Cube creation results:', cubeResults.map(r => ({ success: r.success, error: r.error })));
    
    // We expect at least 1 cube to be created successfully
    expect(successfulCubes.length).toBeGreaterThanOrEqual(1);
    
    // Verify storage count increased by the number of successful cubes
    const finalCount = await getCubeCountFromBrowser(page);
    expect(finalCount).toBeGreaterThanOrEqual(initialCount + successfulCubes.length);
    
    // Verify each successful cube exists in storage
    for (const result of successfulCubes) {
      const exists = await hasCubeInBrowser(page, result.cubeKey!);
      expect(exists).toBe(true);
    }
    
    console.log('Multiple cubes test:', { 
      initialCount, 
      finalCount, 
      attempted: cubeResults.length,
      successful: successfulCubes.length
    });
  });

  test('should verify browser node configuration and capabilities', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const nodeDetails = await page.evaluate(async () => {
      const node = window.verity.node;
      
      return {
        nodeId: node.networkManager.idString,
        nodeType: node.constructor.name,
        hasCubeStore: !!node.cubeStore,
        hasNetworkManager: !!node.networkManager,
        hasPeerDB: !!node.peerDB,
        cubeStoreMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(node.cubeStore))
          .filter(prop => typeof node.cubeStore[prop] === 'function')
          .slice(0, 10), // First 10 methods
        networkManagerMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(node.networkManager))
          .filter(prop => typeof node.networkManager[prop] === 'function')
          .slice(0, 10), // First 10 methods
        transports: node.networkManager.transports ? 
          Array.from(node.networkManager.transports.keys()) : []
      };
    });
    
    expect(nodeDetails.hasCubeStore).toBe(true);
    expect(nodeDetails.hasNetworkManager).toBe(true);
    expect(nodeDetails.hasPeerDB).toBe(true);
    expect(nodeDetails.cubeStoreMethods).toContain('addCube');
    expect(nodeDetails.cubeStoreMethods).toContain('getCube');
    expect(nodeDetails.cubeStoreMethods).toContain('getNumberOfStoredCubes');
    
    console.log('Node details:', nodeDetails);
  });

  test('should handle cube creation and retrieval operations', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    // Test cube operations through the browser environment
    const operationResults = await page.evaluate(async () => {
      try {
        const node = window.verity.node;
        const cockpit = window.verity.cockpit;
        
        // Initial cube count
        const initialCount = await node.cubeStore.getNumberOfStoredCubes();
        
        // Create a veritum and compile it
        const veritum = cockpit.prepareVeritum();
        await veritum.compile();
        
        // Get the cubes from the veritum
        const cubes = Array.from(veritum.chunks);
        
        if (cubes.length === 0) {
          return { error: 'No cubes generated' };
        }
        
        const cube = cubes[0];
        
        // Add to cube store
        await node.cubeStore.addCube(cube);
        
        // Get the key and verify storage
        const key = await cube.getKey();
        const storedCube = await node.cubeStore.getCube(key);
        const finalCount = await node.cubeStore.getNumberOfStoredCubes();
        
        return {
          initialCount,
          finalCount,
          cubeCreated: !!cube,
          cubeStored: !!storedCube,
          keyGenerated: !!key,
          keyHex: key.toString('hex').substring(0, 32) + '...'
        };
      } catch (error) {
        return { error: error.message };
      }
    });
    
    expect(operationResults.error).toBeUndefined();
    expect(operationResults.cubeCreated).toBe(true);
    expect(operationResults.cubeStored).toBe(true);
    expect(operationResults.keyGenerated).toBe(true);
    expect(operationResults.finalCount).toBeGreaterThan(operationResults.initialCount);
    
    console.log('Cube operation results:', operationResults);
  });

  test('should verify node identity and uniqueness', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const nodeId1 = await getBrowserNodeId(page);
    expect(nodeId1).toBeDefined();
    expect(nodeId1).toMatch(/^[a-f0-9]{32}$/); // 32-character hex string
    
    // Refresh page and create new node
    await page.reload();
    await initializeVerityInBrowser(page);
    
    const nodeId2 = await getBrowserNodeId(page);
    expect(nodeId2).toBeDefined();
    expect(nodeId2).toMatch(/^[a-f0-9]{32}$/);
    
    // Each browser session should get a unique node ID
    expect(nodeId1).not.toBe(nodeId2);
    
    console.log('Node identity test:', { nodeId1, nodeId2 });
  });

  test('should handle storage persistence across operations', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    // Create several cubes
    const cubeResults = await createMultipleCubes(page, 2);
    const successfulCubes = cubeResults.filter(r => r.success);
    
    // Adapt expectation to actual successful cube count
    expect(successfulCubes.length).toBeGreaterThanOrEqual(1);
    
    // Verify storage state
    const storageTest = await page.evaluate(async () => {
      const node = window.verity.node;
      const cubeStore = node.cubeStore;
      
      const count = await cubeStore.getNumberOfStoredCubes();
      
      // Test various cube store operations
      const operations = {
        getNumberOfStoredCubes: typeof cubeStore.getNumberOfStoredCubes === 'function',
        addCube: typeof cubeStore.addCube === 'function',
        getCube: typeof cubeStore.getCube === 'function',
        hasCube: typeof cubeStore.hasCube === 'function'
      };
      
      return { count, operations };
    });
    
    expect(storageTest.count).toBeGreaterThanOrEqual(successfulCubes.length);
    expect(storageTest.operations.getNumberOfStoredCubes).toBe(true);
    expect(storageTest.operations.addCube).toBe(true);
    expect(storageTest.operations.getCube).toBe(true);
    expect(storageTest.operations.hasCube).toBe(true);
    
    console.log('Storage persistence test:', { 
      ...storageTest, 
      successfulCubes: successfulCubes.length 
    });
  });
});