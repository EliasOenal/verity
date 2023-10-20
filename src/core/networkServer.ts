import { VerityError } from "./settings";
import { NetworkPeer } from "./networkPeer";
import { AddressAbstraction, WebSocketAddress } from "./peerDB";
import { NetworkManager } from "./networkManager";
import { WebSocketPeerConnection, Libp2pPeerConnection } from "./networkPeerConnection";

import { logger } from "./logger";

import WebSocket from 'isomorphic-ws';
import { EventEmitter } from 'events';

import { isBrowser, isNode, isWebWorker, isJsDom, isDeno } from "browser-or-node";
import * as ws from 'ws';
import { readFileSync } from 'fs';
import { createServer } from 'https';
import { createLibp2p } from 'libp2p';
import { Libp2p } from 'libp2p';
import { Libp2pNode } from 'libp2p/libp2p'
import { webSockets } from '@libp2p/websockets'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { plaintext } from 'libp2p/insecure'
import { noise } from '@chainsafe/libp2p-noise'
import { circuitRelayTransport, circuitRelayServer } from 'libp2p/circuit-relay'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identifyService } from 'libp2p/identify'
import { IncomingStreamData } from '@libp2p/interface/stream-handler'
import * as filters from '@libp2p/websockets/filters'

export abstract class NetworkServer extends EventEmitter {
  dialableAddress: AddressAbstraction = undefined;

  constructor(
      protected networkManager: NetworkManager,
  ){
    super();
  }

  start(): Promise<void> {
    throw new VerityError("NetworkServer.start() to be implemented by subclass");
  }

  shutdown(): Promise<void> {
    throw new VerityError("NetworkServer.shutdown() to be implemented by subclass");
  }

  toString(): string {
    throw new VerityError("NetworkServer.toString() to be implemented by subclass");
  }

  toLongString(): string {
    throw new VerityError("NetworkServer.toLongString() to be implemented by subclass");
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

  toString(): string {
    let ret: string;
    if (this.dialableAddress) ret = `WebSocketServer ${this.dialableAddress}`
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
        logger.debug(`WebSocketServer: Server is listening on ${this.dialableAddress.toString()}.`);
        resolve();
      }));

      // Note: Setting this as our dialable address is actually wrong, as it
      // does not include our IP address (it's just ":::port").
      // We don't know our external IP address, but everybody we exchange peers
      // with obviously does.
      // Therefore, addresses starting in ":::" are just handled as a special
      // case at the receiving node.
      // @ts-ignore This will only ever be called on NodeJS and it's correct for the NodeJS ws library
      this.dialableAddress = new AddressAbstraction(new WebSocketAddress(this.server.address().address, this.port));
      logger.trace('WebSocketServer: stated on ' + this.dialableAddress.toString());

      // Handle incoming connections
      this.server.on('connection', (ws, request) => this.handleIncomingPeer(ws));

      return listeningPromise;
  }

  shutdown(): Promise<void> {
    logger.trace("WebSocketServer: shutdown()");
    this.server.removeAllListeners();
    const closedPromise: Promise<void> =
      new Promise<void>(resolve => this.server.once('close', resolve));
    this.server.close((err) => {
      if (err) {
          logger.error(`WebSocketServer: Error while closing server: ${err}`);
      }
    });
    return closedPromise;
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
      new WebSocketPeerConnection(ws),
      this.networkManager.lightNode,
      this.networkManager.peerExchange,
      );
    this.networkManager.handleIncomingPeer(networkPeer);
  }
}




export class Libp2pServer extends NetworkServer {
  private _node: Libp2pNode;  // libp2p types are much to complicated for my humble brain
  get node() { return this._node }
  private listen: string[] = [];

  constructor(
      networkManager: NetworkManager,
      private listen_param: string[] | number[] | string | number = 1985)
  {
    super(networkManager);

    // construct listen string array
    if (!Array.isArray(listen_param)) listen_param = [listen_param as any];
    for (const listenSpec of listen_param) {
      if (!isNaN(listenSpec as number)) {  // if listen_param is a port number
        this.listen = this.listen.concat([
          `/ip4/0.0.0.0/tcp/${listen_param}/wss`,  // for relay... or WebSocket via libp2p
          // `/ip6/::1/tcp/${listen_param}/ws`,  // configuring IPv6 always throws "Listener not ready"... so no IPv6 I guess
          `/ip4/0.0.0.0/udp/${listen_param}/webrtc`,
          // `/ip6/::1/udp/${listen_param}/webrtc`,
        ]);
      } else {
        this.listen.push(listenSpec as string);
      }
    }
    if (!this.listen.includes("/webrtc")) this.listen.push("/webrtc");
  }

