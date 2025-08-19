import { test, expect } from '@playwright/test';

test.describe('Verity Cube Creation Through Cockpit', () => {
  test('should create cubes using cockpit and veritum system', async ({ page }) => {
    await page.goto('/');
    
    // Wait for Verity to be fully loaded
    await page.waitForFunction(() => {
      return typeof window !== 'undefined' && 
             window.verity !== undefined &&
             window.verity.node !== undefined &&
             window.verity.cockpit !== undefined;
    }, { timeout: 30000 });

    // Try to create a cube using the cockpit/veritum system
    const cubeCreation = await page.evaluate(async () => {
      try {
        const cockpit = window.verity.cockpit;
        
        // Check what methods are available in cockpit
        const cockpitMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(cockpit))
          .filter(prop => typeof cockpit[prop] === 'function');
        
        // Check if we can create a veritum
        let veritumCreation = null;
        if (cockpitMethods.includes('prepareVeritum')) {
          try {
            const veritum = cockpit.prepareVeritum();
            veritumCreation = {
              success: true,
              constructor: veritum.constructor.name,
              methods: Object.getOwnPropertyNames(Object.getPrototypeOf(veritum))
                .filter(prop => typeof veritum[prop] === 'function')
            };
          } catch (e) {
            veritumCreation = { success: false, error: e.message };
          }
        }
        
        return {
          cockpitMethods,
          veritumCreation,
          cubeStore: {
            available: !!window.verity.node.cubeStore,
            methods: window.verity.node.cubeStore ? 
              Object.getOwnPropertyNames(Object.getPrototypeOf(window.verity.node.cubeStore))
                .filter(prop => typeof window.verity.node.cubeStore[prop] === 'function') : []
          }
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('Cube creation exploration:', JSON.stringify(cubeCreation, null, 2));

    // Try to add content to a veritum and store it
    const veritumTest = await page.evaluate(async () => {
      try {
        const cockpit = window.verity.cockpit;
        
        // Create a veritum
        const veritum = cockpit.prepareVeritum();
        
        // Check if we can add content
        const veritumMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(veritum))
          .filter(prop => typeof veritum[prop] === 'function');
        
        let contentResult = null;
        if (veritumMethods.includes('addContent')) {
          try {
            veritum.addContent('Browser test message from playwright');
            contentResult = { success: true };
          } catch (e) {
            contentResult = { success: false, error: e.message };
          }
        }

        // Try to compile and get key
        let compileResult = null;
        if (veritumMethods.includes('compile')) {
          try {
            await veritum.compile();
            const key = await veritum.getKey();
            compileResult = { success: true, key: key.substring(0, 32) + '...' };
          } catch (e) {
            compileResult = { success: false, error: e.message };
          }
        }

        return {
          veritumMethods,
          contentResult,
          compileResult
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('Veritum test results:', JSON.stringify(veritumTest, null, 2));
  });

  test('should check cube store operations', async ({ page }) => {
    await page.goto('/');
    
    // Wait for Verity to be fully loaded
    await page.waitForFunction(() => {
      return typeof window !== 'undefined' && 
             window.verity !== undefined &&
             window.verity.node !== undefined;
    }, { timeout: 30000 });

    const cubeStoreTest = await page.evaluate(async () => {
      try {
        const cubeStore = window.verity.node.cubeStore;
        
        // Get initial cube count
        const initialCount = await cubeStore.getNumberOfStoredCubes();
        
        // Check available methods
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(cubeStore))
          .filter(prop => typeof cubeStore[prop] === 'function');
        
        return {
          initialCount,
          methods: methods.slice(0, 10), // Just show first 10 methods
          hasAddCube: methods.includes('addCube'),
          hasGetCube: methods.includes('getCube'),
          hasGetAllCubes: methods.includes('getAllCubes')
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('Cube store test results:', JSON.stringify(cubeStoreTest, null, 2));
    
    expect(cubeStoreTest.hasAddCube).toBe(true);
    expect(cubeStoreTest.hasGetCube).toBe(true);
  });
});