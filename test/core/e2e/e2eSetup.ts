import { VerityNode } from "../../../src/cci/verityNode";
import { SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { AddressAbstraction, WebSocketAddress } from "../../../src/core/peering/addressing";
import { CoreNodeOptions } from "../../../src/core/coreNode";
import { NetworkPeer } from "../../../src/core/networking/networkPeer";
import { testCoreOptions } from "../testcore.definition";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { NetworkPeerIf } from "../../../src/core/networking/networkPeerIf";

export class LineShapedNetwork {
  senderToFullNode1: NetworkPeer;
  fullNode1ToFullNode2: NetworkPeer;
  fullNode2ToRecipient: NetworkPeer;

  recipientToFullNode2: NetworkPeer;
  fullNode2ToFullNode1: NetworkPeer;
  fullNode1ToSender: NetworkPeer;

  constructor(
    public sender: VerityNode,      // note: using CCI VerityNode here instead of a plain
    public fullNode1: VerityNode,   //   CoreNode breaks out layering, but
    public fullNode2: VerityNode,   //   saves us from a lot of object oriented SNAFU
    public recipient: VerityNode,   //   when this setup is reused in CCI tests
  ) {}

  static async Create(
      fullNode1Port: number,
      fullNode2Port: number,
      options: CoreNodeOptions = {},
  ): Promise<LineShapedNetwork> {
    const testOptions = Object.assign({}, testCoreOptions, options);
    // set up a small line-shaped network:
    // Sender light node - Full node 1 - Full node 2 - Recipient light node
    // As peer exchange is off, it should stay line shaped so we properly test
    // Cube propagation.
    const fullNode1: VerityNode = new VerityNode({
      ...testOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.ws, fullNode1Port],
      ]),
    });
    await fullNode1.readyPromise;
    const fullNode2: VerityNode = new VerityNode({
      ...testOptions,
      lightNode: false,
      transports: new Map([
        [SupportedTransports.ws, fullNode2Port],
      ]),
      initialPeers: [new AddressAbstraction(new WebSocketAddress(
        "127.0.0.1", fullNode1Port))],
    });
    const sender: VerityNode = new VerityNode({
      ...testOptions,
      inMemory: true,
      lightNode: true,
      initialPeers: [new AddressAbstraction(new WebSocketAddress(
        "127.0.0.1", fullNode1Port))],
    });
    await fullNode2.readyPromise;
    const recipient: VerityNode = new VerityNode({
      ...testOptions,
      inMemory: true,
      lightNode: true,
      initialPeers: [new AddressAbstraction(new WebSocketAddress(
        "127.0.0.1", fullNode2Port))],
    });
    await sender.readyPromise;
    await recipient.readyPromise;

    const ret = new this(sender, fullNode1, fullNode2, recipient);

    await Promise.all([
      fullNode1.onlinePromise,
      fullNode2.onlinePromise,
      sender.onlinePromise,
      recipient.onlinePromise,
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));  // give it some time

    // assert connected as expected and expose connections as NetworkPeer objects:
    // Sender --> Full Node 1
    expect(sender.networkManager.outgoingPeers.length).toBe(1);
    ret.senderToFullNode1 = sender.networkManager.outgoingPeers[0] as NetworkPeer;

    // Full Node 1 --> Full Node 2
    expect(fullNode1.networkManager.incomingPeers.length).toBe(2);
    ret.fullNode1ToFullNode2 = fullNode1.networkManager.incomingPeers.find(
      (peer: NetworkPeerIf) => peer.id.equals(fullNode2.networkManager.id)
    ) as NetworkPeer;
    expect(ret.fullNode1ToFullNode2).toBeInstanceOf(NetworkPeer);

    // Full Node 2 --> Recipient
    expect(fullNode2.networkManager.incomingPeers.length).toBe(1);
    ret.fullNode2ToRecipient = fullNode2.networkManager.incomingPeers[0] as NetworkPeer;;

    // Recipient --> Full Node 2
    expect(recipient.networkManager.outgoingPeers.length).toBe(1);
    ret.recipientToFullNode2 = recipient.networkManager.outgoingPeers[0] as NetworkPeer;

    // Full Node 2 --> Full Node 1
    expect(fullNode2.networkManager.outgoingPeers.length).toBe(1);
    ret.fullNode2ToFullNode1 = recipient.networkManager.outgoingPeers[0] as NetworkPeer;

    // Full Node 1 --> Sender
    ret.fullNode1ToSender = fullNode1.networkManager.incomingPeers.find(
      (peer: NetworkPeerIf) => peer.id.equals(sender.networkManager.id)
    ) as NetworkPeer;
    expect(ret.fullNode1ToSender).toBeInstanceOf(NetworkPeer);

    return ret;
  }

  shutdown(): Promise<void> {
    return Promise.all([
      this.sender.shutdown(),
      this.fullNode1.shutdown(),
      this.fullNode2.shutdown(),
      this.recipient.shutdown(),
    ]) as unknown as Promise<void>;
  }
}