  async start(): Promise<void> {
    logger.trace("Libp2pServer: Starting up requesting these listeners: " + this.listen);
    let httpsServer, libp2pWebSocketTransport;
    if (isNode) {
      httpsServer = createServer({
        cert: readFileSync('./cert.pem'),
        key: readFileSync('./key.pem'),
      });
      libp2pWebSocketTransport = webSockets({
        filter: filters.all,
        server: httpsServer,
      });
    } else {
      libp2pWebSocketTransport = webSockets({
        filter: filters.all,
      });
    }
    this._node = await createLibp2p({
      addresses: {
        listen: this.listen,
      },
      transports: [
        libp2pWebSocketTransport,
        webRTC({
          rtcConfiguration: {
            iceServers:[{
              urls: [
                'stun:stun.l.google.com:19302',
                'stun:global.stun.twilio.com:3478'
              ]
            }]
          }
        }),
        webRTCDirect(),
        circuitRelayTransport({ discoverRelays: 5 }),
      ],
      // connectionEncryption: [plaintext()],
      connectionEncryption: [noise()],
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
    }) as unknown as Libp2pNode;  // it's actually the class the lib creates, believe me
    await this._node.handle(
      "/verity/1.0.0",
      (incomingStreamData: IncomingStreamData) => this.handleIncomingPeer(incomingStreamData));
    logger.info("Libp2pServer: Listening to Libp2p multiaddrs: " + this._node.getMultiaddrs().toString());
    // logger.info("Transports are: " + this.server.components.transportManager.getTransports());
  }

  shutdown(): Promise<void> {
    // TODO: Something's still fishy here...
    this.node.unhandle("/verity/1.0.0");
    return this.node.stop() as Promise<void>;
  }

  toString(): string {
    let ret: string = "";
    if (this._node) {
      if (this._node.getMultiaddrs().length) {
        ret = "Libp2pServer ";
        for (let i=0; i<this._node.getMultiaddrs().length; i++) {
          ret += this.node.getMultiaddrs()[i]
          if (i<this._node.getMultiaddrs().length-1) ret += ', ';
        }
      } else {
        ret += "Libp2pServer NOT having any multiaddrs";
      }
    } else {
      ret += "Lib2pServer (not running)";
    }
    return ret;
  }
  toLongString(): string {
    let ret: string = "";
    if (this._node) {
      if (this._node.getMultiaddrs().length) {
        ret += "Libp2pServer having multiaddrs:\n"
        for (const multiaddr of this._node.getMultiaddrs()) {
          ret += " - " + multiaddr.toString() + '\n';
        }
      } else {
        ret += "Libp2pServer NOT having any multiaddrs";
      }

    }
    else {
      ret += "Lib2pServer (not running)";
    }
    return ret;
  }

  private handleIncomingPeer(incomingStreamData: IncomingStreamData): void {
    logger.debug(`Libp2pServer: Incoming connection from ${incomingStreamData.connection.remoteAddr.toString()}`);
    const conn = new Libp2pPeerConnection(this, incomingStreamData);
    const networkPeer = new NetworkPeer(
      this.networkManager,
      incomingStreamData.connection.remoteAddr,
      this.networkManager.cubeStore,
      this.networkManager.peerID,
      conn,
      this.networkManager.lightNode,
      this.networkManager.peerExchange
      );
    this.networkManager.handleIncomingPeer(networkPeer);
  }

  /**
   * Event handler getting called when our publicly reachable address might have
   * changed, ensuring our peers get updated on our reachable ("dialable") address.
   */
  addressChange(): void {
    if (this.dialableAddress) {
      return;
      // It appears we already have a dialable address. Currently, a Peer (and
      // in the eyes of our peers, we are obviously a peer) can only have one
      // primary address, so we're done here.
      // TODO generalize, we *should* actually register relay addresses with
      // multiple relays and publish all of them
      // TODO: Unset this.dialableAddress when the relay node connection closes
      // TODO: This should take observed addresses (i.e. reported by peers)
      // into account for NAT traversal (this.node.components.addressManager.addObservedAddr())
      // TODO FIXME: This makes us prefer relayed connections even when a direct
      // route might be available.
    }
    for (const multiaddr of this.node.getMultiaddrs()) {
      const protos: string[] = multiaddr.protoNames();
       if (protos.includes("p2p") && protos.includes("p2p-circuit") &&
           protos.includes("webrtc")) {
        this.dialableAddress = new AddressAbstraction(multiaddr);
        for (const peer of this.networkManager.outgoingPeers.concat(this.networkManager.incomingPeers)) {
          peer.sendMyServerAddress();
        }
      }
    }
  }

}