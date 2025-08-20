/**
 * Full Node Test Application
 * 
 * This is a minimal web application for testing full Verity node functionality.
 * It initializes a full node with testCoreOptions built-in for optimal test performance.
 */

import { VerityNode } from 'verity-core/cci/verityNode.js';
import { Cockpit } from 'verity-core/cci/cockpit.js';
import { coreCubeFamily } from 'verity-core/core/cube/cube.js';
import { cciFamily } from 'verity-core/cci/cube/cciCube.js';
import { SupportedTransports } from 'verity-core/core/networking/networkDefinitions.js';
import { defaultInitialPeers } from 'verity-core/core/coreNode.js';
import { isBrowser } from 'browser-or-node';
import { logger } from 'verity-core/core/logger.js';
import sodium from 'libsodium-wrappers-sumo';

interface TestCoreOptions {
  inMemory: boolean;
  requiredDifficulty: number;
  networkTimeoutMillis: number;
  announceToTorrentTrackers: boolean;
}

// Test optimizations equivalent to testCoreOptions from Node.js tests
const testCoreOptions: TestCoreOptions = {
  inMemory: true,
  requiredDifficulty: 0,
  networkTimeoutMillis: 100,
  announceToTorrentTrackers: false,
};

async function initializeFullNodeTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Full node test must be run in browser environment');
  }

  logger.info('Initializing full node test application');

  // Wait for libsodium to be ready
  await sodium.ready;

  // Configure full node with test optimizations built-in
  const nodeOptions = {
    // Built-in test optimizations for fast execution
    ...testCoreOptions,
    
    // Full node configuration
    lightNode: false,
    useRelaying: true,
    transports: new Map([[SupportedTransports.libp2p, ['/webrtc']]]),
    initialPeers: defaultInitialPeers,
    family: [cciFamily, coreCubeFamily]
  };

  // Create and initialize the node
  const node = new VerityNode(nodeOptions);
  const cockpit = new Cockpit(node);

  // Wait for node to be ready
  await node.readyPromise;

  // Expose to global scope for tests
  (window as any).verity = {
    node: node,
    cockpit: cockpit,
    testUtils: {
      createUniqueTestCube: async (content?: string) => {
        const uniqueContent = content || `TEST-${Date.now()}-${Math.random()}`;
        
        try {
          const veritum = cockpit.prepareVeritum();
          
          // Add unique content to ensure different cubes
          if (veritum.fields && veritum.fields.insertTillFull) {
            const payloadField = { 
              type: 4, // PAYLOAD type
              data: new TextEncoder().encode(uniqueContent) 
            };
            veritum.fields.insertTillFull([payloadField]);
          }
          
          await veritum.compile();
          const cubes = Array.from(veritum.chunks);
          
          if (cubes.length === 0) {
            throw new Error('No cubes generated from veritum');
          }
          
          const cube = cubes[0];
          const key = await cube.getKey();
          
          // Store the cube
          await node.cubeStore.addCube(cube);
          
          return {
            success: true,
            cubeKey: key,
            keyHex: key.toString('hex').substring(0, 32) + '...'
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    }
  };

  // Update UI
  const statusEl = document.getElementById('status');
  const nodeInfoEl = document.getElementById('nodeInfo');
  
  if (statusEl) {
    statusEl.textContent = 'Full node ready!';
  }
  
  if (nodeInfoEl) {
    nodeInfoEl.innerHTML = `
      <h3>Node Information</h3>
      <p><strong>Node ID:</strong> ${node.networkManager.idString}</p>
      <p><strong>Node Type:</strong> ${node.constructor.name}</p>
      <p><strong>Light Node:</strong> ${node.isLightNode ? 'Yes' : 'No'}</p>
      <p><strong>Cube Count:</strong> <span id="cubeCount">${await node.cubeStore.getNumberOfStoredCubes()}</span></p>
      <p><strong>Online Peers:</strong> <span id="peerCount">${node.networkManager.onlinePeers.length}</span></p>
      <p><strong>Test Optimizations:</strong> Active</p>
    `;
  }

  logger.info('Full node test application ready');
}

// Initialize when page loads
if (isBrowser) {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = 'Initializing full node...';
      }
      
      await initializeFullNodeTest();
    } catch (error) {
      logger.error('Failed to initialize full node test:', error);
      
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = `Error: ${(error as Error).message}`;
      }
    }
  });
}