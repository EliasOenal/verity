import { AddressAbstraction, WebSocketAddress } from "./addressing";
import { logger } from "../logger";

import { Multiaddr } from '@multiformats/multiaddr'

/**
 * Basic representation of a peer without session and networking information.
 * Once we connect to one of these peers, the basic Peer object gets replaced
 * by a NetworkPeer object (which inherits from Peer).
 */
export class Peer {
  /** The 16 byte node ID. We usually only learn this upon successfull HELLO exchange. */
  protected _id?: Buffer = undefined;
  get id(): Buffer { return this._id }
  get idString(): string { return this._id?.toString('hex') }

  /**
   * A peer can have multiple addresses, e.g. an IPv4 one, an IPv6 one
   * and one or multiple domain names.
   * Server-capable incoming peers always have at least two addresses:
   * one using the client port from which they connected to us and
   * one using their server port.
   */
  addresses: Array<AddressAbstraction> = [];
  /**
   * We arbitrarily define one address as primary, usually the first one we
   * learn. It's the one we connect to.
   * TODO: On incoming connections, capable nodes should expose their server
   * port. When they do, their server address should be marked as primary.
   * Will not implement this until we switch to WebRTC.
  */
  protected _primaryAddressIndex: number = undefined;
  get primaryAddressIndex(): number { return this._primaryAddressIndex }
  set primaryAddressIndex(val) { this._primaryAddressIndex = val }
  /** Shortcut to get the primary address object */
  get address() { return this.addresses[this._primaryAddressIndex]; }
  /** Shortcut to get the primary IP */
  get ip() { return this.addresses[this._primaryAddressIndex].ip; }
  /** Shortcut to get the primary port */
  get port() { return this.addresses[this._primaryAddressIndex].port; }

  /**
   * Unix timestamp showing when we last tried to initiate a connection to
   * this peer.
   * This is required to honor Settings.RECONNECT_INTERVAL.
   */
  lastConnectAttempt: number = 0;
  /**
   * Number of (unsuccessful) connection attempts.
   * Gets reset to 0 on successful connection.
   */
  connectionAttempts: number = 0;

  constructor(
          address: WebSocketAddress | Multiaddr | AddressAbstraction | AddressAbstraction[] | string,
          id?: Buffer) {
      if (address instanceof Array) this.addresses = address;
      else this.addresses = [new AddressAbstraction(address)];
      this._id = id;
      this._primaryAddressIndex = 0;
  }

  /** Two peers are equal if they either have the same ID or have a common address. */
  equals(other: Peer): boolean {
      const addressEquals: boolean = this.addresses.some(myaddress =>
          other.addresses.some(othersaddress => myaddress.equals(othersaddress)));
      if (addressEquals) return true;
      else if (this._id && other._id && this._id.equals(other._id)) return true;
      else return false;
  }

  /**
   * Leans a new address for this peer, if it's actually a new one.
   * @param [makePrimary=false] Mark the specified address as this node's new
   *   primary address (even if we knew it already).
   * @returns Whether the address was added, which is equivalent to whether it was new
   */
  addAddress(
          address: WebSocketAddress | Multiaddr | AddressAbstraction,
          makePrimary: boolean = false) {
      const abstracted = new AddressAbstraction(address);
      // is this address actually new?
      let alreadyExists: boolean = false;
      for (let i=0; i<this.addresses.length; i++) {
          if (abstracted.equals(this.addresses[i])) {
              alreadyExists = true;
              if (makePrimary) {
                  logger.trace(`Peer ${this.toString()}: Setting existing address ${this.addresses[i]} primary`);
                  this._primaryAddressIndex = i;
              }
          }
      }
      if (!alreadyExists){
          this.addresses.push(abstracted);
          if (makePrimary) {
              logger.trace(`Peer ${this.toString()}: Setting newly added address ${abstracted} primary`);
              this._primaryAddressIndex = this.addresses.length-1;
          }
      }
      return !alreadyExists;
  }

  /** Shortcut to get the primary address string */
  get addressString(): string { return this.address.toString(); }

  /** Print a string containing all of my addresses */
  get allAddressesString(): string {
      let ret: string = "";
      for (let i=0; i<this.addresses.length; i++) {
          ret += this.addresses[i].toString();
          if (i<this.addresses.length-1) ret += " | ";
      }
      return ret;
  }

  toString() {
      return `${this.addressString} (ID#${this._id?.toString('hex')})`;
  }
  toLongString() {
      let ret: string = "";
      ret += "Peer ID#" + this.idString;
      if (this.addresses.length) {
          ret += ", addresses:\n";
          for (let i=0; i<this.addresses.length; i++) {
              ret += ` ${i}) ${this.addresses[i].toString()}`;
              if (i == this._primaryAddressIndex) ret += " (primary)\n";
              else ret += '\n';
          }
      }
      return ret;
  }
}
