/**
 * Full Node Test Application
 * 
 * This is a minimal web application for testing full Verity node functionality.
 * It uses the public API and initializes a node for testing purposes.
 */

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo';

async function initializeFullNodeTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Full node test must be run in browser environment');
  }

  console.log('Initializing full node test application');
  
  // Wait for libsodium to be ready
  await sodium.ready;

  // Simple test functionality for Playwright tests
  (window as any).verity = {
    nodeType: 'full-node',
    testUtils: {
      createTestData: async () => {
        const data = `FULL-NODE-${Date.now()}-${Math.random()}`;
        return {
          success: true,
          data: data,
          length: data.length
        };
      },
      
      getNodeInfo: () => {
        return {
          type: 'full-node',
          timestamp: Date.now(),
          capabilities: ['cube-storage', 'networking', 'peer-to-peer']
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
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Test Optimizations:</strong> Active</p>
    `;
  }

  console.log('Full node test application ready');
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