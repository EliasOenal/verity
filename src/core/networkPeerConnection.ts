import { isNode } from "browser-or-node";
import { VerityError } from "./config";
import { logger } from "./logger";
import { NetworkPeer } from "./networkPeer";
import { WebSocketAddress } from "./peerDB";

import EventEmitter from "events";
import WebSocket from 'isomorphic-ws';
import { Buffer } from 'buffer';

import { IncomingStreamData } from '@libp2p/interface/stream-handler'
import { Connection, Stream } from '@libp2p/interface/connection'
import { Multiaddr } from '@multiformats/multiaddr'
import { pipe } from 'it-pipe'

export class NetworkError extends VerityError  {}
export class AddressError extends NetworkError {}


/**
 * Represents the actual networking component of a NetworkPeer,
 * i.e. the part that actually opens and closes network connections;
 * sends and received messages.
 * @emits "ready" when connection is... you know... ready
 */
export abstract class NetworkPeerConnection extends EventEmitter {
  static Create(peer: NetworkPeer, address: WebSocketAddress) {
      if (address instanceof WebSocketAddress) {
          return new WebSocketPeerConnection(peer, address)
      } else {
          throw new AddressError("NetworkPeerConnection: Unsupported address type");
      }
  }

  close(): void {
      throw new VerityError("NetworkPeerConnection.close() to be implemented by subclass")
  }
  ready(): boolean {
      throw new VerityError("NetworkPeerConnection.ready() to be implemented by subclass")
  }
  send(message: Buffer): void {
      throw new VerityError("NetworkPeerConnection.send() to be implemented by subclass")
  }

}

export class WebSocketPeerConnection extends NetworkPeerConnection {
  private static WEBSOCKET_HANDSHAKE_TIMEOUT = 2500;
  private ws: WebSocket;  // The WebSocket connection associated with this peer

  // these two represent a very cumbersome but cross-platform way to remove
  // listeners from web sockets (which we need to do once a peer connection closes)
  private socketClosedController: AbortController = new AbortController();
  private socketClosedSignal: AbortSignal = this.socketClosedController.signal;

  constructor(
          private peer: NetworkPeer,
          private conn_param: WebSocketAddress | WebSocket) {
      super();

      if (conn_param instanceof WebSocket) {
          this.ws = conn_param;
      } else {
          // Create a WebSocket connection
          let WsOptions: any;
          // set a handshake timeout on NodeJS, not possible in the browser
          if (isNode) {
              WsOptions = { handshakeTimeout: WebSocketPeerConnection.WEBSOCKET_HANDSHAKE_TIMEOUT };
          } else {
              WsOptions = [];
          }
          this.ws = new WebSocket(peer.url, WsOptions);
      }

      // On WebSocket errors just shut down this peer
      // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
      this.ws.addEventListener("error", (error) => {
          // TODO: We should probably "greylist" peers that closed with an error,
          // i.e. not try to reconnect them for some time.
          logger.warn(`WebSockerPeerConnection: WebSocket error: ${error.message}`);
          this.peer.close();
      }, { signal: this.socketClosedSignal });

      // Handle incoming messages
      // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
      this.ws.addEventListener("message", (event) => {
          if (isNode) {
              this.peer.handleMessage(Buffer.from(event.data as Buffer));
          } else {
              const blob: Blob = event.data as unknown as Blob;
              blob.arrayBuffer().then((value) => {
                  this.peer.handleMessage(Buffer.from(value));
              });
          }
      }, { signal: this.socketClosedSignal });

      this.ws.addEventListener('close', () => {
          // TODO: We should at some point drop nodes closing on us from our PeerDB,
          // at least if they did that repeatedly and never even sent a valid HELLO.
          logger.trace(`WebSocketPeerConnection: Peer ${this.peer.toString()} closed on us`);
          this.peer.close();
      });

      this.ws.addEventListener("open", () =>  {
          this.emit("ready");
      // @ts-ignore I don't know why the compiler complains about this
      }, { signal: this.socketClosedSignal });
  }

  /**
   * Closes the connection.
   * This will be called by NetworkPeer.close() and should thus never be
   * called directly.
   */
  close(): void {
      this.ws.close();
      this.socketClosedController.abort();  // removes all listeners from this.ws
  }

  ready(): boolean {
      return (this.ws.readyState > 0)
  }

  send(message: Buffer) {
      this.ws.send(message);
  }
}

export class Libp2pPeerConnection extends NetworkPeerConnection {
  private conn: Connection;
  private stream: Stream;

  constructor(
      private peer: NetworkPeer,
      private connParam: IncomingStreamData | Multiaddr )
  {
    super();
    if ('stream' in connParam && 'connection' in connParam) { // "instanceof IncomingStreamData"
      this.conn = connParam.connection;
      this.stream = connParam.stream;
    } else {  // "conn_param instanceof Multiaddr" -- I really don't want to manually check if this correctly implements Multiaddr
      // create / "dial" new conn
      // TODO...
    }
  }

  async close(): Promise<void> {
    await this.stream.close();
    await this.conn.close();  // TODO: is it really proper in libp2p terms to close the connection and not just the stream? after all, .handle() dispatches the stream and the conn might be shared
  }

  ready(): boolean {
    return (this.conn.status == "open");
  }

  send(message: Buffer): void {
    pipe([message], this.stream);
  }
}