import { VerityError } from "./config";
import { NetworkPeer } from "./networkPeer";
import { WebSocketAddress } from "./peerDB";
import { NetworkManager } from "./networkManager";

import { logger } from "./logger";

import WebSocket from 'isomorphic-ws';
import { EventEmitter } from 'events';

import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { noise } from '@chainsafe/libp2p-noise'
import { circuitRelayTransport, circuitRelayServer } from 'libp2p/circuit-relay'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identifyService } from 'libp2p/identify'
import { IncomingStreamData } from '@libp2p/interface/stream-handler'

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
      private port: number = 1984)
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

export class Libp2pServer extends NetworkServer {
  private server: any;  // libp2p types are much to complicated for my humble brain

  constructor(
      networkManager: NetworkManager,
      private port: number = 1985)
  {
    super(networkManager);
  }

  async start() {
    this.server = await createLibp2p({
      addresses: {
        listen: [
          `/ip4/0.0.0.0/tcp/${this.port}/ws`,  // for relay... or WebSocket via libp2p
          `/ip6/::1/tcp/${this.port}/ws`,  // for relay again, IPv6 this time
          `/ip4/0.0.0.0/udp/${this.port}/webrtc`,
          `/ip6/::1/udp/${this.port}/webrtc`,
        ],
      },
      transports: [
        webSockets(),
        webRTC(),
        circuitRelayTransport(),
      ],
      connectionEncryption: [noise(),],
      streamMuxers: [yamux()],
      services: {
        identify: identifyService(),  // what does that do? do we even need that?
        relay: circuitRelayServer(),
      },
      connectionGater: {
        denyDialMultiaddr: async () => false,
      },
      connectionManager: {
        minConnections: 0,  // we manage creating new peer connections ourselves
      }
    });
    await this.server.start();
    this.server.handle("/verity/1.0.0", this.handleIncomingPeer);
  }

  private handleIncomingPeer(incomingStreamData: IncomingStreamData): void {
    logger.debug(`NetworkManager: Incoming connection from ${incomingStreamData.connection.remoteAddr.toString()}`);
    const networkPeer = new NetworkPeer(
      this.networkManager,
      new WebSocketAddress(incomingStreamData.connection.remoteAddr.nodeAddress().address, incomingStreamData.connection.remoteAddr.nodeAddress().port),  // TODO this is crazy, just use Multiaddr
      this.networkManager.cubeStore,
      this.networkManager.peerID,
      this.networkManager.lightNode,
      incomingStreamData);
    this.networkManager.handleIncomingPeer(networkPeer);
  }

}