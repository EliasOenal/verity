import type { NetworkManagerOptions } from "../networkManagerIf";
import type { SupportedTransports } from "../networkDefinitions";
import type { TransportServer } from "./transportServer";
import type { AddressAbstraction } from "../../peering/addressing";

import { Settings } from "../../settings";

import EventEmitter from "events";

export type TransportMap = Map<SupportedTransports, NetworkTransport>;
export type TransportParamMap = Map<SupportedTransports, any>;

interface NetworkTransportEventMap extends Record<string, any[]> {
  serverAddress: [AddressAbstraction];
}

/**
 * Abstract base class representing a certain form of network transport, e.g.
 * using native WebSockets or libp2p.
 * A transport object is required for every form of transport provided by a
 * Verity node, no matter if it provides any server functionality (= listerners)
 * using this transport.
 * This object exists because certain forms of transport (notably, libp2p)
 * require holding common state even for plainly incoming connectivity.
 * For most forms of transport which do not (e.g. WebSocketTransport), their
 * NetworkTransport subclass object will be more or less empty.
 */
export abstract class NetworkTransport extends EventEmitter<NetworkTransportEventMap> {
  /**
   * Stores all of this transport's TransportServer subclass objects
   * which listen for incoming connections. You could also call them listeners.
   * For non-listening nodes, servers will be empty.
   */
  protected _servers: TransportServer[] = [];
  get servers() { return this._servers }

  dialableAddress: AddressAbstraction = undefined;

  constructor(
      params?: any,  // TODO fix or document any type
      options: NetworkManagerOptions = {},
  ) {
    super();
    this.setMaxListeners(Settings.MAXIMUM_CONNECTIONS * 5);
  }

  /**
   * start() must always be called and awaited before using a transport.
   * NetworkManager will take care of this.
   */
  async start(): Promise<void> {
    // to be overwritten or extended by subclass if required
    const promises: Promise<void>[] = [];
    for (const server of this._servers) {
      promises.push(server.start());
    }
    return Promise.all(promises) as unknown as Promise<void>;
  }

  shutdown(): Promise<void> {
    // to be overwritten or extended by subclasses as needed
    const promises: Promise<void>[] = [];
    for (const server of this._servers) {
      promises.push(server.shutdown());
    }
    return Promise.all(promises) as unknown as Promise<void>;
  }
}
