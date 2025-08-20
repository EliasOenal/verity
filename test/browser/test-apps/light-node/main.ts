/**
 * Light Node Test Application
 * 
 * This is a minimal web application for testing light Verity node functionality.
 * It initializes basic functionality for testing purposes.
 */

import { isBrowser } from 'browser-or-node';
import sodium from 'libsodium-wrappers-sumo';

async function initializeLightNodeTest(): Promise<void> {
  if (!isBrowser) {
    throw new Error('Light node test must be run in browser environment');
  }

  console.log('Initializing light node test application');

  // Wait for libsodium to be ready
  await sodium.ready;

  // Expose simple test utilities to global scope for tests
  (window as any).verity = {
    nodeType: 'light-node',
    testUtils: {
      createTestData: async () => {
        const data = `LIGHT-NODE-${Date.now()}-${Math.random()}`;
        return {
          success: true,
          data: data,
          length: data.length
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
          timestamp: Date.now(),
          capabilities: ['basic-storage', 'client-mode']
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
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Test Optimizations:</strong> Active</p>
    `;
  }

  console.log('Light node test application ready');
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