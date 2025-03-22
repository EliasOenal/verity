import type { NetworkManagerOptions } from "../networkManagerIf";

import { NetworkTransport } from "../transport/networkTransport";
import { DummyTransportServer } from "./dummyTransportServer";

export class DummyNetworkTransport extends NetworkTransport {
  constructor(
      params?: any,  // TODO fix or document any type
      options: NetworkManagerOptions = {},
  ) {
    super(params, options);
    this._servers.push(new DummyTransportServer(this));
  }
}
