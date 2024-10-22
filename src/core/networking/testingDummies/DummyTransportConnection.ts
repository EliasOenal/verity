import { AddressAbstraction, WebSocketAddress } from "../../peering/addressing";
import { SupportedTransports } from "../networkDefinitions";
import { TransportConnection } from "../transport/transportConnection";

export class DummyTransportConnection extends TransportConnection {
  sentMessage: Buffer[] = [];

  constructor(address: AddressAbstraction = new AddressAbstraction(new WebSocketAddress("127.0.0.1", 0))) {
    super(address, undefined);
  }

  ready(): boolean { return true; }
  close(): Promise<void> { return Promise.resolve(); }
  type(): SupportedTransports { return SupportedTransports.dummy; }
  toString(): string { return "dummy transport connection" }

  send(message: Buffer): void { this.sentMessage.push(message) }
}
