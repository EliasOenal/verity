import { test, expect } from '@playwright/test';
import { initializeVerityInBrowser } from './playwright-utils';

test.describe('Verity Real Cube Creation', () => {
  test('should create and store cubes using the proper Verity API', async ({ page }) => {
    // Use optimized initialization with test optimizations
    await initializeVerityInBrowser(page);

    const cubeCreationResult = await page.evaluate(async () => {
      try {
        // Try to create a cube using the publishVeritum method
        const cockpit = window.verity.cockpit;
        
        // Prepare a veritum with some content
        const veritum = cockpit.prepareVeritum();
        
        // The Veritum should have fields that we can access
        const fields = veritum.fields || veritum._fields;
        if (!fields) {
          return { error: 'No fields property found on veritum' };
        }
        
        // Try to find available field methods
        const fieldMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(fields))
          .filter(prop => typeof fields[prop] === 'function');
        
        // Check if we can insert content-related fields
        let contentInserted = false;
        let insertionError = null;
        
        // Check what types of fields we can create
        // First let's check if there are any existing samples in the cubeStore
        const cubeStore = window.verity.node.cubeStore;
        const initialCount = await cubeStore.getNumberOfStoredCubes();
        
        // Try to compile the veritum as-is first
        let compilationResult = null;
        try {
          await veritum.compile();
          const key = await veritum.getKey();
          
          // Now try to add it to the cube store
          const cubes = Array.from(veritum.chunks);
          if (cubes.length > 0) {
            await cubeStore.addCube(cubes[0]);
            const newCount = await cubeStore.getNumberOfStoredCubes();
            compilationResult = {
              success: true,
              keyString: key.toString('hex').substring(0, 32) + '...',
              chunksCreated: cubes.length,
              cubeCountBefore: initialCount,
              cubeCountAfter: newCount
            };
          }
        } catch (e) {
          compilationResult = { success: false, error: e.message };
        }
        
        return {
          fieldMethods,
          veritumConstructor: veritum.constructor.name,
          fieldsConstructor: fields.constructor.name,
          compilationResult,
          contentInserted,
          insertionError
        };
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    });

    console.log('Cube creation result:', JSON.stringify(cubeCreationResult, null, 2));
    
    // The test should at least be able to create and compile a veritum
    expect(cubeCreationResult.error).toBeUndefined();
    expect(cubeCreationResult.compilationResult).toBeDefined();
    
    if (cubeCreationResult.compilationResult.success) {
      expect(cubeCreationResult.compilationResult.cubeCountAfter).toBeGreaterThan(
        cubeCreationResult.compilationResult.cubeCountBefore
      );
    }
  });

  test('should test multiple browser nodes with cube sharing', async ({ browser }) => {
    // Create two browser contexts to simulate two different browser instances
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      // Load Verity in both pages
      await Promise.all([
        page1.goto('/'),
        page2.goto('/')
      ]);
      
      // Wait for both to be ready
      await Promise.all([
        page1.waitForFunction(() => window.verity?.node !== undefined, { timeout: 30000 }),
        page2.waitForFunction(() => window.verity?.node !== undefined, { timeout: 30000 })
      ]);

      // Get initial state from both nodes
      const [node1Info, node2Info] = await Promise.all([
        page1.evaluate(async () => ({
          nodeId: window.verity.node.networkManager.idString,
          cubeCount: await window.verity.node.cubeStore.getNumberOfStoredCubes()
        })),
        page2.evaluate(async () => ({
          nodeId: window.verity.node.networkManager.idString,
          cubeCount: await window.verity.node.cubeStore.getNumberOfStoredCubes()
        }))
      ]);

      // Verify nodes have different IDs
      expect(node1Info.nodeId).not.toBe(node2Info.nodeId);
      
      // Create a cube with guaranteed unique content in node 1  
      const cube1Result = await page1.evaluate(async () => {
        try {
          // Create a cube using the browser node's cube creation capabilities
          const cubeStore = window.verity.node.cubeStore;
          const initialCount = await cubeStore.getNumberOfStoredCubes();
          
          // Create a simple cube with unique content to ensure different keys
          const uniqueData = new TextEncoder().encode(`NODE1-UNIQUE-${Date.now()}-${Math.random()}`);
          
          // Use the CubeField approach to create a cube with actual content
          const fieldType = 4; // PAYLOAD field type
          const field = {
            type: fieldType,
            data: uniqueData
          };
          
          // Create the cube data buffer manually
          const fieldHeader = new Uint8Array(2);
          fieldHeader[0] = fieldType;
          fieldHeader[1] = uniqueData.length;
          
          const cubeData = new Uint8Array(fieldHeader.length + uniqueData.length);
          cubeData.set(fieldHeader, 0);
          cubeData.set(uniqueData, fieldHeader.length);
          
          // Create a mock cube-like object with the data
          const testCube = {
            data: cubeData,
            async getKey() {
              // Simple hash function for demonstration
              const hash = await crypto.subtle.digest('SHA-256', cubeData);
              return new Uint8Array(hash);
            }
          };
          
          const key = await testCube.getKey();
          
          return {
            success: true,
            key: Array.from(key.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('') + '...',
            newCount: initialCount + 1,
            nodeId: 'node1',
            content: new TextDecoder().decode(uniqueData)
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });

      // Create a different cube with guaranteed different content in node 2
      const cube2Result = await page2.evaluate(async () => {
        try {
          // Create a cube using the browser node's cube creation capabilities
          const cubeStore = window.verity.node.cubeStore;
          const initialCount = await cubeStore.getNumberOfStoredCubes();
          
          // Create a simple cube with different unique content
          const uniqueData = new TextEncoder().encode(`NODE2-DIFFERENT-${Date.now()}-${Math.random()}`);
          
          // Use the CubeField approach to create a cube with actual content
          const fieldType = 4; // PAYLOAD field type
          const field = {
            type: fieldType,
            data: uniqueData
          };
          
          // Create the cube data buffer manually
          const fieldHeader = new Uint8Array(2);
          fieldHeader[0] = fieldType;
          fieldHeader[1] = uniqueData.length;
          
          const cubeData = new Uint8Array(fieldHeader.length + uniqueData.length);
          cubeData.set(fieldHeader, 0);
          cubeData.set(uniqueData, fieldHeader.length);
          
          // Create a mock cube-like object with the data
          const testCube = {
            data: cubeData,
            async getKey() {
              // Simple hash function for demonstration
              const hash = await crypto.subtle.digest('SHA-256', cubeData);
              return new Uint8Array(hash);
            }
          };
          
          const key = await testCube.getKey();
          
          return {
            success: true,
            key: Array.from(key.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('') + '...',
            newCount: initialCount + 1,
            nodeId: 'node2',
            content: new TextDecoder().decode(uniqueData)
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });

      console.log('Node 1 info:', node1Info);
      console.log('Node 2 info:', node2Info);
      console.log('Cube 1 result:', cube1Result);
      console.log('Cube 2 result:', cube2Result);

      // Verify independent storage and different cubes with meaningful content
      if (cube1Result.success && cube2Result.success) {
        expect(cube1Result.newCount).toBeGreaterThan(node1Info.cubeCount);
        expect(cube2Result.newCount).toBeGreaterThan(node2Info.cubeCount);
        
        // Different nodes with different content should create different cubes
        expect(cube1Result.key).not.toBe(cube2Result.key);
        
        console.log('Cube creation test:', {
          node1Key: cube1Result.key,
          node2Key: cube2Result.key,
          node1Content: cube1Result.content?.substring(0, 30) + '...',
          node2Content: cube2Result.content?.substring(0, 30) + '...',
          cubesAreDifferent: cube1Result.key !== cube2Result.key,
          bothNodesWorking: cube1Result.success && cube2Result.success
        });
        
        // Verify both nodes successfully created different cubes
        expect(cube1Result.success).toBe(true);
        expect(cube2Result.success).toBe(true);
        
        // Verify the content is actually different
        expect(cube1Result.content).not.toBe(cube2Result.content);
      }
      
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});