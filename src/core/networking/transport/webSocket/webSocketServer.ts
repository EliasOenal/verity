import type { NetworkManagerOptions } from '../../networkManagerIf';

import { WebSocketConnection } from "./webSocketConnection";

import { NetworkTransport } from "../networkTransport";
import { TransportServer } from "../transportServer";

import { AddressAbstraction, WebSocketAddress } from "../../../peering/addressing";
import { logger } from "../../../logger";

import WebSocket, { AddressInfo } from 'isomorphic-ws';

export class WebSocketServer extends TransportServer {
  private server: WebSocket.Server = undefined;
  constructor(
      transport: NetworkTransport,
      private port: number = 1984,
      private options: NetworkManagerOptions = {})
  {
    super(transport);
  }

  toString(): string {
    let ret: string;
    if (this.transport.dialableAddress) ret = `WebSocketServer ${this.transport.dialableAddress}`
    else ret = `WebSocketServer ${this.port}`;
    if (!this.server) {
      ret += " (not running)";
    }
    return ret;
  }
  toLongString(): string {
    return this.toString();
  }

  start(): Promise<void> {
      this.server = new WebSocket.Server({ port: this.port });
      const listeningPromise: Promise<void> =
        new Promise<void>(resolve => this.server.on('listening', () => {
        logger.debug(`WebSocketServer: Server is listening on ${((this.server.address() as AddressInfo).address +":"+(this.server.address() as AddressInfo).port)}.`);
        resolve();
      }));

      // Note: Setting this as our dialable address is actually wrong, as it
      // does not include our IP address (it's just ":::port").
      // We don't know our external IP address, but everybody we exchange peers
      // with obviously does.
      // Therefore, addresses starting in ":::" are just handled as a special
      // case at the receiving node.
      if (this.options.publicAddress !== undefined) {
        this.transport.dialableAddress = new AddressAbstraction(
          new WebSocketAddress(this.options.publicAddress, this.port));
      } else {
        this.transport.dialableAddress = new AddressAbstraction(
          new WebSocketAddress(
            (this.server.address() as AddressInfo).address, this.port));
      }
      logger.trace('WebSocketServer: stated on ' + this.transport.dialableAddress.toString());

      // Handle incoming connections
      this.server.on('connection', (ws, request) => this.handleIncomingPeer(ws));

      return listeningPromise;
  }

  shutdown(): Promise<void> {
    logger.trace("WebSocketServer: shutdown()");
    if (this.server !== undefined) {
      this.server.removeAllListeners();
      const closedPromise: Promise<void> =
        new Promise<void>(resolve => this.server.once('close', resolve));
      this.server.close((err) => {
        if (err) {
            logger.error(`WebSocketServer: Error while closing server: ${err}`);
        }
      });
      return closedPromise;
    } else {
      return new Promise<void>(resolve => resolve());  // Return a resolved promise
    }
  }

    /**
     * Event handler for incoming peer connections.
     * As such, it should never be called manually.
     */
  private handleIncomingPeer(ws: WebSocket) {
    try {
      logger.trace(`NetworkManager: Incoming connection from ${(ws as any)._socket.remoteAddress}:${(ws as any)._socket.remotePort}`);
      const conn = new WebSocketConnection(ws);
      this.emit("incomingConnection", conn);
    } catch(error) {
      logger.warn(`WebSocketServer.handleIncomingPeer(): Error while handling incoming connection: ${error}`);
    }
  }
}
