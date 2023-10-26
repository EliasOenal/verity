import { AddressError, SupportedTransports } from "./networkDefinitions";
import { Libp2pTransport } from "./libp2p/libp2pTransport";
import { NetworkManager, NetworkManagerOptions } from "./networkManager";
import { TransportParamMap, TransportMap } from "./networkTransport";
import { WebSocketTransport } from "./webSocket/webSocketTransport";
import { Libp2pPeerConnection } from "./libp2p/libp2pPeerConnection";
import { WebSocketPeerConnection } from "./webSocket/webSocketPeerConnection";

import { AddressAbstraction, WebSocketAddress } from "../peering/addressing";

import { logger } from "../logger";

// Putting this stuff in a separate module rather than using static methods
// to avoid circular dependencies

export function createNetworkTransport(
  networkManager: NetworkManager,
  params: TransportParamMap,
  options: NetworkManagerOptions = {}
): TransportMap {
const transports: TransportMap = new Map();
for (const [type, param] of params.entries()) {
  // try {
    if (type == SupportedTransports.ws) {
      transports.set(SupportedTransports.ws,
        new WebSocketTransport(networkManager, param, options));
    }
    if (type == SupportedTransports.libp2p) {
      transports.set(SupportedTransports.libp2p,
        new Libp2pTransport(networkManager, param, options));
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
      return new WebSocketPeerConnection(address.addr)
  } else if ('getPeerId' in address.addr) {  // "addr instanceof Multiaddr"
      if (!transports.has(SupportedTransports.libp2p)) {
        throw new AddressError("To create a libp2p connection the libp2p node object must be supplied and ready.");
      }
      return new Libp2pPeerConnection(
        address.addr,
        transports.get(SupportedTransports.libp2p) as Libp2pTransport);
  }
  else {
      throw new AddressError("NetworkPeerConnection.Create: Unsupported address type");
  }
}
