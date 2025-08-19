import { test, expect } from '@playwright/test';

test.describe('Verity Core Classes Discovery', () => {
  test('should find Cube and CubeField classes in browser', async ({ page }) => {
    await page.goto('/');
    
    // Wait for Verity to be fully loaded
    await page.waitForFunction(() => {
      return typeof window !== 'undefined' && 
             window.verity !== undefined &&
             window.verity.node !== undefined;
    }, { timeout: 30000 });

    // Try to find Cube classes through various methods
    const classDiscovery = await page.evaluate(() => {
      const results = {
        methods: {},
        errors: []
      };

      // Method 1: Check if there's a global Verity library
      try {
        results.methods.globalLibrary = {
          exists: false,
          content: null
        };
        if (window.verityLibrary) {
          results.methods.globalLibrary = {
            exists: true,
            content: Object.keys(window.verityLibrary)
          };
        }
      } catch (e) {
        results.errors.push('globalLibrary: ' + e.message);
      }

      // Method 2: Check webpack chunks for available modules
      try {
        results.methods.webpackChunks = {
          exists: false,
          chunks: []
        };
        if (window.webpackChunkverity) {
          results.methods.webpackChunks = {
            exists: true,
            chunks: window.webpackChunkverity.length || 0
          };
        }
      } catch (e) {
        results.errors.push('webpackChunks: ' + e.message);
      }

      // Method 3: Try to access through the cockpit
      try {
        results.methods.cockpit = {
          exists: false,
          properties: []
        };
        if (window.verity.cockpit) {
          results.methods.cockpit = {
            exists: true,
            properties: Object.getOwnPropertyNames(window.verity.cockpit),
            constructor: window.verity.cockpit.constructor.name
          };
        }
      } catch (e) {
        results.errors.push('cockpit: ' + e.message);
      }

      // Method 4: Try dynamic import
      try {
        results.methods.dynamicImport = 'attempted';
        // Note: dynamic import would need to be handled differently
      } catch (e) {
        results.errors.push('dynamicImport: ' + e.message);
      }

      // Method 5: Check if classes are available through node modules
      try {
        results.methods.nodeModules = {
          cubeStore: window.verity.node.cubeStore?.constructor?.name,
          cubeStoreProperties: window.verity.node.cubeStore ? Object.getOwnPropertyNames(window.verity.node.cubeStore) : [],
          networkManager: window.verity.node.networkManager?.constructor?.name,
          peerDB: window.verity.node.peerDB?.constructor?.name
        };
      } catch (e) {
        results.errors.push('nodeModules: ' + e.message);
      }

      return results;
    });

    console.log('Class discovery results:', JSON.stringify(classDiscovery, null, 2));

    // Now let's try to find a way to create cubes
    const cubeCreationAttempts = await page.evaluate(() => {
      const attempts = {};

      // Try to create a cube through the cockpit
      try {
        if (window.verity.cockpit && window.verity.cockpit.createCube) {
          attempts.cockpitCreateCube = 'available';
        } else {
          attempts.cockpitCreateCube = 'not available';
        }
      } catch (e) {
        attempts.cockpitCreateCube = 'error: ' + e.message;
      }

      // Check if the cube store has methods to work with cubes
      try {
        const cubeStore = window.verity.node.cubeStore;
        attempts.cubeStoreMethods = Object.getOwnPropertyNames(cubeStore)
          .filter(prop => typeof cubeStore[prop] === 'function');
      } catch (e) {
        attempts.cubeStoreMethods = 'error: ' + e.message;
      }

      return attempts;
    });

    console.log('Cube creation attempts:', JSON.stringify(cubeCreationAttempts, null, 2));
  });

  test('should try to access Verity classes through require or import', async ({ page }) => {
    await page.goto('/');
    
    // Wait for Verity to be fully loaded
    await page.waitForFunction(() => {
      return typeof window !== 'undefined' && 
             window.verity !== undefined &&
             window.verity.node !== undefined;
    }, { timeout: 30000 });

    // Try different ways to access the classes
    const importAttempts = await page.evaluate(async () => {
      const results = {};

      // Try require (if available)
      try {
        if (typeof require !== 'undefined') {
          results.requireAvailable = true;
          // Try to require the core cube classes
          results.requireCube = 'attempted';
        } else {
          results.requireAvailable = false;
        }
      } catch (e) {
        results.requireError = e.message;
      }

      // Try to access webpack's internal module system
      try {
        if (window.__webpack_require__) {
          results.webpackRequireAvailable = true;
          results.webpackModules = Object.keys(window.__webpack_require__.cache || {}).length;
        } else {
          results.webpackRequireAvailable = false;
        }
      } catch (e) {
        results.webpackRequireError = e.message;
      }

      // Check for any globally available constructors
      try {
        const globalConstructors = [];
        for (const prop in window) {
          if (typeof window[prop] === 'function' && 
              (prop.includes('Cube') || prop.includes('Verity') || prop.includes('Core'))) {
            globalConstructors.push(prop);
          }
        }
        results.globalConstructors = globalConstructors;
      } catch (e) {
        results.globalConstructorsError = e.message;
      }

      return results;
    });

    console.log('Import attempts:', JSON.stringify(importAttempts, null, 2));
  });
});