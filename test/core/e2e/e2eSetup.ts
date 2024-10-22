import { SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { AddressAbstraction, WebSocketAddress } from "../../../src/core/peering/addressing";
import { VerityNode } from "../../../src/core/verityNode";
import { testCoreOptions } from "../testcore.definition";

export class LineShapedNetwork {
  constructor(
    public sender: VerityNode,
    public fullNode1: VerityNode,
    public fullNode2: VerityNode,
    public recipient: VerityNode,
  ) {}

  static async Create(fullNode1Port: number, fullNode2Port: number): Promise<LineShapedNetwork> {
    // set up a small line-shaped network:
    // Sender light node - Full node 1 - Full node 2 - Recipient light node
    // As peer exchange is off, it should stay line shaped so we properly test
    // Cube propagation.
    const fullNode1: VerityNode = new VerityNode({
      ...testCoreOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.ws, fullNode1Port],
      ]),
    });
    await fullNode1.readyPromise;
    const fullNode2: VerityNode = new VerityNode({
      ...testCoreOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.ws, fullNode2Port],
      ]),
      initialPeers: [new AddressAbstraction(new WebSocketAddress(
        "127.0.0.1", fullNode1Port))],
    });
    const sender: VerityNode = new VerityNode({
      ...testCoreOptions,
      inMemory: true,
      lightNode: true,
      initialPeers: [new AddressAbstraction(new WebSocketAddress(
        "127.0.0.1", fullNode1Port))],
    });
    await fullNode2.readyPromise;
    const recipient: VerityNode = new VerityNode({
      ...testCoreOptions,
      inMemory: true,
      lightNode: true,
      initialPeers: [new AddressAbstraction(new WebSocketAddress(
        "127.0.0.1", fullNode2Port))],
    });
    await sender.readyPromise;
    await recipient.readyPromise;

    return new this(sender, fullNode1, fullNode2, recipient);
  }
}
