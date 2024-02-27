import { AddressAbstraction, WebSocketAddress } from "../../../peering/addressing";
import { SupportedTransports } from "../../networkDefinitions";
import { TransportConnection } from "../transportConnection";
import { logger } from "../../../logger";

import { isNode } from "browser-or-node";
import WebSocket from 'isomorphic-ws';
import { Buffer } from 'buffer';

export class WebSocketConnection extends TransportConnection {
  private static WEBSOCKET_HANDSHAKE_TIMEOUT = 2500;
  private _ws: WebSocket;  // The WebSocket connection associated with this peer
  get ws(): WebSocket { return this._ws }

  // these two represent a very cumbersome but cross-platform way to remove
  // listeners from web sockets (which we need to do once a peer connection closes)
  private socketClosedController: AbortController = new AbortController();
  private socketClosedSignal: AbortSignal = this.socketClosedController.signal;

  constructor(
      conn_param: WebSocketAddress | WebSocket) {
    super(
      conn_param instanceof WebSocketAddress ?  // address or socket provided?
        new AddressAbstraction(conn_param) :
        new AddressAbstraction(new WebSocketAddress(
          (conn_param as any)?._socket?.remoteAddress,  // ip
          (conn_param as any)?._socket?.remotePort))    // port
    );

    if (conn_param instanceof WebSocket) {
        this._ws = conn_param;
    } else {
      // Create a WebSocket connection
      let WsOptions: any;
      // set a handshake timeout on NodeJS, not possible in the browser
      if (isNode) {
        WsOptions = { handshakeTimeout: WebSocketConnection.WEBSOCKET_HANDSHAKE_TIMEOUT };
      } else {
        WsOptions = [];
      }
      this._ws = new WebSocket(conn_param.toString(true), WsOptions);
    }

    // On WebSocket errors just shut down this peer
    // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
    this._ws.addEventListener("error", (error) => {
      // TODO: We should probably "greylist" peers that closed with an error,
      // i.e. not try to reconnect them for some time.
      logger.info(`${this.toString()}: WebSocket error: ${error.message}`);
      this.close();
    }, { signal: this.socketClosedSignal });

    // Handle incoming messages
    let msgData: Buffer;
    // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
    this._ws.addEventListener("message", async (event) => {
      if (isNode) {
        msgData = Buffer.from(event.data as Buffer);
      } else {
        const blob: Blob = event.data as unknown as Blob;
        msgData = Buffer.from(await blob.arrayBuffer());
      }
      this.transmissionSuccessful();
      this.emit("messageReceived", msgData);  // NetworkPeer will call handleMessage() on this
    }, { signal: this.socketClosedSignal });

    // @ts-ignore When using socketCloseSignal the compiler mismatches the function overload
    this._ws.addEventListener('close', () => {
      // TODO: We should at some point drop nodes closing on us from our PeerDB,
      // at least if they did that repeatedly and never even sent a valid HELLO.
      logger.info(`${this.toString()}: Peer closed on us`);
      this.close();
    }, { once: true, signal: this.socketClosedSignal });

    if (this.ready()) this.emit("ready");
    else this._ws.addEventListener("open", () =>  {
      this.emit("ready");
    // @ts-ignore I don't know why the compiler complains about the signal
    }, { once: true, signal: this.socketClosedSignal });
  }

  /**
   * Closes the connection.
   * This will be called by NetworkPeer.close() and should thus never be
   * called directly.
   */
  close(): Promise<void> {
    this.socketClosedController.abort();  // removes all listeners from this.ws
    super.close();

    // Close the socket, if not already closed or closing
    if (this._ws.readyState < this._ws.CLOSING) {  // only close if not already closing
      logger.trace(`${this.toString()}: close(): Closing socket`);
      // Return a promise that will be resolved when the socket has closed
      const closedPromise = new Promise<void>((resolve) =>
        this._ws.addEventListener('close', () => resolve(), { once: true }));
      this._ws.close();
      return closedPromise;
    } else {  // already closed
      logger.trace(`${this.toString()}: close(): Doing nothing, socket status already ${this._ws.readyState}`);
      // Return a resolved promise
      return new Promise<void>(resolve => resolve());
    }
  }

  ready(): boolean {
    return (this._ws.readyState == WebSocket.OPEN)
  }

  send(message: Buffer) {
    if (this.ready()) {
      this._ws.send(message);
      if (this.ready()) this.transmissionSuccessful();
      else this.transmissionError();
    } else {
      logger.warn(`WebSocketPeerConnection to ${this._ws.url}: Tried to send data but socket not ready`);
      this.transmissionError();
    }
  }

  type(): SupportedTransports {
    return SupportedTransports.ws;
  }

  get open(): boolean {
    if (this._ws.readyState === WebSocket.OPEN) return true;
    else return false;
  }

  toString(): string {
    return `WebSocketConnection to ${this.addressString}`;
  }
  get address(): AddressAbstraction {
    if ('socket' in this._ws && this._ws.socket) {  // will only work on NodeJS; remote IP and port not available in the browser
      return new AddressAbstraction(new WebSocketAddress((this._ws as any)?._socket?.remoteAddress, (this._ws as any)?._socket?.remotePort));
    }
    else return super.address;

  }
  get addressString(): string {
    if (this._ws?.url?.length) return this._ws.url;
    else return super.addressString;
  }
}
