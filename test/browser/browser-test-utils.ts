/**
 * Browser testing utilities for Verity
 * 
 * This module provides utilities to test Verity functionality in a browser environment
 * using the existing webpack build and development server.
 */

import { CoreNode } from '../../src/core/coreNode';
import { CubeStore } from '../../src/core/cube/cubeStore';
import { PeerDB } from '../../src/core/peering/peerDB';
import { SupportedTransports } from '../../src/core/networking/networkDefinitions';

export interface BrowserTestOptions {
  /** Port for the browser node WebSocket server (if running as full node) */
  port?: number;
  /** Whether to run as a light node (browser typically runs as light node) */
  lightNode?: boolean;
  /** Transport configurations for browser environment */
  transports?: Map<SupportedTransports, any>;
  /** Initial peers to connect to */
  initialPeers?: string[];
}

/**
 * Creates a CoreNode configured for browser environment
 */
export function createBrowserNode(options: BrowserTestOptions = {}): CoreNode {
  const defaultOptions = {
    lightNode: true,
    inMemory: true,
    // In browser, we typically use WebRTC for P2P connections
    transports: new Map([
      [SupportedTransports.libp2p, ['/webrtc']]
    ]),
    announceToTorrentTrackers: false,
    autoConnect: true,
    peerExchange: true,
    useRelaying: true,
    // Important: set difficulty to 0 for tests
    requiredDifficulty: 0,
    ...options
  };

  return new CoreNode(defaultOptions);
}

/**
 * Creates a mock Node.js server for browser tests to connect to
 * This simulates the "one Node.js full node" requirement
 */
export function createServerNode(port: number = 18984): CoreNode {
  return new CoreNode({
    lightNode: false,
    inMemory: true,
    transports: new Map([
      [SupportedTransports.ws, port],
      [SupportedTransports.libp2p, port + 1]
    ]),
    announceToTorrentTrackers: false,
    autoConnect: true,
    peerExchange: true,
    useRelaying: false,
  });
}

/**
 * Wait for nodes to be online and connected
 */
export async function waitForNodesConnected(nodes: CoreNode[], timeoutMs: number = 10000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const allConnected = nodes.every(node => 
      node.networkManager.onlinePeers.length > 0
    );
    
    if (allConnected) {
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  throw new Error(`Nodes failed to connect within ${timeoutMs}ms`);
}

/**
 * Test storage functionality in browser environment
 */
export async function testBrowserStorage(node: CoreNode): Promise<boolean> {
  try {
    const cubesBeforeAdd = await node.cubeStore.getNumberOfStoredCubes();
    
    // Import Cube and related classes
    const { Cube } = await import('../../src/core/cube/cube');
    const { CubeField } = await import('../../src/core/cube/cubeField');
    const { CubeType } = await import('../../src/core/cube/cube.definitions');
    
    // Create a test cube
    const testCube = Cube.Frozen({
      fields: [
        CubeField.RawContent(CubeType.FROZEN, "Browser storage test"),
      ],
      requiredDifficulty: 0,
    });
    
    // Add cube to storage
    await node.cubeStore.addCube(testCube);
    
    // Verify it was stored
    const cubesAfterAdd = await node.cubeStore.getNumberOfStoredCubes();
    const wasStored = cubesAfterAdd > cubesBeforeAdd;
    
    // Try to retrieve it
    const key = await testCube.getKey();
    const retrievedCube = await node.cubeStore.getCube(key);
    const wasRetrieved = retrievedCube !== null;
    
    return wasStored && wasRetrieved;
  } catch (error) {
    console.error('Browser storage test failed:', error);
    return false;
  }
}