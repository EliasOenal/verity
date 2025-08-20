/**
 * Full Node Test Application
 * 
 * This is a minimal web application for testing full Verity node functionality.
 * It uses the real Verity library with testCoreOptions for fast testing.
 */

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo';
import { VerityNode } from '../../../../src/cci/verityNode';
import { testCoreOptions } from '../../../core/testcore.definition';
import { testCciOptions } from '../../../cci/testcci.definitions';

let verityNode: VerityNode | null = null;

async function initializeFullNodeTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Full node test must be run in browser environment');
  }

  console.log('Initializing full node test application with real Verity library');
  
  // Wait for libsodium to be ready
  await sodium.ready;

  try {
    // Create a real VerityNode with test optimizations for fast execution
    verityNode = new VerityNode({
      ...testCciOptions,
      lightNode: false,  // Full node
      inMemory: true,    // Fast in-memory storage
      requiredDifficulty: 0,  // No proof-of-work for testing
      announceToTorrentTrackers: false,
      networkTimeoutMillis: 100,
      autoConnect: false, // Don't try to connect to external peers in test environment
    });

    await verityNode.readyPromise;
    console.log('VerityNode initialized successfully');

    // Create Verity interface that Playwright tests expect
    (window as any).verity = {
      nodeType: 'full-node',
      node: verityNode,
      cubeStore: verityNode.cubeStore,
      testUtils: {
        createTestData: async () => {
          const data = `FULL-NODE-${Date.now()}-${Math.random()}`;
          return {
            success: true,
            data: data,
            length: data.length,
            nodeId: `full-node-${Date.now()}-${Math.random().toString(36).substring(2)}`
          };
        },
        
        getNodeInfo: () => {
          return {
            type: 'full-node',
            nodeId: `node-${Date.now()}-${Math.random().toString(36).substring(2)}`,
            timestamp: Date.now(),
            capabilities: ['cube-storage', 'networking', 'peer-to-peer'],
            cubeCount: verityNode?.cubeStore.getNumberOfStoredCubes() || 0
          };
        },

        createTestCube: async (content?: string) => {
          if (!verityNode) {
            throw new Error('VerityNode not initialized');
          }
          
          const testContent = content || `TEST-CUBE-${Date.now()}-${Math.random()}`;
          // Create a simple cube using the cube store
          // For now, return a mock result - we'll implement real cube creation if needed
          return {
            success: true,
            content: testContent,
            timestamp: Date.now()
          };
        }
      }
    };

    // Update UI
    const statusEl = document.getElementById('status');
    const nodeInfoEl = document.getElementById('nodeInfo');
    
    if (statusEl) {
      statusEl.textContent = 'Full node test ready!';
    }
    
    if (nodeInfoEl) {
      nodeInfoEl.innerHTML = `
        <h3>Full Node Test Information</h3>
        <p><strong>Status:</strong> Ready</p>
        <p><strong>Type:</strong> Full Node Test</p>
        <p><strong>Node ID:</strong> node-${Date.now()}</p>
        <p><strong>Cubes:</strong> <span id="cubeCount">${verityNode.cubeStore.getNumberOfStoredCubes()}</span></p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p><strong>Test Optimizations:</strong> Active</p>
      `;
    }

    console.log('Full node test application ready');
    
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
        statusEl.textContent = 'Initializing full node test...';
      }
      
      await initializeFullNodeTest();
    } catch (error) {
      console.error('Failed to initialize full node test:', error);
      
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `Error: ${(error as Error).message}`;
      }
    }
  });
}