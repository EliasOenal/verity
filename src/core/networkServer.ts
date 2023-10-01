import { VerityError } from "./config";
import { NetworkPeer } from "./networkPeer";
import { WebSocketAddress } from "./peerDB";
import { NetworkManager } from "./networkManager";

import { logger } from "./logger";

import WebSocket from 'isomorphic-ws';
import { EventEmitter } from 'events';

export enum SupportedServerTypes {
  ws,
}

export abstract class NetworkServer extends EventEmitter {
  constructor(
      protected networkManager: NetworkManager,
  ){
    super();
  }

  start(): void {
    throw new VerityError("NetworkServer.start() to be implemented by subclass");
  }

  shutdown(): void {
    throw new VerityError("NetworkServer.shutdown() to be implemented by subclass");
  }
}

export class WebSocketServer extends NetworkServer {
  private server: WebSocket.Server = undefined;
  constructor(
      networkManager: NetworkManager,
      private port: number)
  {
    super(networkManager);
  }

  start(): void {
      this.server = new WebSocket.Server({ port: this.port });
      logger.trace('NetworkManager: Server has been started on port ' + this.port);

      // Handle incoming connections
      this.server.on('connection', ws => this.handleIncomingPeer(ws));

      this.server.on('listening', () => {
          this.emit('listening');
          logger.debug(`WebSocketServer: Server is listening on port ${this.port}.`);
      }
      );
  }

  shutdown(): void {
    this.server.close((err) => {
      if (err) {
          logger.error(`WebSockerServer: Error while closing server: ${err}`);
      }
    });
  }

    /**
     * Event handler for incoming peer connections.
     * As such, it should never be called manually.
     */
  private handleIncomingPeer(ws: WebSocket) {
    logger.debug(`NetworkManager: Incoming connection from ${(ws as any)._socket.remoteAddress}:${(ws as any)._socket.remotePort}`);
    const networkPeer = new NetworkPeer(
      this.networkManager,
      new WebSocketAddress(
          WebSocketAddress.convertIPv6toIPv4((ws as any)._socket.remoteAddress),
          (ws as any)._socket.remotePort),
      this.networkManager.cubeStore,
      this.networkManager.peerID,
      this.networkManager.lightNode,
      ws);
    this.networkManager.handleIncomingPeer(networkPeer);
  }

}