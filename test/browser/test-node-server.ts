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

// Global server instance for sharing between tests
let globalTestServer: TestNodeServer | null = null;

export async function getTestServer(port: number = 19000): Promise<TestNodeServer> {
  if (!globalTestServer) {
    globalTestServer = new TestNodeServer(port);
    await globalTestServer.start();
  }
  return globalTestServer;
}

export async function shutdownTestServer(): Promise<void> {
  if (globalTestServer) {
    await globalTestServer.shutdown();
    globalTestServer = null;
  }
}

// Handle process cleanup
process.on('exit', () => {
  if (globalTestServer) {
    globalTestServer.shutdown().catch(console.error);
  }
});

process.on('SIGINT', () => {
  if (globalTestServer) {
    globalTestServer.shutdown().then(() => process.exit(0)).catch(console.error);
  }
});