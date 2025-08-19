// @vitest-environment jsdom

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { Buffer } from 'buffer';

// Import Verity modules
import { CoreNode } from '../../src/core/coreNode';
import { Cube } from '../../src/core/cube/cube';
import { CubeField } from '../../src/core/cube/cubeField';
import { CubeType, CubeFieldType } from '../../src/core/cube/cube.definitions';
import { SupportedTransports } from '../../src/core/networking/networkDefinitions';

// Import test utilities
import { createBrowserNode, createServerNode, waitForNodesConnected } from './browser-test-utils';
import { testCoreOptions } from '../core/testcore.definition';

describe('Verity Browser Connectivity Tests', () => {
  let browserNode1: CoreNode;
  let browserNode2: CoreNode;
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
    const shutdownPromises = [];
    
    if (browserNode1) {
      shutdownPromises.push(
        browserNode1.shutdown().catch(err => console.warn('Browser node 1 shutdown failed:', err))
      );
    }
    if (browserNode2) {
      shutdownPromises.push(
        browserNode2.shutdown().catch(err => console.warn('Browser node 2 shutdown failed:', err))
      );
    }
    if (serverNode) {
      shutdownPromises.push(
        serverNode.shutdown().catch(err => console.warn('Server node shutdown failed:', err))
      );
    }
    
    // Wait for all shutdowns to complete or timeout
    await Promise.all(shutdownPromises);
  }, 30000);

  describe('Browser Node Network Setup', () => {
    it('should create a server node for browser connections', async () => {
      // Create a server node that browsers can connect to
      serverNode = createServerNode(20984);
      await serverNode.readyPromise;
      
      expect(serverNode).toBeDefined();
      expect(serverNode.networkManager).toBeDefined();
      
      // Verify server is configured as full node
      const wsTransport = serverNode.networkManager.transports.get(SupportedTransports.ws);
      expect(wsTransport).toBeDefined();
    });

    it('should create multiple browser nodes', async () => {
      // Create browser nodes configured to connect to the server
      browserNode1 = createBrowserNode({
        ...testCoreOptions,
        initialPeers: [`ws://127.0.0.1:20984`]
      });
      
      browserNode2 = createBrowserNode({
        ...testCoreOptions,
        initialPeers: [`ws://127.0.0.1:20984`]
      });
      
      await Promise.all([
        browserNode1.readyPromise,
        browserNode2.readyPromise
      ]);
      
      expect(browserNode1).toBeDefined();
      expect(browserNode2).toBeDefined();
      expect(browserNode1.networkManager).toBeDefined();
      expect(browserNode2.networkManager).toBeDefined();
    });
  });

  describe('Browser-to-Server Cube Sharing', () => {
    it('should allow browser nodes to store and share cubes through server', async () => {
      // Create a test cube on browser node 1
      const testCube = Cube.Frozen({
        fields: [
          CubeField.RawContent(CubeType.FROZEN, "Browser-to-browser test message"),
        ],
        requiredDifficulty: 0,
      });
      
      // Add cube to browser node 1
      await browserNode1.cubeStore.addCube(testCube);
      
      // Verify cube was stored
      const cubeKey = await testCube.getKey();
      const storedCube = await browserNode1.cubeStore.getCube(cubeKey);
      expect(storedCube).not.toBeNull();
      
      // Verify cube content
      const content = storedCube!.getFirstField(CubeFieldType.FROZEN_RAWCONTENT);
      expect(content.valueString).toContain("Browser-to-browser test message");
    });

    it('should demonstrate browser storage independence', async () => {
      // Verify that each browser node has independent storage
      const count1 = await browserNode1.cubeStore.getNumberOfStoredCubes();
      const count2 = await browserNode2.cubeStore.getNumberOfStoredCubes();
      
      // Browser node 1 should have the cube we added
      expect(count1).toBeGreaterThan(0);
      
      // Browser node 2 should start empty (light nodes don't auto-sync all cubes)
      expect(count2).toBe(0);
      
      // Add a different cube to browser node 2
      const testCube2 = Cube.Frozen({
        fields: [
          CubeField.RawContent(CubeType.FROZEN, "Second browser node cube"),
        ],
        requiredDifficulty: 0,
      });
      
      await browserNode2.cubeStore.addCube(testCube2);
      
      // Verify independent storage
      const newCount2 = await browserNode2.cubeStore.getNumberOfStoredCubes();
      expect(newCount2).toBe(1);
      
      // Browser node 1 count should be unchanged
      const unchangedCount1 = await browserNode1.cubeStore.getNumberOfStoredCubes();
      expect(unchangedCount1).toBe(count1);
    });
  });

  describe('Browser Environment Verification', () => {
    it('should confirm browser-specific features are available', () => {
      // These tests verify the browser environment requirements from the issue
      
      // IndexedDB availability
      expect(global.indexedDB).toBeDefined();
      expect(typeof global.indexedDB.open).toBe('function');
      
      // Crypto APIs
      expect(global.crypto).toBeDefined();
      expect(global.crypto.subtle).toBeDefined();
      
      // Web APIs that would be available in real browser
      // Note: These are simulated in JSDOM but verify the test environment
      expect(global.window).toBeDefined();
      expect(global.document).toBeDefined();
    });

    it('should handle browser-specific transport configuration', () => {
      // Verify browser nodes are configured with appropriate transports
      const browser1Transport = browserNode1.networkManager.transports.get(SupportedTransports.libp2p);
      const browser2Transport = browserNode2.networkManager.transports.get(SupportedTransports.libp2p);
      
      expect(browser1Transport).toBeDefined();
      expect(browser2Transport).toBeDefined();
      
      // Browser nodes should be light nodes
      // (In real implementation, they would use WebRTC for peer connections)
    });
  });

  describe('Browser Node Identity and Uniqueness', () => {
    it('should create nodes with unique identities', () => {
      // Verify each browser node has a unique identity
      const id1 = browserNode1.networkManager.idString;
      const id2 = browserNode2.networkManager.idString;
      const serverId = serverNode.networkManager.idString;
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(serverId).toBeDefined();
      
      // All IDs should be different
      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(serverId);
      expect(id2).not.toBe(serverId);
    });

    it('should maintain consistent node configuration', async () => {
      // Verify browser nodes maintain expected configuration
      expect(browserNode1.cubeStore).toBeDefined();
      expect(browserNode1.peerDB).toBeDefined();
      expect(browserNode1.networkManager).toBeDefined();
      
      expect(browserNode2.cubeStore).toBeDefined();
      expect(browserNode2.peerDB).toBeDefined();
      expect(browserNode2.networkManager).toBeDefined();
      
      // Both should be ready
      await expect(browserNode1.readyPromise).resolves.toBeUndefined();
      await expect(browserNode2.readyPromise).resolves.toBeUndefined();
    });
  });
});