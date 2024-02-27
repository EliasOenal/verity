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
  private lastSuccessfulTransmission: number = unixtime();
  private errorCount: number = 0;

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

  close(): Promise<void> {
    throw new VerityError("NetworkPeerConnection.close() to be implemented by subclass")
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
    this.lastSuccessfulTransmission = unixtime();
    this.errorCount = 0;
  }

  protected transmissionError() {
    this.errorCount++;
    // is it time to give up and close this connection?
    if (this.errorCount >= this.disconnectErrorCount &&
        this.lastSuccessfulTransmission < unixtime() - this.disconnectErrorTime) {
      logger.info(`${this.toString()}: Got ${this.errorCount} errors over ${unixtime() - this.lastSuccessfulTransmission} seconds, closing.`)
      this.close();
    }
  }

  get address(): AddressAbstraction { return this._address }
  get addressString(): string  {
    return this.address.toString();
  }

  // To be overridden by subclass
  get open(): boolean { return false; }
}
