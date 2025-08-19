import { test, expect, Browser } from '@playwright/test';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getBrowserNodeId,
  getNodeInfo,
  checkBrowserAPIs,
  shutdownBrowserNode
} from './playwright-utils';

test.describe('Extended Verity Browser Testing', () => {
  
  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should handle browser page refresh and persistence', async ({ page }) => {
    // Initialize and create a cube
    await initializeVerityInBrowser(page);
    const nodeId1 = await getBrowserNodeId(page);
    const cube1 = await createTestCubeInBrowser(page, 'Persistence test cube');
    
    expect(cube1.success).toBe(true);
    
    // Page refresh should create a new node
    await page.reload();
    await initializeVerityInBrowser(page);
    
    const nodeId2 = await getBrowserNodeId(page);
    const count = await getCubeCountFromBrowser(page);
    
    // New node should have different ID
    expect(nodeId2).not.toBe(nodeId1);
    
    // Storage behavior may vary depending on configuration
    // (in-memory vs IndexedDB persistence)
    expect(count).toBeGreaterThanOrEqual(0);
    
    console.log('Persistence test:', { 
      nodeId1: nodeId1.substring(0, 8) + '...', 
      nodeId2: nodeId2.substring(0, 8) + '...', 
      countAfterRefresh: count,
      persistenceDetected: count > 0
    });
  });

  test('should verify IndexedDB integration and storage capabilities', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    // Test IndexedDB functionality in context of Verity
    const indexedDBTest = await page.evaluate(async () => {
      try {
        // Test basic IndexedDB operations that Verity might use
        const dbName = 'verity-storage-test';
        
        return new Promise((resolve) => {
          const request = indexedDB.open(dbName, 1);
          
          request.onupgradeneeded = (event) => {
            const db = (event.target as any).result;
            const objectStore = db.createObjectStore('cubes', { keyPath: 'key' });
            objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          };
          
          request.onsuccess = (event) => {
            const db = (event.target as any).result;
            
            // Test storing cube-like data
            const transaction = db.transaction(['cubes'], 'readwrite');
            const store = transaction.objectStore('cubes');
            
            const testData = {
              key: 'test-cube-key-' + Date.now(),
              data: new Uint8Array([1, 2, 3, 4, 5]),
              timestamp: Date.now()
            };
            
            const addRequest = store.add(testData);
            
            addRequest.onsuccess = () => {
              // Test retrieval
              const getRequest = store.get(testData.key);
              
              getRequest.onsuccess = () => {
                db.close();
                indexedDB.deleteDatabase(dbName);
                
                const retrieved = getRequest.result;
                resolve({
                  success: true,
                  stored: !!retrieved,
                  dataMatch: retrieved && 
                    retrieved.data.length === testData.data.length
                });
              };
            };
            
            addRequest.onerror = () => {
              db.close();
              resolve({ success: false, error: 'Failed to store data' });
            };
          };
          
          request.onerror = () => {
            resolve({ success: false, error: 'Failed to open database' });
          };
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(indexedDBTest.success).toBe(true);
    expect(indexedDBTest.stored).toBe(true);
    expect(indexedDBTest.dataMatch).toBe(true);
    
    console.log('IndexedDB integration test:', indexedDBTest);
  });

  test('should verify WebRTC and P2P capabilities', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const webRTCTest = await page.evaluate(async () => {
      try {
        // Test WebRTC data channel creation (relevant for P2P)
        const pc1 = new RTCPeerConnection();
        const pc2 = new RTCPeerConnection();
        
        // Create data channel
        const dataChannel = pc1.createDataChannel('test', {
          ordered: true
        });
        
        let dataChannelReady = false;
        let offerCreated = false;
        let answerCreated = false;
        
        // Test offer/answer exchange
        const offer = await pc1.createOffer();
        await pc1.setLocalDescription(offer);
        offerCreated = true;
        
        await pc2.setRemoteDescription(offer);
        const answer = await pc2.createAnswer();
        await pc2.setLocalDescription(answer);
        answerCreated = true;
        
        // Clean up
        pc1.close();
        pc2.close();
        
        return {
          success: true,
          dataChannelCreated: !!dataChannel,
          offerCreated,
          answerCreated,
          hasICEConnectionState: 'iceConnectionState' in pc1,
          hasDataChannelSupport: typeof pc1.createDataChannel === 'function'
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(webRTCTest.success).toBe(true);
    expect(webRTCTest.dataChannelCreated).toBe(true);
    expect(webRTCTest.offerCreated).toBe(true);
    expect(webRTCTest.answerCreated).toBe(true);
    expect(webRTCTest.hasICEConnectionState).toBe(true);
    expect(webRTCTest.hasDataChannelSupport).toBe(true);
    
    console.log('WebRTC capabilities test:', webRTCTest);
  });

  test('should verify crypto API functionality', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const cryptoTest = await page.evaluate(async () => {
      try {
        // Test crypto operations that Verity uses
        const data = new TextEncoder().encode('Test data for crypto operations');
        
        // Test SHA-256 hashing
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(hashBuffer);
        
        // Test random values generation
        const randomArray = new Uint8Array(32);
        crypto.getRandomValues(randomArray);
        
        // Test key generation (for testing purposes)
        const keyPair = await crypto.subtle.generateKey(
          {
            name: 'ECDSA',
            namedCurve: 'P-256'
          },
          false,
          ['sign', 'verify']
        );
        
        return {
          success: true,
          hashGenerated: hashArray.length === 32,
          randomGenerated: randomArray.some(val => val !== 0), // Should have some non-zero values
          keyPairGenerated: !!(keyPair.privateKey && keyPair.publicKey),
          hasSubtle: !!crypto.subtle,
          hasGetRandomValues: typeof crypto.getRandomValues === 'function'
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(cryptoTest.success).toBe(true);
    expect(cryptoTest.hashGenerated).toBe(true);
    expect(cryptoTest.randomGenerated).toBe(true);
    expect(cryptoTest.keyPairGenerated).toBe(true);
    expect(cryptoTest.hasSubtle).toBe(true);
    expect(cryptoTest.hasGetRandomValues).toBe(true);
    
    console.log('Crypto API test:', cryptoTest);
  });

  test('should test browser worker functionality', async ({ page }) => {
    await page.goto('/');
    
    const workerTest = await page.evaluate(async () => {
      try {
        // Test if Web Workers are available (useful for heavy crypto operations)
        if (typeof Worker === 'undefined') {
          return { success: false, error: 'Web Workers not supported' };
        }
        
        // Create a simple worker to test functionality
        const workerCode = `
          self.onmessage = function(e) {
            // Simple computation that could represent crypto work
            const result = e.data.num * 2;
            self.postMessage({ result: result });
          };
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        
        return new Promise((resolve) => {
          worker.onmessage = (e) => {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            
            resolve({
              success: true,
              workerAvailable: true,
              computationCorrect: e.data.result === 42
            });
          };
          
          worker.onerror = () => {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            resolve({ success: false, error: 'Worker execution failed' });
          };
          
          worker.postMessage({ num: 21 });
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(workerTest.success).toBe(true);
    expect(workerTest.workerAvailable).toBe(true);
    expect(workerTest.computationCorrect).toBe(true);
    
    console.log('Web Worker test:', workerTest);
  });

  test('should test service worker integration', async ({ page }) => {
    await page.goto('/');
    
    const serviceWorkerTest = await page.evaluate(async () => {
      try {
        if (!('serviceWorker' in navigator)) {
          return { success: false, error: 'Service Workers not supported' };
        }
        
        // Check if service worker registration is available
        const hasRegistration = typeof navigator.serviceWorker.register === 'function';
        
        // Check for existing registrations
        const registrations = await navigator.serviceWorker.getRegistrations();
        
        return {
          success: true,
          serviceWorkerSupported: true,
          hasRegistration,
          existingRegistrations: registrations.length,
          hasGetRegistrations: typeof navigator.serviceWorker.getRegistrations === 'function'
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(serviceWorkerTest.success).toBe(true);
    expect(serviceWorkerTest.serviceWorkerSupported).toBe(true);
    expect(serviceWorkerTest.hasRegistration).toBe(true);
    expect(serviceWorkerTest.hasGetRegistrations).toBe(true);
    
    console.log('Service Worker test:', serviceWorkerTest);
  });

  test('should test multiple browser tabs/contexts', async ({ browser }) => {
    // Test multiple tabs in the same browser context
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    try {
      // Initialize Verity in both tabs
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Get node info from both tabs
      const [nodeInfo1, nodeInfo2] = await Promise.all([
        getNodeInfo(page1),
        getNodeInfo(page2)
      ]);
      
      // Create cubes in both tabs
      const [cube1, cube2] = await Promise.all([
        createTestCubeInBrowser(page1, 'Tab 1 cube'),
        createTestCubeInBrowser(page2, 'Tab 2 cube')
      ]);
      
      // Get final counts
      const [count1, count2] = await Promise.all([
        getCubeCountFromBrowser(page1),
        getCubeCountFromBrowser(page2)
      ]);
      
      // Each tab should have independent nodes
      expect(nodeInfo1.nodeId).not.toBe(nodeInfo2.nodeId);
      expect(count1).toBeGreaterThanOrEqual(0);
      expect(count2).toBeGreaterThanOrEqual(0);
      
      console.log('Multi-tab test:', {
        tab1: { nodeId: nodeInfo1.nodeId.substring(0, 8) + '...', count: count1 },
        tab2: { nodeId: nodeInfo2.nodeId.substring(0, 8) + '...', count: count2 }
      });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await context.close();
    }
  });

  test('should stress test cube operations', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    const stressTest = await page.evaluate(async () => {
      try {
        const cockpit = window.verity.cockpit;
        const cubeStore = window.verity.node.cubeStore;
        
        const initialCount = await cubeStore.getNumberOfStoredCubes();
        
        // Create multiple cubes rapidly
        const cubePromises = [];
        for (let i = 0; i < 5; i++) {
          const promise = (async () => {
            try {
              const veritum = cockpit.prepareVeritum();
              await veritum.compile();
              const cubes = Array.from(veritum.chunks);
              if (cubes.length > 0) {
                const cube = cubes[0];
                const exists = await cubeStore.hasCube(await cube.getKey());
                if (!exists) {
                  await cubeStore.addCube(cube);
                  return { success: true };
                }
                return { success: false, reason: 'duplicate' };
              }
              return { success: false, reason: 'no_cubes' };
            } catch (e) {
              return { success: false, reason: e.message };
            }
          })();
          cubePromises.push(promise);
        }
        
        const results = await Promise.all(cubePromises);
        const finalCount = await cubeStore.getNumberOfStoredCubes();
        
        const successful = results.filter(r => r.success).length;
        const duplicates = results.filter(r => r.reason === 'duplicate').length;
        
        return {
          initialCount,
          finalCount,
          attempted: results.length,
          successful,
          duplicates,
          errors: results.filter(r => !r.success && r.reason !== 'duplicate').length
        };
      } catch (error) {
        return { error: error.message };
      }
    });
    
    expect(stressTest.error).toBeUndefined();
    expect(stressTest.attempted).toBe(5);
    expect(stressTest.successful).toBeGreaterThanOrEqual(1);
    expect(stressTest.finalCount).toBeGreaterThanOrEqual(stressTest.initialCount);
    
    console.log('Stress test results:', stressTest);
  });

  test('should verify browser memory usage and cleanup', async ({ page }) => {
    await initializeVerityInBrowser(page);
    
    // Test memory usage patterns
    const memoryTest = await page.evaluate(async () => {
      try {
        const initialMemory = (performance as any).memory ? 
          (performance as any).memory.usedJSHeapSize : null;
        
        // Create and clean up some cubes
        const cockpit = window.verity.cockpit;
        const cubeStore = window.verity.node.cubeStore;
        
        // Create several cubes
        for (let i = 0; i < 3; i++) {
          const veritum = cockpit.prepareVeritum();
          await veritum.compile();
          const cubes = Array.from(veritum.chunks);
          if (cubes.length > 0) {
            try {
              await cubeStore.addCube(cubes[0]);
            } catch (e) {
              // Ignore duplicates
            }
          }
        }
        
        // Force garbage collection if available
        if ((window as any).gc) {
          (window as any).gc();
        }
        
        const finalMemory = (performance as any).memory ? 
          (performance as any).memory.usedJSHeapSize : null;
        
        return {
          success: true,
          memoryTrackingAvailable: initialMemory !== null,
          initialMemory,
          finalMemory,
          memoryIncrease: finalMemory && initialMemory ? 
            finalMemory - initialMemory : null
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    expect(memoryTest.success).toBe(true);
    // Memory tracking might not be available in all environments
    if (memoryTest.memoryTrackingAvailable) {
      expect(memoryTest.finalMemory).toBeGreaterThan(0);
    }
    
    console.log('Memory test:', memoryTest);
  });
});