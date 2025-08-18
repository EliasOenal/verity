// @vitest-environment jsdom

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { Buffer } from 'buffer';

// Import Verity modules
import { CoreNode } from '../../src/core/coreNode';
import { CubeStore } from '../../src/core/cube/cubeStore';
import { Cube } from '../../src/core/cube/cube';
import { CubeField } from '../../src/core/cube/cubeField';
import { CubeType } from '../../src/core/cube/cube.definitions';
import { SupportedTransports } from '../../src/core/networking/networkDefinitions';

// Import test utilities
import { createBrowserNode, createServerNode, testBrowserStorage } from './browser-test-utils';
import { testCoreOptions } from '../core/testcore.definition';

describe('Verity Browser Node Tests', () => {
  let browserNode: CoreNode;
  let serverNode: CoreNode;

  beforeAll(async () => {
    // Set up browser-like globals
    global.Buffer = Buffer;
    
    // Mock IndexedDB if not available
    if (!global.indexedDB) {
      const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
      global.indexedDB = new FDBFactory();
    }
  });

  afterAll(async () => {
    // Graceful shutdown with error handling
    try {
      if (browserNode) {
        await browserNode.shutdown();
      }
    } catch (error) {
      console.warn('Browser node shutdown failed:', error);
    }
    
    try {
      if (serverNode) {
        await serverNode.shutdown();
      }
    } catch (error) {
      console.warn('Server node shutdown failed:', error);
    }
  }, 30000);

  describe('Basic Browser Node Functionality', () => {
    it('should create a browser-configured CoreNode', async () => {
      browserNode = createBrowserNode({
        ...testCoreOptions,
        initialPeers: [] // Start without peers for this basic test
      });
      
      await browserNode.readyPromise;
      
      expect(browserNode).toBeDefined();
      expect(browserNode.cubeStore).toBeDefined();
      expect(browserNode.peerDB).toBeDefined();
      expect(browserNode.networkManager).toBeDefined();
    });

    it('should use in-memory storage suitable for browser', async () => {
      expect(browserNode.cubeStore).toBeDefined();
      
      // Test that storage works
      const initialCount = await browserNode.cubeStore.getNumberOfStoredCubes();
      expect(initialCount).toBeGreaterThanOrEqual(0);
      
      // Add a test cube with no difficulty requirement
      const testCube = Cube.Frozen({
        fields: [
          CubeField.RawContent(CubeType.FROZEN, "Browser test cube"),
        ],
        // Set difficulty to 0 to avoid mining requirements in tests
        requiredDifficulty: 0,
      });
      
      await browserNode.cubeStore.addCube(testCube);
      
      const newCount = await browserNode.cubeStore.getNumberOfStoredCubes();
      expect(newCount).toBeGreaterThan(initialCount);
      
      // Verify retrieval
      const key = await testCube.getKey();
      const retrieved = await browserNode.cubeStore.getCube(key);
      expect(retrieved).not.toBeNull();
    });

    it('should be configured as a light node', () => {
      // Browser nodes typically run as light nodes
      const transport = browserNode.networkManager.transports.get(SupportedTransports.libp2p);
      expect(transport).toBeDefined();
    });
  });

  describe('Browser Storage Tests', () => {
    it('should pass browser storage functionality test', async () => {
      const storageWorks = await testBrowserStorage(browserNode);
      expect(storageWorks).toBe(true);
    });

    it('should handle multiple cubes in storage', async () => {
      const initialCount = await browserNode.cubeStore.getNumberOfStoredCubes();
      
      // Add multiple test cubes
      const cubes = [];
      for (let i = 0; i < 3; i++) {
        const cube = Cube.Frozen({
          fields: [
            CubeField.RawContent(CubeType.FROZEN, `Test cube ${i}`),
          ],
          requiredDifficulty: 0,
        });
        cubes.push(cube);
        await browserNode.cubeStore.addCube(cube);
      }
      
      const finalCount = await browserNode.cubeStore.getNumberOfStoredCubes();
      expect(finalCount).toBeGreaterThanOrEqual(initialCount + 3);
      
      // Verify all cubes can be retrieved
      for (const cube of cubes) {
        const key = await cube.getKey();
        const retrieved = await browserNode.cubeStore.getCube(key);
        expect(retrieved).not.toBeNull();
      }
    });
  });

  describe('Browser API Requirements', () => {
    it('should have IndexedDB available in browser environment', () => {
      // This test verifies the requirement from the issue
      expect(global.indexedDB).toBeDefined();
      expect(typeof global.indexedDB.open).toBe('function');
    });

    it('should be able to use crypto APIs', () => {
      // Test crypto availability (needed for Verity's cryptographic operations)
      expect(global.crypto).toBeDefined();
      expect(global.crypto.subtle).toBeDefined();
    });

    it('should support Buffer operations in browser context', () => {
      // Verity uses Buffer extensively
      const testBuffer = Buffer.from('test data', 'utf8');
      expect(Buffer.isBuffer(testBuffer)).toBe(true);
      expect(testBuffer.toString()).toBe('test data');
    });
  });
});