import { Libp2pTransport } from "./libp2pTransport";
import { NetworkPeer } from "../networkPeer";
import { TransportServer } from "../transportServer";
import { Libp2pPeerConnection } from "./libp2pPeerConnection";
import { logger } from "../../logger";

import { IncomingStreamData } from '@libp2p/interface/stream-handler'

export class Libp2pServer extends TransportServer {
  private listen: string[] = [];
  declare protected transport: Libp2pTransport;

  constructor(parent: Libp2pTransport) {
    super(parent);
  }

  async start(): Promise<void> {
    await this.transport.node.handle(
      "/verity/1.0.0",
      (incomingStreamData: IncomingStreamData) => this.handleIncomingPeer(incomingStreamData));
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

  private handleIncomingPeer(incomingStreamData: IncomingStreamData): void {
    logger.debug(`Libp2pServer: Incoming connection from ${incomingStreamData.connection.remoteAddr.toString()}`);
    const conn = new Libp2pPeerConnection(incomingStreamData, this.transport);
    const networkPeer = new NetworkPeer(
      this.transport.networkManager,
      incomingStreamData.connection.remoteAddr,
      this.transport.networkManager.cubeStore,
      this.transport.networkManager.peerID,
      conn,
      this.transport.networkManager.lightNode,
      this.transport.networkManager.peerExchange
      );
    this.transport.networkManager.handleIncomingPeer(networkPeer);
  }
}