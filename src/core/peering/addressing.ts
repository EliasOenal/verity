import { SupportedTransports, AddressError } from "../networking/networkDefinitions";
import { logger } from "../logger";

import { Multiaddr, multiaddr } from '@multiformats/multiaddr'

export class AddressAbstraction {
  public addr: WebSocketAddress | Multiaddr;
  public type: SupportedTransports;

  static CreateAddress(address: string, type?: SupportedTransports): AddressAbstraction {
      if (!address?.length) return undefined;
      if (!type) {
          // guess type
          if (address[0] == '/') type = SupportedTransports.libp2p;
          else type = SupportedTransports.ws;
      }
      if (!address.length) return undefined;
      if (type == SupportedTransports.ws) {
          return new AddressAbstraction(new WebSocketAddress(address));
      } else if (type == SupportedTransports.libp2p) {
          return new AddressAbstraction(multiaddr(address));
      }
      else { // invalid
          return undefined;
      }
  }

  constructor(
      addr: WebSocketAddress | Multiaddr | AddressAbstraction | string,
      typeHint?: SupportedTransports
  ) {
      if (!addr) {
          throw new AddressError("AddressAbstraction.constructor: Cannot construct abstraction around falsy address: " + addr);
      } else if (addr instanceof AddressAbstraction) {
          this.type = addr.type;
          this.addr = addr.addr;
      } else if (typeof addr === 'string' || addr instanceof String) {
          const tmpAddr: AddressAbstraction = AddressAbstraction.CreateAddress(
            addr as string, typeHint);
          this.addr = tmpAddr.addr;
          this.type = tmpAddr.type;
      } else if (addr instanceof WebSocketAddress) {
          this.addr = addr;
          this.type = SupportedTransports.ws;
      } else if ('getPeerId' in addr) {  // "addr typeof Multiaddr"
          this.addr = addr;
          this.type = SupportedTransports.libp2p;
      } else {
          throw new AddressError("AddressAbstraction.constructor: Cannot construct abstraction around unknown address type: " + addr);
      }
      if (!this.addr) {
          throw new AddressError(
              "AddressAbstraction.constructor: Cannot construct abstraction around invalid address " + addr);
      }
  }

  equals(other: AddressAbstraction) {
      if (this.addr.constructor.name != other.addr.constructor.name ) {
          return false;  // not of same type
      }
      // @ts-ignore It's fine... both sides are either WebSocketAddress or Multiaddr, and they compare well with each other
      else return this.addr.equals(other.addr);
  }

  get ip(): string {
      try {
          if (this.addr instanceof WebSocketAddress) return this.addr.address;
          else return this.addr.nodeAddress().address;
      } catch(error) {
          logger.error("AddressAbstraction.ip: Error getting address: " + error);
          return undefined;
      }
  }

  get port(): number {
      try {
          if (this.addr instanceof WebSocketAddress) return this.addr.port;
          else return this.addr.nodeAddress().port;
      } catch(error) {
          logger.error("AddressAbstraction.port: Error getting address: " + error);
          return undefined;
      }
  }

  toString(): string {
      try {
          return this.addr.toString();
      } catch(error) {
          logger.error("AddressAbstraction.toString(): Error printing address: " + error);
          return undefined;
      }
  }
}

/**
* Address notation used for native/legacy WebSocket connections,
* in contrast to libp2p connections and their multiaddrs.
*/
// TODO: get rid of this crap and just use Multiaddr
export class WebSocketAddress {
  // There is a point to be made to use IPv6 notation for all IPs
  // however for now this serves the purpose of being able to
  // prevent connecting to the same peer twice
  static convertIPv6toIPv4(ip: string): string {
      if ( ip.startsWith('::ffff:') ) {
          return ip.replace('::ffff:', '');
      }
      return ip;
  }

  public address: string;  // could be IPv4, IPv6 or even a DNS name
  public port: number;

  constructor(address: string, port: number);
  constructor(url: string);

  constructor(
      address: string,  // could be IPv4, IPv6 or even a DNS name
      port?: number
  ){
    if (port === undefined) {  // address is url
      // HACKHACK: handle special case: ":::<port>" denotes any address
      if (address.startsWith(":::")) address = "ws://" + "0.0.0.0:" + address.substring(3);
      else if (!(address.includes('//'))) address = "ws://" + address;
      const url = new URL(address);
      this.address = url.hostname;
      this.port = Number.parseInt(url.port);
    } else {  // separate address and port provided
        this.address = address;
        this.port = port;
    }
  }

  equals(other: WebSocketAddress): boolean {
      return (this.address === other.address && this.port === other.port);
  }

  toString(wsPrefix: boolean = false): string {
      let str = "";
      if (wsPrefix) str += "ws://";
      str += this.address + ":" + this.port;
      return str;
  }
}
