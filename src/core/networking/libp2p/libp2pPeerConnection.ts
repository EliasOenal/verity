import { VerityError } from "../../settings";
import { SupportedTransports } from "../networkDefinitions";

import { Libp2pTransport } from "./libp2pTransport";
import { NetworkPeerConnection } from "../networkPeerConnection";

import { logger } from "../../logger";

import { IncomingStreamData } from '@libp2p/interface/stream-handler'
import { Connection, Stream } from '@libp2p/interface/connection'
import { Multiaddr } from '@multiformats/multiaddr'
import { pipe } from 'it-pipe'
import { PassThrough } from 'stream';
import { Buffer } from 'buffer';

export class Libp2pPeerConnection extends NetworkPeerConnection {
  private conn: Connection = undefined;
  private stream: Stream = undefined;
  private outputStream: PassThrough = new PassThrough();

  constructor(
      private connParam: IncomingStreamData | Multiaddr,
      private transport: Libp2pTransport,
  ){
    super();
    if ('stream' in connParam && 'connection' in connParam) { // "instanceof IncomingStreamData"
      this.conn = connParam.connection;
      this.stream = connParam.stream;
      if (this.ready()) this.emit("ready");
      logger.trace(this.toString() + " created on existing conn");
      this.handleStreams();
    } else {  // "conn_param instanceof Multiaddr" -- I really don't want to manually check if this correctly implements Multiaddr
      this.createConn(connParam);
    }
  }

  handleStreams() {
    // HACKHACK reserve relay slot -- this doesn't really belong here but w/e
    if (this.transport.circuitRelayTransport) {
      this.transport.circuitRelayTransport.reservationStore.addRelay(
        this.conn.remotePeer, "configured");
    }

    // read continuous Verity stream
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
            // logger.trace("Libp2pPeerConnection: Just wanted to remind you that I'm listening with " + this.server.toString());
            this.transport.addressChange();  // HACKHACK: this is a lie, they might not even have changed
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
      this.stream = await this.conn.newStream("/verity/1.0.0");
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
    logger.info("Libp2pPeerConnection: Closing connection to " + this.conn?.remoteAddr.toString());
    // Send the "closed" signal first (i.e. let the NetworkPeer closed handler run
    // first) so nobody tries to send any further messages to our closing stream
    this.emit("closed");
    this.removeAllListeners();
    let closePromises: Promise<void>[] = [];
    if (this.stream) {
      try {
        closePromises.push(this.stream.close());
      } catch(error) {
        logger.error(`Libp2pPeerConnection to ${this.conn?.remoteAddr?.toString()} in close(): Error closing libp2p stream. This should not happen. Error was: ${error}`);
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
    if (!this.stream) return false;
    else return (this.stream.status == "open");
  }

  /**
   * Transmits a Verity node-to-node message to our peer.
   */
  send(message: Buffer): void {
    if (this.stream?.status != "open") {
      logger.error(`Libp2pPeerConnection to ${this.conn?.remoteAddr?.toString()}: Tried to send() data but stream is not open. This should not happen! Stream status is ${this.stream?.status}. Closing connection.`);
      this.close();
      return;
    }
    // As libp2p streams have no concept of messages, we prefix them with their
    // length, allowing the received to re-assemble the original messages from the
    // stream.
    const lenbuf = Buffer.alloc(4);
    lenbuf.writeUint32BE(message.length);
    const combined = Buffer.concat([lenbuf, message]);
    try {
      this.outputStream.write(combined);
    } catch(error) {
      logger.error(`Libp2pPeerConnection to ${this.conn?.remoteAddr?.toString()} in send(): Error writing to stream. Error was: ${error}`);
    }
    // logger.info("Libp2pPeerConnection: Sending message of length " + message.length + " to " + this.peer.addressString + ", raw bytes: " + combined.toString('hex'));
  }

  type(): SupportedTransports {
    return SupportedTransports.libp2p;
  }

  toString(): string {
    return "Libp2pConnection to " + this.conn?.remoteAddr?.toString();
  }
  get addressString(): string {
    return this.conn?.remoteAddr?.toString();
  }
}
