import { VerityError } from "./config";
import { NetworkPeer } from "./networkPeer";
import { WebSocketAddress } from "./peerDB";
import { NetworkManager } from "./networkManager";

import { logger } from "./logger";

import WebSocket from 'isomorphic-ws';
import { EventEmitter } from 'events';

import { createLibp2p } from 'libp2p';
import { Libp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { noise } from '@chainsafe/libp2p-noise'
import { circuitRelayTransport, circuitRelayServer } from 'libp2p/circuit-relay'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identifyService } from 'libp2p/identify'
import { IncomingStreamData } from '@libp2p/interface/stream-handler'
import { Libp2pPeerConnection } from "./networkPeerConnection";
import * as filters from '@libp2p/websockets/filters'
import { Multiaddr } from '@multiformats/multiaddr'

export enum SupportedTransports {
  ws,
  libp2p,
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
  private _node: Libp2p;  // libp2p types are much to complicated for my humble brain
  get node() { return this._node }
  private listen: string[];
  private dialableAddress: Multiaddr = undefined;

  constructor(
      networkManager: NetworkManager,
      private listen_param: string | string[] | number = 1985)
  {
    super(networkManager);

    // get or construct listen string array
    if (!isNaN(listen_param as number)) {  // if listen_param is a port number
      this.listen = [
        `/ip4/0.0.0.0/tcp/${listen_param}/ws`,  // for relay... or WebSocket via libp2p
        // `/ip6/::1/tcp/${listen_param}/ws`,  // configuring IPv6 always throws "Listener not ready"... so no IPv6 I guess
        `/ip4/0.0.0.0/udp/${listen_param}/webrtc`,
        // `/ip6/::1/udp/${listen_param}/webrtc`,
        `/webrtc`
      ];
    } else if (!(listen_param instanceof Array)) {
      this.listen = [listen_param as string];
    }
    else {
      this.listen = listen_param;  // correct format already, hopefully
    }
  }

  async start() {
    // logger.error(this.listen)
    this._node = await createLibp2p({
      addresses: {
        listen: this.listen,
      },
      transports: [
        webSockets({ filter: filters.all }),
        webRTC(),
        circuitRelayTransport({ discoverRelays: 5 }),
      ],
      connectionEncryption: [noise(),],
      streamMuxers: [yamux()],
      services: {
        identify: identifyService(),  // what does that do? do we even need that?
        relay: circuitRelayServer(),
      },
      connectionGater: {
        denyDialMultiaddr: async() => false,
      },
      connectionManager: {
        minConnections: 0,  // we manage creating new peer connections ourselves
      }
    });
    await this._node.handle(
      "/verity/1.0.0",
      (incomingStreamData: IncomingStreamData) => this.handleIncomingPeer(incomingStreamData));
    logger.info("Libp2pServer: Listening to Libp2p multiaddrs: " + this._node.getMultiaddrs().toString());
    // logger.info("Transports are: " + this.server.components.transportManager.getTransports());
  }

  private handleIncomingPeer(incomingStreamData: IncomingStreamData): void {
    logger.debug(`Libp2pServer: Incoming connection from ${incomingStreamData.connection.remoteAddr.toString()}`);
    const conn = new Libp2pPeerConnection(this, incomingStreamData);
    const networkPeer = new NetworkPeer(
      this.networkManager,
      incomingStreamData.connection.remoteAddr,
      this.networkManager.cubeStore,
      this.networkManager.peerID,
      this.networkManager.lightNode,
      conn);
    this.networkManager.handleIncomingPeer(networkPeer);
  }

  addressChange(): void {
    if (this.dialableAddress) {
      return;
      // It appears we already have a dialable address. Currently, a Peer (and
      // in the eyes of our peers, we are obviously a peer) can only have one
      // primary address, so we're done here.
      // TODO generalize, we *should* actually register relay addresses with
      // multiple relays and publish all of them
    }
    for (const multiaddr of this.node.getMultiaddrs()) {
      const protos: string[] = multiaddr.protoNames();
       if (protos.includes("p2p") && protos.includes("p2p-circuit") &&
           protos.includes("webrtc")) {
        this.dialableAddress = multiaddr;
        for (const peer of this.networkManager.outgoingPeers.concat(this.networkManager.incomingPeers)) {
          peer.sendMyServerAddress(SupportedTransports.libp2p, multiaddr.toString());
        }
      }
    }
}

}