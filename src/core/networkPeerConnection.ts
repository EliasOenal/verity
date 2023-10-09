import { isNode } from "browser-or-node";
import { VerityError } from "./config";
import { logger } from "./logger";
import { NetworkPeer } from "./networkPeer";
import { AddressAbstraction, WebSocketAddress } from "./peerDB";

import EventEmitter from "events";
import WebSocket from 'isomorphic-ws';
import { Buffer } from 'buffer';

import { IncomingStreamData } from '@libp2p/interface/stream-handler'
import { Connection, Stream } from '@libp2p/interface/connection'
import { Multiaddr } from '@multiformats/multiaddr'
import { pipe } from 'it-pipe'
import { createLibp2p } from 'libp2p';
import { Libp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { noise } from '@chainsafe/libp2p-noise'
import { circuitRelayTransport, circuitRelayServer } from 'libp2p/circuit-relay'
import { yamux } from '@chainsafe/libp2p-yamux'
import * as filters from '@libp2p/websockets/filters'
import { PassThrough } from 'stream';
import { identifyService } from 'libp2p/identify'
import { Libp2pServer, SupportedTransports } from "./networkServer";

export class NetworkError extends VerityError  {}
export class AddressError extends NetworkError {}


/**
 * Represents the actual networking component of a NetworkPeer,
 * i.e. the part that actually opens and closes network connections;
 * sends and received messages.
 * @emits "ready" when connection is... you know... ready
 */
export abstract class NetworkPeerConnection extends EventEmitter {
  static Create(address: AddressAbstraction, libp2pServer?: Libp2pServer) {
    if (address.addr instanceof WebSocketAddress) {
        return new WebSocketPeerConnection(address.addr)
    } else if ('getPeerId' in address.addr) {  // "addr instanceof Multiaddr"
        if (!libp2pServer.node) throw new AddressError("To create a libp2p connection the libp2p node object must be supplied and ready.");
        return new Libp2pPeerConnection(libp2pServer, address.addr);
    }
    else {
        throw new AddressError("NetworkPeerConnection.Create: Unsupported address type");
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

  type(): SupportedTransports {
    throw new VerityError("NetworkPeerConnection.type() to be implemented by subclass")
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
      conn_param: WebSocketAddress | WebSocket) {
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
      this.ws = new WebSocket(conn_param.toString(true), WsOptions);
    }

    // On WebSocket errors just shut down this peer
    // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
    this.ws.addEventListener("error", (error) => {
      // TODO: We should probably "greylist" peers that closed with an error,
      // i.e. not try to reconnect them for some time.
      logger.info(`WebSockerPeerConnection: WebSocket error: ${error.message}`);
      this.close();
    }, { signal: this.socketClosedSignal });

    // Handle incoming messages
    let msgData: Buffer;
    // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
    this.ws.addEventListener("message", async (event) => {
      if (isNode) {
        msgData = Buffer.from(event.data as Buffer);
      } else {
        const blob: Blob = event.data as unknown as Blob;
        msgData = Buffer.from(await blob.arrayBuffer());
      }
      this.emit("messageReceived", msgData);  // NetworkPeer will call handleMessage() on this
    }, { signal: this.socketClosedSignal });

    this.ws.addEventListener('close', () => {
      // TODO: We should at some point drop nodes closing on us from our PeerDB,
      // at least if they did that repeatedly and never even sent a valid HELLO.
      logger.info(`WebSocketPeerConnection: Peer closed on us`);
      this.close();
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
    this.emit("closed");
    this.removeAllListeners();
    this.ws.close();
    this.socketClosedController.abort();  // removes all listeners from this.ws
  }

  ready(): boolean {
    return (this.ws.readyState > 0)
  }

  send(message: Buffer) {
    this.ws.send(message);
  }

  type(): SupportedTransports {
    return SupportedTransports.ws;
  }
}

// TODO: We currently create a new Libp2p node object for each connection.
// That's not how libp2p is supposed to be used.
export class Libp2pPeerConnection extends NetworkPeerConnection {
  private conn: Connection = undefined;
  private stream: Stream = undefined;
  private outputStream: PassThrough = new PassThrough();

  constructor(
      private server: Libp2pServer,
      private connParam: IncomingStreamData | Multiaddr )
  {
    super();
    if ('stream' in connParam && 'connection' in connParam) { // "instanceof IncomingStreamData"
      this.conn = connParam.connection;
      this.stream = connParam.stream;
      if (this.ready()) this.emit("ready");
      this.handleStreams();
    } else {  // "conn_param instanceof Multiaddr" -- I really don't want to manually check if this correctly implements Multiaddr
      this.createConn(connParam);
    }
  }

  handleStreams() {
    // pipe(this.outputStream, this.stream, async (source) => {
    //   for await (const message of source) {
    //     this.inputStream.write(Buffer.from(message.subarray()));
    //   }
    // }).catch(logger.error);
    pipe(this.outputStream, this.stream.sink);
    this.readStream();
  }

  /**
   * Event handler for incoming stream data.
   */
  async readStream() {
    // As libp2p streams have no concept of messages, we'll have to splice the individual
    // Verity node-to-node messages out this pseudo-continuous stream of data.
    // To enable us to do so, messages have kindly been prefix with their length
    // by the sender (see send()).
    // This most certainly is not the way libp2p expects you to do it as it seems
    // you usually spawn separate streams for each message.
    // All of the below must look ridonculous to anybody who actually understands libp2p.
     if (this.stream.status == "open") {
      await pipe(
        this.stream.source,
        async (source) => {
          // msgbuf will store received message fragments until we've received
          // a message in full.
          let msgbuf: Buffer = Buffer.alloc(0);
          // msgsize will store the next message's size, which has been indicated
          // as a message prefix by the sender.
          // 0 indicates there's currently no pending message fragment.
          let msgsize: number = 0;
          for await (const msg of source) {
            // get message fragment by concatenating it onto any existing unprocess
            // we might be holding
            msgbuf = Buffer.concat([msgbuf, msg.subarray()]);
            // logger.trace("Libp2pPeerConnection: After receiving this message, my msgbuf for " + this.peer.addressString + " is now " + msgbuf.toString('hex'));

            // parse data
            let tryToParseLength: boolean = true;
            let tryToParseMessage: boolean = true;
            while (tryToParseLength || tryToParseMessage) {  // I wanted to use goto but there was none available
              if (!msgsize && msgbuf.length >= 4) {  // if this is the start of a new message, read its length
                msgsize = msgbuf.readUint32BE();
                msgbuf = msgbuf.subarray(4, msgbuf.length);
                // logger.trace("Libp2pPeerConnection: Starting to receive a new message of length " + msgsize + " from " + this.peer.addressString + ", my msgbuf is now " + msgbuf.toString('hex'));
                tryToParseLength = true;
              } else {
                tryToParseLength = false;
              }
              // message fully received?
              if (msgsize && msgbuf.length >= msgsize) {
                // Pull fully received message out of msgbuf
                const msg: Buffer = msgbuf.subarray(0, msgsize);
                msgbuf = msgbuf.subarray(msgsize, msgbuf.length);
                // logger.trace("Libp2pPeerConnection: Fully received a message of length " + msgsize + " from " + this.peer.addressString + ", message is: " + msg.toString('hex') + "; my msgbuf is now: " + msgbuf.toString('hex'));
                msgsize = 0;  // 0 indicates no pending message fragment
                this.emit("messageReceived", msg);
                tryToParseMessage = true;
              } else {
                tryToParseMessage = false;
              }
            }

            // HACKHACK: Abuse this method as event handler and check if we learned
            // a new multiaddr. In particular, this may happen shortly after
            // connecting to a relay-capable server node, in which case we will
            // now learn our connectable WebRTC address used for browser-to-browser
            // connections.
            logger.trace("Libp2pPeerConnection: Just wanted to remind you that my multiaddrs still are " + this.server.node?.getMultiaddrs());
            this.server.addressChange();  // HACKHACK: this is a lie, they might not even have changed
          }
        }
      );
    }
    logger.info("Libp2pPeerConnection: Stream from " + this.conn.remoteAddr + " ended, closing connection.");
    this.close();
  }

  async createConn(addr: Multiaddr) {
    logger.trace("Libp2pPeerConnection: Creating new connection to " + addr.toString());
    try {
      this.conn = await this.server.node.dial(addr);
      this.stream = await this.conn.newStream("/verity/1.0.0");
      if (this.ready()) this.emit("ready");
      else throw new VerityError("Libp2p connection not open and I have no clue why");
      logger.trace("Libp2pPeerConnection: Successfully connected to " + addr.toString() + ". My multiaddrs are " + this.server.node.getMultiaddrs() + " and my peer ID is " + Buffer.from(this.server.node.peerId.publicKey).toString('hex'));
      this.handleStreams();
    } catch (error) {
      // TODO FIXME: This currently happens when we try to dial a libp2p connection before
      // our libp2p node object has been initialized, and we always do that on startup.
      // TODO FIXME: If this happens, NetworkPeer.close() is not called, as apparently it's not listening on our close event yet.
      logger.info("Libp2pPeerConnection: Connection to " + addr.toString() + " failed or closed or something: " + error);
      this.close();
    }
  }

  close(): void {
    logger.info("Libp2pPeerConnection: Closing connection to " + this.conn?.remoteAddr.toString());
    this.emit("closed");
    this.removeAllListeners();
    if (this.stream) {
      this.stream.close();  // note all of this is async and we're just firing-and-forgetting the request
    }
    if (this.conn) {
      this.conn.close();  // TODO: is it really proper in libp2p terms to close the connection and not just the stream? after all, for servers, .handle() dispatches the stream and the conn might be shared
    }
  }

  ready(): boolean {
    if (!this.stream) return false;
    else return (this.stream.status == "open");
  }

  /**
   * Transmits a Verity node-to-node message to our peer.
   */
  send(message: Buffer): void {
    // As libp2p streams have no concept of messages, we prefix them with their
    // length, allowing the received to re-assemble the original messages from the
    // stream.
     const lenbuf = Buffer.alloc(4);
    lenbuf.writeUint32BE(message.length);
    const combined = Buffer.concat([lenbuf, message]);
    this.outputStream.write(combined);
    // logger.info("Libp2pPeerConnection: Sending message of length " + message.length + " to " + this.peer.addressString + ", raw bytes: " + combined.toString('hex'));
  }

  type(): SupportedTransports {
    return SupportedTransports.libp2p;
  }
}