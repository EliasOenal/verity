/**
 * Light Node Test Application
 *
 * This is a minimal web application for testing light Verity node functionality.
 * It uses the real Verity library with testCoreOptions for fast testing.
 */

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo';
import { VerityNode } from '../../../../src/cci/verityNode';
import { Cockpit } from '../../../../src/cci/cockpit';
import { VerityField } from '../../../../src/cci/cube/verityField';
import { Cube } from '../../../../src/cci/cube/cube';
import { testCoreOptions } from '../../../core/testcore.definition';
import { testCciOptions } from '../../../cci/testcci.definitions';
import { Peer } from '../../../../src/core/peering/peer';
import { WebSocketAddress } from '../../../../src/core/peering/addressing';

let verityNode: VerityNode | null = null;
let cockpit: Cockpit | null = null;

async function initializeLightNodeTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Light node test must be run in browser environment');
  }

  console.log('Initializing light node test application with real Verity library');

  // Wait for libsodium to be ready
  await sodium.ready;

  try {
    // Create a real VerityNode in light mode with test optimizations
    verityNode = new VerityNode({
      ...testCciOptions,
      lightNode: true,   // Light node mode
      inMemory: true,    // Fast in-memory storage
      requiredDifficulty: 0,  // No proof-of-work for testing
      announceToTorrentTrackers: false,
      networkTimeoutMillis: 100,
      autoConnect: false, // Don't try to connect to external peers in test environment
    });

    await verityNode.readyPromise;
    console.log('VerityNode (light) initialized successfully');

    // Create cockpit for veritum operations
    cockpit = new Cockpit(verityNode);

    // Create Verity interface that Playwright tests expect
    (window as any).verity = {
      nodeType: 'light-node',
      node: verityNode,
      cubeStore: verityNode.cubeStore,
      cockpit: cockpit,  // Add cockpit for cube creation
      VerityField: VerityField,  // Export VerityField for Playwright tests
      cciCube: Cube, // Expose Cube class for direct CCI cube creation tests (parity with full-node test app)
      Peer: Peer,  // Export Peer class for connections
      WebSocketAddress: WebSocketAddress,  // Export WebSocketAddress class for connections
      testUtils: {
        createTestData: async () => {
          const data = `LIGHT-NODE-${Date.now()}-${Math.random()}`;
          return {
            success: true,
            data: data,
            length: data.length,
            nodeId: `light-node-${Date.now()}-${Math.random().toString(36).substring(2)}`
          };
        },

        createMultipleTestItems: async (count: number) => {
          const results = [];
          for (let i = 0; i < count; i++) {
            const result = await (window as any).verity.testUtils.createTestData();
            results.push({...result, index: i});
            // Small delay to ensure uniqueness
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          return results;
        },

        getNodeInfo: () => {
          return {
            type: 'light-node',
            nodeId: `light-node-${Date.now()}-${Math.random().toString(36).substring(2)}`,
            timestamp: Date.now(),
            capabilities: ['basic-storage', 'client-mode'],
            cubeCount: verityNode?.cubeStore.getNumberOfStoredCubes() || 0
          };
        }
      }
    };

    // Update UI
    const statusEl = document.getElementById('status');
    const nodeInfoEl = document.getElementById('nodeInfo');

    if (statusEl) {
      statusEl.textContent = 'Light node test ready!';
    }

    if (nodeInfoEl) {
      nodeInfoEl.innerHTML = `
        <h3>Light Node Test Information</h3>
        <p><strong>Status:</strong> Ready</p>
        <p><strong>Type:</strong> Light Node Test</p>
        <p><strong>Node ID:</strong> light-${Date.now()}</p>
        <p><strong>Cubes:</strong> <span id="cubeCount">${verityNode.cubeStore.getNumberOfStoredCubes()}</span></p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p><strong>Test Optimizations:</strong> Active</p>
      `;
    }

    console.log('Light node test application ready');

  } catch (error) {
    console.error('Failed to initialize VerityNode:', error);

    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = `Error: ${(error as Error).message}`;
    }
    throw error;
  }
}

// Initialize when page loads
if (isBrowser) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = 'Initializing light node test...';
      }

      await initializeLightNodeTest();
    } catch (error) {
      console.error('Failed to initialize light node test:', error);

      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `Error: ${(error as Error).message}`;
      }
    }
  });
}