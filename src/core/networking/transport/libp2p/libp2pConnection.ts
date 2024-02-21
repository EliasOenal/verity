import { VerityError } from "../../../settings";
import { SupportedTransports } from "../../networkDefinitions";

import { Libp2pTransport } from "./libp2pTransport";
import { TransportConnection } from "../transportConnection";

import { logger } from "../../../logger";

import { Connection, Stream } from '@libp2p/interface/src/connection'
import { Multiaddr } from '@multiformats/multiaddr'
import { pipe } from 'it-pipe'
import { Buffer } from 'buffer';
import { lpStream, LengthPrefixedStream } from 'it-length-prefixed-stream'

import type { IncomingStreamData } from '@libp2p/interface/src/stream-handler'
import { Uint8ArrayList } from 'uint8arraylist'
import { AddressAbstraction } from "../../../peering/addressing";

export class Libp2pConnection extends TransportConnection {
  private conn: Connection = undefined;
  private stream: LengthPrefixedStream;
  private rawStream: Stream;

  constructor(
      connParam: IncomingStreamData | Multiaddr,
      private transport: Libp2pTransport,
  ){
    super(
      'stream' in connParam && 'connection' in connParam ?  // "instanceof IncomingStreamData"
      new AddressAbstraction(connParam.connection.remoteAddr) :
      new AddressAbstraction(connParam)
    );

    if ('stream' in connParam && 'connection' in connParam) { // "instanceof IncomingStreamData"
      this.conn = connParam.connection;
      this.rawStream = connParam.stream;
      this.stream = lpStream(this.rawStream);
      if (this.ready()) this.emit("ready");
      logger.trace(this.toString() + " created on existing conn");
      this.handleStreams();
    } else {  // "conn_param instanceof Multiaddr" -- I really don't want to manually check if this correctly implements Multiaddr
      this.createConn(connParam);
    }
  }

  async handleStreams() {
    // HACKHACK reserve relay slot -- this doesn't really belong here but w/e
    if (this.transport.circuitRelayTransport) {
      this.transport.circuitRelayTransport.reservationStore.addRelay(
        this.conn.remotePeer, "configured");
    }

    let msg: Uint8ArrayList;
    try {
      // Wait till a message is received.
      // Libp2p streams are continuous and have no native notion of messages,
      // but we wisely prefixed each message with its length at the sender.
      // Out lpStream (lp = length prefixed) object this.stream will kindly
      // re-assemble the message for us.
      while (msg = await this.stream.read()) {
        const msgBuf: Buffer = Buffer.from(
          msg.subarray()  // Note: Here, subarray() re-assembles a message which
                          // may have been received in many fragments.
        );
        this.emit("messageReceived", msgBuf);

        // HACKHACK: Abuse this method as event handler and check if we learned
        // a new multiaddr. In particular, this may happen shortly after
        // connecting to a relay-capable server node, in which case we will
        // now learn our connectable WebRTC address used for browser-to-browser
        // connections.
        // logger.trace("Libp2pPeerConnection: Just wanted to remind you that I'm listening with " + this.server.toString());
        this.transport.addressChange();  // HACKHACK: this is a lie, they might not even have changed
      }  // this loop should never end until we destruct the stream
      logger.trace(`${this.toString()}: Got non-truthy val while reading input stream, closing. Val was: ${msg}`);
      this.close();
    } catch (error) {
      logger.trace(`${this.toString()}: Caught error while reading input stream, closing. Error was: ${error}`);
      this.close();
    }
  }

  async createConn(addr: Multiaddr) {
    logger.trace("Libp2pPeerConnection: Creating new connection to " + addr.toString());
    try {
      this.conn = await this.transport.node.dial(addr);
      if (this.conn.transient) {
        logger.trace(`Libp2pPeerConnection to ${addr.toString()}: Connection is transient. Waiting up to 10 seconds for it to upgrade.`);
        // TODO HACKHACK: This is obviously the most ridiculous hack ever.
        // Apparently, there once upon a time was a peer:update event you could
        // listen to, but it doesn not seem to exist anymore.
        // I don't understand libp2p.
        for (let i = 0; i < 100; i++) {
          if (!this.conn.transient) {
              break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (this.conn.transient) {
          logger.error(`Libp2pPeerConnection to ${addr.toString()}: Connection still transient after 10 seconds. Giving up, closing.`)
          this.close();
          return;
        }
      }
      this.rawStream = await this.conn.newStream("/verity/1.0.0");
      this.stream = lpStream(this.rawStream);
      if (this.ready()) this.emit("ready");
      else throw new VerityError("Libp2p connection not open and I have no clue why");
      logger.trace("Libp2pPeerConnection: Successfully connected to " + addr.toString() + ". My multiaddrs are " + this.transport.node.getMultiaddrs() + " and my peer ID is " + Buffer.from(this.transport.node.peerId.publicKey).toString('hex'));
      this.handleStreams();
    } catch (error) {
      // TODO FIXME: This currently happens when we try to dial a libp2p connection before
      // our libp2p node object has been initialized, and we always do that on startup.
      logger.info("Libp2pPeerConnection: Connection to " + addr.toString() + " failed or closed or something: " + error);
      this.close();
    }
  }

  close(): Promise<void> {
    logger.info("Libp2pPeerConnection: Closing connection to " + this.addressString);
    // Send the "closed" signal first (i.e. let the NetworkPeer closed handler run
    // first) so nobody tries to send any further messages to our closing stream
    this.emit("closed");
    this.removeAllListeners();
    let closePromises: Promise<void>[] = [];
    if (this.rawStream) {
      try {
        closePromises.push(this.rawStream.close());
      } catch(error) {
        logger.error(`${this.toString()} in close(): Error closing libp2p stream. This should not happen. Error was: ${error}`);
      }
    }
    // Kind of a strange decision to fully close the conn as they're usually
    // auto-managed in libp2p.
    // Furthermore, our streams are a bit flimsy and often close for no apparent reason.
    // We probably should really stop keeping streams open in the first place.
    if (this.conn) {
      closePromises.push(this.transport.node.hangUp(this.conn.remotePeer));
      // this is redundant:
      closePromises.push(this.conn.close());
    }
    if (closePromises.length) {
      return Promise.all(closePromises) as unknown as Promise<void>;
    } else {
      return new Promise<void>(resolve => resolve());  // Return a resolved promise
    }
  }

  ready(): boolean {
    if (!this.rawStream) return false;
    else if (this.conn.status !== 'open') return false;
    else return (this.rawStream.status === "open");
  }

  /**
   * Transmits a Verity node-to-node message to our peer.
   */
  send(message: Buffer): void {
    if (this.rawStream?.status != "open") {
      logger.error(`${this.toString()}: Tried to send() data but stream is not open. This should not happen! Stream status is ${this.rawStream?.status}. Closing connection.`);
      this.close();
      return;
    }
    try {
      this.stream.write(message);
    } catch(error) {
      logger.error(`${this.toString()} in send(): Error writing to stream. Error was: ${error}`);
    }
    // logger.trace("Libp2pPeerConnection: Sending message of length " + message.length + " to " + this.addressString + ", raw bytes: " + message.toString('hex'));
  }

  type(): SupportedTransports {
    return SupportedTransports.libp2p;
  }

  toString(): string {
    return "Libp2pConnection to " + this.addressString;
  }
}
