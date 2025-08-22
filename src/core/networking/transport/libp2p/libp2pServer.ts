import { Libp2pTransport } from "./libp2pTransport";
import { NetworkPeer } from "../../networkPeer";
import { TransportServer } from "../transportServer";
import { Libp2pConnection } from "./libp2pConnection";
import { logger } from "../../../logger";

import type { IncomingStreamData } from '@libp2p/interface'

export class Libp2pServer extends TransportServer {
  private listen: string[] = [];

  constructor(transport: Libp2pTransport) {
    super(transport);
  }

  async start(): Promise<void> {
    await (this.transport as Libp2pTransport).node.handle(
      "/verity/1.0.0",
      (incomingStreamData: IncomingStreamData) => this.handleIncoming(incomingStreamData));
    logger.info("Libp2pServer: Listening to Libp2p multiaddrs: " + (this.transport as Libp2pTransport).node.getMultiaddrs().toString());
    // logger.info("Transports are: " + this.server.components.transportManager.getTransports());
  }

  shutdown(): Promise<void> {
    // TODO: Something's still fishy here... node is sometimes undefined
    return (this.transport as Libp2pTransport).node?.unhandle("/verity/1.0.0");
  }

  toString(): string {
    return this.transport.toString();
  }
  toLongString(): string {
    return (this.transport as Libp2pTransport).toLongString();
  }

  /** @emits "incomingConnection": Libp2pConnection */
  private handleIncoming(incomingStreamData: IncomingStreamData): void {
    try {
      logger.trace(`Libp2pServer.handleIncoming(): Incoming connection from ${incomingStreamData.connection.remoteAddr.toString()}`);
      const conn: Libp2pConnection =
        new Libp2pConnection(incomingStreamData, this.transport as Libp2pTransport);
      this.emit("incomingConnection", conn);
    } catch (error) {
      logger.warn(`Libp2pServer.handleIncoming(): Error while handling incoming connection: ${error}`);
    }
  }
}