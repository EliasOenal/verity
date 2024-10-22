import { AddressAbstraction, WebSocketAddress } from "../../peering/addressing";
import { TransportConnection } from "../transport/transportConnection";

export class DummyTransportConnection extends TransportConnection {
  constructor(address: AddressAbstraction = new AddressAbstraction(new WebSocketAddress("127.0.0.1", 0))) {
    super(address, undefined);
  }
}
