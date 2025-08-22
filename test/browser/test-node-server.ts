/**
 * Test Node.js Full Node Server for Browser Testing
 * 
 * This creates a real Verity full node that browser nodes can connect to,
 * similar to the networking tests in test/core/networking/
 */

import { CoreNode } from '../../src/core/coreNode';
import { testCoreOptions } from '../core/testcore.definition';
import { SupportedTransports } from '../../src/core/networking/networkDefinitions';
import { WebSocketAddress } from '../../src/core/peering/addressing';
import { Peer } from '../../src/core/peering/peer';
import { Cube } from '../../src/core/cube/cube';
import { CubeField } from '../../src/core/cube/cubeField';
import { CubeType } from '../../src/core/cube/cube.definitions';
import { logger } from '../../src/core/logger';

export class TestNodeServer {
  private coreNode: CoreNode | null = null;
  private port: number;
  private isRunning = false;

  constructor(port: number = 19000) {
    this.port = port;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    logger.info('Starting test Node.js full node server...');

    // Create a real CoreNode with test optimizations
    this.coreNode = new CoreNode({
      ...testCoreOptions,
      lightNode: false,  // Full node to serve browser light nodes
      announceToTorrentTrackers: false,
      autoConnect: false,  // Don't auto-connect to external peers
      peerExchange: false,
      transports: new Map([[SupportedTransports.ws, this.port]]),
      initialPeers: [],
    });

    await this.coreNode.readyPromise;
    this.isRunning = true;

    logger.info(`Test node server started on WebSocket port ${this.port}`);
    logger.info(`Node ID: ${this.coreNode.networkManager.idString}`);
  }

  async shutdown(): Promise<void> {
    if (!this.isRunning || !this.coreNode) {
      return;
    }

    logger.info('Shutting down test node server...');
    await this.coreNode.shutdown();
    this.isRunning = false;
    this.coreNode = null;
  }

  getAddress(): WebSocketAddress {
    return new WebSocketAddress('localhost', this.port);
  }

  getPeer(): Peer {
    return new Peer(this.getAddress());
  }

  getNodeId(): string {
    return this.coreNode?.networkManager.idString || '';
  }

  async getCubeCount(): Promise<number> {
    if (!this.coreNode) {
      return 0;
    }
    return await this.coreNode.cubeStore.getNumberOfStoredCubes();
  }

  getPeerCount(): number {
    return this.coreNode?.networkManager.onlinePeers.length || 0;
  }

  async addTestCube(content: string): Promise<{ success: boolean; key?: string; error?: string }> {
    if (!this.coreNode) {
      return { success: false, error: 'Node not started' };
    }

    try {
      const cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN, content),
        requiredDifficulty: 0,
      });

      await this.coreNode.cubeStore.addCube(cube);
      const key = await cube.getKey();

      return {
        success: true,
        key: key.toString('hex').substring(0, 32) + '...'
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async getServerInfo() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      nodeId: this.getNodeId().substring(0, 16) + '...',
      cubeCount: await this.getCubeCount(),
      peerCount: this.getPeerCount(),
      address: `ws://localhost:${this.port}`
    };
  }
}

// Port-based server management for parallel test execution
const testServers = new Map<number, TestNodeServer>();

/**
 * Get a test server with dynamic port allocation for parallel execution
 * @param workerIndex Worker index from Playwright (0, 1, 2, etc.)
 * @param basePort Base port to start from (default: 19000)
 * @returns TestNodeServer instance
 */
export async function getTestServer(workerIndex: number = 0, basePort: number = 19000): Promise<TestNodeServer> {
  // Allocate port based on worker index to avoid conflicts
  const port = basePort + workerIndex;
  
  if (!testServers.has(port)) {
    const server = new TestNodeServer(port);
    await server.start();
    testServers.set(port, server);
  }
  return testServers.get(port)!;
}

/**
 * Legacy function for backward compatibility with hardcoded ports
 * @deprecated Use getTestServer(workerIndex) instead
 */
export async function getTestServerLegacy(port: number = 19000): Promise<TestNodeServer> {
  if (!testServers.has(port)) {
    const server = new TestNodeServer(port);
    await server.start();
    testServers.set(port, server);
  }
  return testServers.get(port)!;
}

export async function shutdownTestServer(port?: number): Promise<void> {
  if (port !== undefined) {
    // Shutdown specific server
    const server = testServers.get(port);
    if (server) {
      await server.shutdown();
      testServers.delete(port);
    }
  } else {
    // Shutdown all servers
    for (const [serverPort, server] of testServers.entries()) {
      await server.shutdown();
      testServers.delete(serverPort);
    }
  }
}

// Handle process cleanup
process.on('exit', () => {
  for (const server of testServers.values()) {
    server.shutdown().catch(console.error);
  }
});

process.on('SIGINT', () => {
  Promise.all(
    Array.from(testServers.values()).map(server => server.shutdown())
  ).then(() => process.exit(0)).catch(console.error);
});