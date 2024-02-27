import { NetworkError, SupportedTransports } from "../../networkDefinitions";

import { Libp2pTransport } from "./libp2pTransport";
import { TransportConnection } from "../transportConnection";

import { AddressAbstraction } from "../../../peering/addressing";
import { logger } from "../../../logger";

import { Connection, Stream } from '@libp2p/interface/src/connection'
import type { IncomingStreamData } from '@libp2p/interface/src/stream-handler'
import { Multiaddr } from '@multiformats/multiaddr'

import { Uint8ArrayList } from 'uint8arraylist'
import { Buffer } from 'buffer';
import { lpStream, LengthPrefixedStream } from 'it-length-prefixed-stream'


export class Libp2pConnection extends TransportConnection {
  conn: Connection = undefined;
  stream: LengthPrefixedStream;
  rawStream: Stream;

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
      this.acceptConn(connParam);
    } else {  // "conn_param instanceof Multiaddr" -- I really don't want to manually check if this correctly implements Multiaddr
      this.createConn(connParam);
    }
  }

  async createConn(addr: Multiaddr) {
    logger.trace("Libp2pPeerConnection: Creating new connection to " + addr.toString());
    try {
      this.conn = await this.transport.node.dial(addr);
      if (!(await this.isConnReady())) return this.close();
      this.rawStream = await this.conn.newStream("/verity/1.0.0");
      this.stream = lpStream(this.rawStream);
      if (this.ready()) this.emit("ready");
      else throw new NetworkError("Libp2p connection not open and I have no clue why");
      logger.trace("Libp2pPeerConnection: Successfully connected to " + addr.toString() + ". My multiaddrs are " + this.transport.node.getMultiaddrs() + " and my peer ID is " + Buffer.from(this.transport.node.peerId.publicKey).toString('hex'));
      this.handleStreams();
    } catch (error) {
      // TODO FIXME: This currently happens when we try to dial a libp2p connection before
      // our libp2p node object has been initialized, and we always do that on startup.
      logger.info("Libp2pPeerConnection: Connection to " + addr.toString() + " failed or closed or something: " + error);
      this.close();
    }
  }

  async acceptConn(incoming: IncomingStreamData) {
    this.conn = incoming.connection;
    if (!(await this.isConnReady())) return this.close();
    this.rawStream = incoming.stream;
    this.stream = lpStream(this.rawStream);
    if (this.ready()) this.emit("ready");
    else throw new NetworkError("Libp2p connection not open and I have no clue why");
    logger.trace(this.toString() + " created on existing or incoming conn");
    this.handleStreams();
  }

  private async isConnReady(): Promise<boolean> {
    if (this.conn.status !== 'open') {
      logger.warn(`${this.toString()}: Underlying conn is not open, closing. This should never happen.`);
      this.close();
      return false;
    }
    if (this.conn.transient) {
      logger.trace(`${this.toString()}: Connection is transient. Waiting up to 10 seconds for it to upgrade.`);
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
        logger.info(`${this.toString()}: Connection still transient after 10 seconds. Giving up, closing.`)
        this.close();
        return false;
      }
    }
    if (this.conn.status === 'open' && this.conn.transient === false) return true;
    else return false;
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
        this.transmissionSuccessful();  // take note that conn is still up
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
      logger.trace(`${this.toString()}: Caught error while reading input stream. Error was: ${error}`);
      this.transmissionError();
    }
  }

  async close(): Promise<void> {
    logger.info("Libp2pPeerConnection: Closing connection to " + this.addressString);
    // Send the "closed" signal first (i.e. let the NetworkPeer closed handler run
    // first) so nobody tries to send any further messages to our closing stream
    this.emit("closed");
    this.removeAllListeners();
    if (this.rawStream) {
      try {
        await this.rawStream.close();
      } catch(error) {
        logger.info(`${this.toString()} in close(): Error closing libp2p stream. This should not happen. Error was: ${error}`);
      }
    }
    // Does this conn have another Verity stream? This can happen because
    // connections in libp2p are at least partially auto-managed, and,
    // in particular, are also auto-reused: Closing this
    // libp2-level connection may inadvertantly kill off another of our
    // Verity-level connections as it may use the same libp2p conn.
    // In particular, this happens when we deem one of our connections duplicate
    // but libp2p considers the one we deemed duplicate the "original".
    if (this.conn && this.conn.status === 'open') {
      let connStillInUse = false;
      for (const stream of this.conn.streams) {
        if (stream.protocol == "/verity/1.0.0") {
          logger.info(`${this.toString()} is closing but will leave underlying libp2p conn open as it has another Verity stream`);
          connStillInUse = true;
          break;
        }
      }
      if (!connStillInUse) await this.conn.close();
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
      logger.warn(`${this.toString()}: Tried to send() data but stream is not open. This should not happen! Stream status is ${this.rawStream?.status}. Closing connection.`);
      this.close();
      return;
    }
    this.stream.write(message).then(
      () => this.transmissionSuccessful()).catch(
      error => {
        logger.info(`${this.toString()} in send(): Error writing to stream. Error was: ${error}`);
        this.transmissionError();
    });
  }

  type(): SupportedTransports {
    return SupportedTransports.libp2p;
  }

  toString(): string {
    return "Libp2pConnection to " + this.addressString;
  }

  get address(): AddressAbstraction {
    if (this.conn?.remoteAddr) return new AddressAbstraction(this.conn.remoteAddr);
    else return super.address;
  }
}
