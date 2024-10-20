import { AddressError, SupportedTransports } from "../networkDefinitions";
import { Libp2pTransport } from "./libp2p/libp2pTransport";
import { NetworkManager } from "../networkManager";
import { NetworkManagerOptions } from '../networkManagerIf';
import { TransportParamMap, TransportMap } from "./networkTransport";
import { WebSocketTransport } from "./webSocket/webSocketTransport";
import { Libp2pConnection } from "./libp2p/libp2pConnection";
import { WebSocketConnection } from "./webSocket/webSocketConnection";

import { AddressAbstraction, WebSocketAddress } from "../../peering/addressing";

import { logger } from "../../logger";

// Putting this stuff in a separate module rather than using static methods
// to avoid circular dependencies

export function createNetworkTransport(
  params: TransportParamMap = new Map(),
  options: NetworkManagerOptions = {}
): TransportMap {
const transports: TransportMap = new Map();
for (const [type, param] of params.entries()) {
  // try {
    if (type == SupportedTransports.ws) {
      transports.set(SupportedTransports.ws,
        new WebSocketTransport(param, options));
    }
    if (type == SupportedTransports.libp2p) {
      transports.set(SupportedTransports.libp2p,
        new Libp2pTransport(param, options));
    }
  // } catch(error) {
  //   logger.error(error.message);
  // }
}
return transports;
}

// maybe TODO: refuse creating connections using transports not in transport map
// (as this usually means they were explicitly un-configured by the user).
// Currently, we only refuse for connections that actually need their
// transport object, i.e. libp2p.
export function createNetworkPeerConnection(address: AddressAbstraction, transports: TransportMap) {
  if (address.addr instanceof WebSocketAddress) {
      return new WebSocketConnection(address.addr)
  } else if ('getPeerId' in address.addr) {  // "addr instanceof Multiaddr"
      if (!transports.has(SupportedTransports.libp2p)) {
        throw new AddressError("To create a libp2p connection the libp2p node object must be supplied and ready.");
      }
      return new Libp2pConnection(
        address.addr,
        transports.get(SupportedTransports.libp2p) as Libp2pTransport);
  }
  else {
      throw new AddressError("NetworkPeerConnection.Create: Unsupported address type");
  }
}
