import { Libp2pTransport } from "./libp2pTransport";
import { NetworkPeer } from "../../networkPeer";
import { TransportServer } from "../transportServer";
import { Libp2pConnection } from "./libp2pConnection";
import { logger } from "../../../logger";

import type { IncomingStreamData } from '@libp2p/interface/src/stream-handler'

export class Libp2pServer extends TransportServer {
  private listen: string[] = [];
  declare protected transport: Libp2pTransport;

  constructor(parent: Libp2pTransport) {
    super(parent);
  }

  async start(): Promise<void> {
    await this.transport.node.handle(
      "/verity/1.0.0",
      (incomingStreamData: IncomingStreamData) => this.handleIncoming(incomingStreamData));
    logger.info("Libp2pServer: Listening to Libp2p multiaddrs: " + this.transport.node.getMultiaddrs().toString());
    // logger.info("Transports are: " + this.server.components.transportManager.getTransports());
  }

  shutdown(): Promise<void> {
    // TODO: Something's still fishy here...
    return this.transport.node.unhandle("/verity/1.0.0");
  }

  toString(): string {
    return this.transport.toString();
  }
  toLongString(): string {
    return this.transport.toLongString();
  }

  /** @emits "incomingConnection": Libp2pConnection */
  private handleIncoming(incomingStreamData: IncomingStreamData): void {
    logger.trace(`Libp2pServer: Incoming connection from ${incomingStreamData.connection.remoteAddr.toString()}`);
    const conn: Libp2pConnection =
      new Libp2pConnection(incomingStreamData, this.transport);
    this.emit("incomingConnection", conn);
  }
}