import { Settings, VerityError } from "../../settings";
import { AddressError, SupportedTransports } from "../networkDefinitions";

import EventEmitter from "events";
import { Buffer } from 'buffer';
import { AddressAbstraction } from "../../peering/addressing";
import { unixtime } from "../../helpers";
import { logger } from "../../logger";

export interface TransportConnectionOptions {
  disconnectErrorCount?: number,
  disconnectErrorTime?: number,
};

/**
 * Represents the actual networking component of a NetworkPeer,
 * i.e. the part that actually opens and closes network connections;
 * sends and received messages.
 * @emits "ready" when connection is... you know... ready
 */
export abstract class TransportConnection extends EventEmitter {
  readonly disconnectErrorCount: number = undefined;
  readonly disconnectErrorTime: number = undefined;
  private _lastSuccessfulTransmission: number = unixtime();
  get lastSuccessfulTransmission(): number { return this._lastSuccessfulTransmission }
  private _errorCount: number = 0;
  get errorCount(): number { return this._errorCount }

  constructor(
      private _address: AddressAbstraction,
      options?: TransportConnectionOptions,
  ){
    super();
    // set options
    this.disconnectErrorCount = options?.disconnectErrorCount ?? Settings.DISCONNECT_ERROR_COUNT;
    this.disconnectErrorTime = options?.disconnectErrorTime ?? Settings.DISCONNECT_ERROR_TIME;
  }

  /** Will resolve once this connection has been opened and is ready for business */
  readyPromise: Promise<void> = new Promise<void>(resolve => this.once('ready', resolve));

  // Should be overridded by subclass and then optionally called as super.close()
  close(): Promise<void> {
    // It would usually be wise for our subclases to call this before closing
    // the actual connection. This way, we send the closed signal first
    // (i.e. let the NetworkPeer closed handler run first)
    // so nobody tries to send any further messages to our closing socket
    logger.trace(`${this.toString()}: closing`);
    this.emit("closed");
    this.removeAllListeners();
    return new Promise<void>(resolve => resolve());
  }

  ready(): boolean {
    throw new VerityError("NetworkPeerConnection.ready() to be implemented by subclass")
  }
  send(message: Buffer): void {
    throw new VerityError("NetworkPeerConnection.send() to be implemented by subclass")
  }
  type(): SupportedTransports {
    throw new VerityError("NetworkPeerConnection.type() to be implemented by subclass")
  }
  toString(): string {
    throw new VerityError("NetworkPeerConnection.toString() to be implemented by subclass")
  }

  protected transmissionSuccessful() {
    this._lastSuccessfulTransmission = unixtime();
    this._errorCount = 0;
    this.emit("transmissionLogged");
  }

  protected transmissionError() {
    this._errorCount++;
    // is it time to give up and close this connection?
    if (this._errorCount >= this.disconnectErrorCount &&
        this._lastSuccessfulTransmission < unixtime() - this.disconnectErrorTime) {
      logger.info(`${this.toString()}: Got ${this._errorCount} errors over ${unixtime() - this._lastSuccessfulTransmission} seconds, closing.`)
      this.close();
    } else {
      this.emit("transmissionLogged");
    }
  }

  get address(): AddressAbstraction { return this._address }
  get addressString(): string  {
    return this.address.toString();
  }

  // To be overridden by subclass
  get open(): boolean { return false; }
}
