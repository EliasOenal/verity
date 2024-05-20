import { VerityError } from "../../../settings";
import { NetworkManager, NetworkManagerOptions } from "../../networkManager";
import { NetworkTransport } from "../networkTransport";
import { WebSocketServer } from "./webSocketServer";

import { isNode } from "browser-or-node";

export class WebSocketTransport extends NetworkTransport {
  constructor(
      params?: any,  // TODO fix or document any type
      options: NetworkManagerOptions = {}
) {
    super();
    if (params) {  // server mode requested
      if (isNode) {
          if (!Array.isArray(params)) params = [params];
          for (const param of params) {
            if (!isNaN(param)) {
              this._servers.push(new WebSocketServer(this, param, options));
            } else {
              throw new VerityError("Cannot create WebSocketServer: param type should be a port number, but I got " + param);
            }
          }
      } else {
        throw new VerityError("Cannot create WebSocketServer: only supported on NodeJS.");
      }
    } else {
      // No need to initialize anything for client-only mode.
      // WebSockets are straightforward :)
    }
  }

  toString(): string {
    return "Transport around " + this._servers[0].toString();
  }
  toLongString(): string {
    return "Transport around " + this._servers[0].toLongString();
  }
}
