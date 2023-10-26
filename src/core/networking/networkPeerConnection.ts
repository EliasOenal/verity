import { VerityError } from "../settings";
import { AddressError, SupportedTransports } from "./networkDefinitions";

import { TransportMap } from "./networkTransport";
import { Libp2pTransport } from "./libp2p/libp2pTransport";
import { Libp2pPeerConnection } from "./libp2p/libp2pPeerConnection";
import { WebSocketPeerConnection } from "./webSocket/webSocketPeerConnection";
import { AddressAbstraction, WebSocketAddress } from "../peering/addressing";

import EventEmitter from "events";
import { Buffer } from 'buffer';

/**
 * Represents the actual networking component of a NetworkPeer,
 * i.e. the part that actually opens and closes network connections;
 * sends and received messages.
 * @emits "ready" when connection is... you know... ready
 */
export abstract class NetworkPeerConnection extends EventEmitter {
  /** Will resolve once this connection has been opened and is ready for business */
  readyPromise: Promise<void> = new Promise<void>(resolve => this.once('ready', resolve));

  close(): Promise<void> {
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
  toString(): string {
    throw new VerityError("NetworkPeerConnection.toString() to be implemented by subclass")
  }
  get addressString(): string  {
    throw new VerityError("NetworkPeerConnection.toString() to be implemented by subclass")
  }
}