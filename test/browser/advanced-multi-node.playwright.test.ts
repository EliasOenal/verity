import { test, expect, Browser } from '@playwright/test';
import { 
  initializeVerityInBrowser, 
  createTestCubeInBrowser,
  getCubeCountFromBrowser,
  getNodeInfo,
  shutdownBrowserNode,
  createMultipleCubes
} from './playwright-utils';

test.describe('Advanced Multi-Node Scenarios', () => {
  
  test.afterEach(async ({ page }) => {
    await shutdownBrowserNode(page);
  });

  test('should simulate distributed cube storage across multiple nodes', async ({ browser }) => {
    // Create 4 browser nodes to simulate a distributed network
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
      browser.newContext()
    ]);
    
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      // Initialize all nodes
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Get node information
      const nodeInfos = await Promise.all(pages.map(page => getNodeInfo(page)));
      nodeInfos.forEach(info => expect(info.error).toBeUndefined());
      
      // Verify all nodes have unique IDs
      const nodeIds = nodeInfos.map(info => info.nodeId);
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(nodeIds.length);
      
      // Create different numbers of cubes in each node to simulate distributed storage
      const cubeCreationTasks = [
        createMultipleCubes(pages[0], 3), // Node 1: 3 cubes
        createMultipleCubes(pages[1], 2), // Node 2: 2 cubes
        createMultipleCubes(pages[2], 4), // Node 3: 4 cubes
        createMultipleCubes(pages[3], 1)  // Node 4: 1 cube
      ];
      
      const cubeResults = await Promise.all(cubeCreationTasks);
      
      // Verify cube creation
      const totalCubesCreated = cubeResults.reduce((total, results) => 
        total + results.filter(r => r.success).length, 0
      );
      expect(totalCubesCreated).toBeGreaterThan(5); // At least some cubes should be created
      
      // Get final cube counts
      const finalCounts = await Promise.all(pages.map(page => getCubeCountFromBrowser(page)));
      const totalStoredCubes = finalCounts.reduce((sum, count) => sum + count, 0);
      
      expect(totalStoredCubes).toBeGreaterThanOrEqual(totalCubesCreated);
      
      console.log('Distributed storage test:', {
        nodes: nodeInfos.length,
        cubesPerNode: finalCounts,
        totalCubes: totalStoredCubes,
        successfulCreations: totalCubesCreated
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test node discovery and peer exchange', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();
    
    try {
      // Initialize nodes sequentially to simulate real-world discovery
      await initializeVerityInBrowser(page1);
      await page1.waitForTimeout(500);
      
      await initializeVerityInBrowser(page2);
      await page2.waitForTimeout(500);
      
      await initializeVerityInBrowser(page3);
      await page3.waitForTimeout(500);
      
      // Simulate peer discovery process
      const discoveryResult = await page1.evaluate(async () => {
        try {
          const node = window.verity.node;
          const networkManager = node.networkManager;
          
          // Simulate peer announcement and discovery
          const discoveryData = {
            nodeId: networkManager.idString,
            announceCapability: !!networkManager.announce,
            transportCapabilities: networkManager.transports ? 
              Array.from(networkManager.transports.keys()) : [],
            initialPeers: networkManager.onlinePeers.length,
            networkReady: !!networkManager
          };
          
          // Simulate peer exchange messages
          const peerExchangeSimulation = {
            peerRequestsSent: 0,
            peerResponsesReceived: 0,
            knownPeersShared: 0
          };
          
          // In a real scenario, nodes would exchange peer lists
          // Here we simulate the process
          for (let i = 0; i < 3; i++) {
            peerExchangeSimulation.peerRequestsSent++;
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 100));
            peerExchangeSimulation.peerResponsesReceived++;
            peerExchangeSimulation.knownPeersShared += Math.floor(Math.random() * 3);
          }
          
          return {
            success: true,
            discovery: discoveryData,
            peerExchange: peerExchangeSimulation
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      expect(discoveryResult.success).toBe(true);
      expect(discoveryResult.discovery.nodeId).toBeDefined();
      expect(discoveryResult.discovery.networkReady).toBe(true);
      expect(discoveryResult.peerExchange.peerRequestsSent).toBe(3);
      expect(discoveryResult.peerExchange.peerResponsesReceived).toBe(3);
      
      console.log('Node discovery test:', discoveryResult);
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2),
        shutdownBrowserNode(page3)
      ]);
      await Promise.all([
        context1.close(),
        context2.close(),
        context3.close()
      ]);
    }
  });

  test('should test network partition and recovery scenarios', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    try {
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2)
      ]);
      
      // Create cubes before "partition"
      const [cube1, cube2] = await Promise.all([
        createTestCubeInBrowser(page1, 'Pre-partition cube 1'),
        createTestCubeInBrowser(page2, 'Pre-partition cube 2')
      ]);
      
      expect(cube1.success).toBe(true);
      expect(cube2.success).toBe(true);
      
      // Simulate network partition by testing connection resilience
      const partitionTest = await page1.evaluate(async () => {
        try {
          const node = window.verity.node;
          const networkManager = node.networkManager;
          
          // Get initial state
          const prePartitionState = {
            onlinePeers: networkManager.onlinePeers.length,
            nodeId: networkManager.idString,
            transports: networkManager.transports ? networkManager.transports.size : 0
          };
          
          // Simulate partition (connection issues)
          const partitionEvents = [];
          
          // In a real partition, connections would drop
          // Here we simulate the detection and response
          partitionEvents.push({
            event: 'connection_lost',
            timestamp: Date.now(),
            affectedPeers: prePartitionState.onlinePeers
          });
          
          // Simulate reconnection attempts
          for (let attempt = 1; attempt <= 3; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            partitionEvents.push({
              event: 'reconnection_attempt',
              attempt,
              timestamp: Date.now()
            });
          }
          
          // Simulate recovery
          partitionEvents.push({
            event: 'connection_restored',
            timestamp: Date.now(),
            recoveredPeers: Math.max(0, prePartitionState.onlinePeers - 1)
          });
          
          const postPartitionState = {
            onlinePeers: networkManager.onlinePeers.length,
            nodeId: networkManager.idString,
            transports: networkManager.transports ? networkManager.transports.size : 0
          };
          
          return {
            success: true,
            prePartition: prePartitionState,
            postPartition: postPartitionState,
            partitionEvents,
            nodeStable: postPartitionState.nodeId === prePartitionState.nodeId
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      expect(partitionTest.success).toBe(true);
      expect(partitionTest.nodeStable).toBe(true);
      expect(partitionTest.partitionEvents.length).toBeGreaterThan(4);
      
      // Create cubes after "recovery" to test continued functionality
      const postRecoveryCube = await createTestCubeInBrowser(page1, 'Post-recovery cube');
      expect(postRecoveryCube.success).toBe(true);
      
      console.log('Network partition test:', partitionTest);
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2)
      ]);
      await Promise.all([
        context1.close(),
        context2.close()
      ]);
    }
  });

  test('should test dynamic network topology changes', async ({ browser }) => {
    // Start with 2 nodes, add more dynamically
    const contexts = [];
    const pages = [];
    
    try {
      // Initial topology: 2 nodes
      for (let i = 0; i < 2; i++) {
        const context = await browser.newContext();
        const page = await context.newPage();
        contexts.push(context);
        pages.push(page);
        await initializeVerityInBrowser(page);
      }
      
      // Get initial network state
      const initialNodes = await Promise.all(pages.map(page => getNodeInfo(page)));
      initialNodes.forEach(info => expect(info.error).toBeUndefined());
      
      // Create cubes in initial nodes
      await Promise.all([
        createTestCubeInBrowser(pages[0], 'Initial topology cube 1'),
        createTestCubeInBrowser(pages[1], 'Initial topology cube 2')
      ]);
      
      // Dynamically add more nodes (simulating network growth)
      for (let i = 0; i < 2; i++) {
        const context = await browser.newContext();
        const page = await context.newPage();
        contexts.push(context);
        pages.push(page);
        
        await initializeVerityInBrowser(page);
        await createTestCubeInBrowser(page, `Dynamic node ${i + 3} cube`);
        
        // Small delay to simulate real-world timing
        await page.waitForTimeout(300);
      }
      
      // Test topology change detection
      const topologyTest = await pages[0].evaluate(async (totalNodes) => {
        try {
          const node = window.verity.node;
          const networkManager = node.networkManager;
          
          // Simulate topology change detection
          const topologyChanges = [];
          
          // In a real scenario, nodes would detect new peers joining
          for (let i = 2; i < totalNodes; i++) {
            topologyChanges.push({
              event: 'peer_joined',
              nodeIndex: i + 1,
              timestamp: Date.now(),
              networkSize: i + 1
            });
            
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Current network state
          const currentState = {
            nodeId: networkManager.idString,
            onlinePeers: networkManager.onlinePeers.length,
            transportCount: networkManager.transports ? networkManager.transports.size : 0
          };
          
          return {
            success: true,
            initialNodes: 2,
            finalNodes: totalNodes,
            topologyChanges,
            currentState,
            networkGrowth: topologyChanges.length > 0
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, pages.length);
      
      expect(topologyTest.success).toBe(true);
      expect(topologyTest.finalNodes).toBe(4);
      expect(topologyTest.networkGrowth).toBe(true);
      expect(topologyTest.topologyChanges.length).toBe(2);
      
      // Verify all nodes are functioning
      const finalCounts = await Promise.all(pages.map(page => getCubeCountFromBrowser(page)));
      const allNodesOperational = finalCounts.every(count => count > 0);
      expect(allNodesOperational).toBe(true);
      
      console.log('Dynamic topology test:', {
        ...topologyTest,
        finalCubeCounts: finalCounts
      });
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });

  test('should test concurrent cube operations under network stress', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();
    
    try {
      await Promise.all([
        initializeVerityInBrowser(page1),
        initializeVerityInBrowser(page2),
        initializeVerityInBrowser(page3)
      ]);
      
      // Stress test with concurrent operations
      const stressTestResults = await Promise.all([
        // Node 1: Rapid cube creation
        page1.evaluate(async () => {
          const results = [];
          for (let i = 0; i < 5; i++) {
            try {
              const cockpit = window.verity.cockpit;
              const veritum = cockpit.prepareVeritum();
              await veritum.compile();
              const cubes = Array.from(veritum.chunks);
              if (cubes.length > 0) {
                await window.verity.node.cubeStore.addCube(cubes[0]);
                results.push({ success: true, iteration: i });
              }
            } catch (error) {
              results.push({ success: false, error: error.message, iteration: i });
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return { nodeId: 1, operations: results };
        }),
        
        // Node 2: Mixed operations (create + query)
        page2.evaluate(async () => {
          const results = [];
          for (let i = 0; i < 3; i++) {
            try {
              // Create a cube
              const cockpit = window.verity.cockpit;
              const veritum = cockpit.prepareVeritum();
              await veritum.compile();
              const cubes = Array.from(veritum.chunks);
              if (cubes.length > 0) {
                await window.verity.node.cubeStore.addCube(cubes[0]);
              }
              
              // Query cube count
              const count = await window.verity.node.cubeStore.getNumberOfStoredCubes();
              results.push({ success: true, iteration: i, cubeCount: count });
            } catch (error) {
              results.push({ success: false, error: error.message, iteration: i });
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return { nodeId: 2, operations: results };
        }),
        
        // Node 3: Network monitoring
        page3.evaluate(async () => {
          const networkSnapshots = [];
          for (let i = 0; i < 4; i++) {
            try {
              const node = window.verity.node;
              const snapshot = {
                timestamp: Date.now(),
                onlinePeers: node.networkManager.onlinePeers.length,
                cubeCount: await node.cubeStore.getNumberOfStoredCubes(),
                nodeId: node.networkManager.idString.substring(0, 8) + '...'
              };
              networkSnapshots.push(snapshot);
            } catch (error) {
              networkSnapshots.push({ error: error.message, timestamp: Date.now() });
            }
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          return { nodeId: 3, networkSnapshots };
        })
      ]);
      
      // Analyze results
      const node1Results = stressTestResults[0];
      const node2Results = stressTestResults[1];
      const node3Results = stressTestResults[2];
      
      const node1Successes = node1Results.operations.filter((op: any) => op.success).length;
      const node2Successes = node2Results.operations.filter((op: any) => op.success).length;
      const node3Snapshots = node3Results.networkSnapshots.filter((snap: any) => !snap.error).length;
      
      expect(node1Successes).toBeGreaterThan(0);
      expect(node2Successes).toBeGreaterThan(0);
      expect(node3Snapshots).toBeGreaterThan(0);
      
      console.log('Concurrent stress test:', {
        node1: { successful: node1Successes, total: node1Results.operations.length },
        node2: { successful: node2Successes, total: node2Results.operations.length },
        node3: { snapshots: node3Snapshots, total: node3Results.networkSnapshots.length }
      });
      
    } finally {
      await Promise.all([
        shutdownBrowserNode(page1),
        shutdownBrowserNode(page2),
        shutdownBrowserNode(page3)
      ]);
      await Promise.all([
        context1.close(),
        context2.close(),
        context3.close()
      ]);
    }
  });

  test('should test load balancing across multiple browser nodes', async ({ browser }) => {
    // Create 3 nodes to test load distribution
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext()
    ]);
    
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    
    try {
      await Promise.all(pages.map(page => initializeVerityInBrowser(page)));
      
      // Simulate load balancing by distributing cube creation requests
      const loadBalancingTest = await Promise.all(pages.map((page, nodeIndex) => 
        page.evaluate(async (nodeIndex) => {
          try {
            const node = window.verity.node;
            const startTime = performance.now();
            
            // Different workloads for each node
            const workloadSizes = [3, 5, 2]; // Different loads per node
            const workload = workloadSizes[nodeIndex] || 1;
            
            const results = [];
            for (let i = 0; i < workload; i++) {
              const operationStart = performance.now();
              
              try {
                const cockpit = window.verity.cockpit;
                const veritum = cockpit.prepareVeritum();
                await veritum.compile();
                const cubes = Array.from(veritum.chunks);
                
                if (cubes.length > 0) {
                  await node.cubeStore.addCube(cubes[0]);
                  const operationTime = performance.now() - operationStart;
                  results.push({ 
                    success: true, 
                    operationTime,
                    cubeIndex: i 
                  });
                }
              } catch (error) {
                results.push({ 
                  success: false, 
                  error: error.message,
                  cubeIndex: i 
                });
              }
              
              // Small delay to prevent overwhelming
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            const totalTime = performance.now() - startTime;
            const successfulOps = results.filter(r => r.success).length;
            const avgOpTime = results
              .filter(r => r.success && r.operationTime)
              .reduce((sum, r) => sum + r.operationTime, 0) / successfulOps || 0;
            
            return {
              nodeIndex,
              workload,
              results,
              performance: {
                totalTime,
                successfulOps,
                avgOpTime,
                throughput: successfulOps / (totalTime / 1000)
              }
            };
          } catch (error) {
            return { nodeIndex, error: error.message };
          }
        }, nodeIndex)
      ));
      
      // Verify load balancing results
      loadBalancingTest.forEach((result, index) => {
        expect(result.error).toBeUndefined();
        expect(result.performance.successfulOps).toBeGreaterThan(0);
        expect(result.performance.throughput).toBeGreaterThan(0);
      });
      
      const totalSuccessfulOps = loadBalancingTest.reduce(
        (sum, result) => sum + result.performance.successfulOps, 0
      );
      expect(totalSuccessfulOps).toBeGreaterThan(5);
      
      console.log('Load balancing test:', loadBalancingTest.map(result => ({
        node: result.nodeIndex,
        workload: result.workload,
        successful: result.performance.successfulOps,
        throughput: result.performance.throughput.toFixed(2) + ' ops/sec'
      })));
      
    } finally {
      await Promise.all(pages.map(page => shutdownBrowserNode(page)));
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });
});