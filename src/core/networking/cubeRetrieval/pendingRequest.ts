import { CubeInfo } from "../../cube/cubeInfo";
import { Settings } from "../../settings";
import { SubscriptionConfirmationMessage } from "../networkMessage";
import { NetworkPeerIf } from "../networkPeerIf";

/**
 * Internal data structure representing a local application's network request,
 * e.g. for a Cube.
 * Contains a promise and its associated resolve and reject functions
 * so we can let the application know when their request has been fulfilled
 * (or is not fulfillable).
 **/
export class PendingRequest<Value, SupplementalData> {
  public promise: Promise<Value>;
  private _settled: boolean = false;
  get settled(): boolean { return this._settled; }
  private _value: Value = undefined;
  get value(): Value { return this._value; }

  private timeout: NodeJS.Timeout = undefined;
  private promiseResolve: (value?: Value | PromiseLike<Value>) => void;

  /**
   * @param timeout A retrieval timeout in milliseconds after which the
   *        retrieval promise will resolve to undefined, or 0 for no timeout.
   * @param sup Supplemental data to be stored with this request
   */
  constructor(
    timeout = Settings.CUBE_REQUEST_TIMEOUT,
    readonly sup?: SupplementalData,
  ) {
    this.promise = new Promise((resolve) => {
      this.promiseResolve = resolve;
    });
    if (timeout > 0) {
      this.timeout = setTimeout(() => {
        this.resolve(undefined);
      }, timeout);
    }
  }

  fulfilled(data: Value): void {
    this.resolve(data);
  }

  shutdown(): void {
    this.resolve(undefined);
  }

  private resolve(value: Value): void {
    clearTimeout(this.timeout);
    this.promiseResolve(value);
    this._settled = true;
    this._value = value;
  }
}

export interface CubeRequestSupplemental {
  key: Buffer,

  currentTry?: number,
  maxTries?: number,
}


export class CubeRequest extends PendingRequest<CubeInfo, CubeRequestSupplemental> {
  /**
   * Indicates whether we have sent out a network request for this request
   * and are currently awaiting a peer response.
   */
  currentTry: NetworkRequestMonitor;

  nextTry: NetworkRequestMonitor;
  lastTry: NetworkRequestMonitor;

  constructor(
    timeout = Settings.CUBE_REQUEST_TIMEOUT,
    readonly sup?: CubeRequestSupplemental,
  ) {
    super(timeout, sup);
    this.currentTry = undefined;
    this.lastTry = undefined;
    this.nextTry = new NetworkRequestMonitor();
  }

  fulfilled(data: CubeInfo): void {
    this.currentTry?.terminated();
    super.fulfilled(data);
  }

  /**
   * @returns A promise that resolves once the request has timed out
   */
  requestSent(peer: NetworkPeerIf): Promise<void> {
    this.lastTry = this.currentTry;
    this.currentTry = this.nextTry;
    this.nextTry = new NetworkRequestMonitor();

    this.currentTry.requestSent(peer);
    return this.currentTry.settledPromise;
  }

  get networkRequestRunning(): boolean {
    if (this.currentTry === undefined) return false;
    if (this.currentTry.settled) return false;
    return true;
  }
}


export class NetworkRequestMonitor {
  private _peer: NetworkPeerIf = undefined;

  get peer(): NetworkPeerIf | undefined {
    return this._peer;
  }

  private settledPromiseResolve: (value?: void | PromiseLike<void>) => void;
  private _settledPromise: Promise<void> = new Promise(
    resolve => this.settledPromiseResolve = resolve);
  get settledPromise(): Promise<void> { return this._settledPromise }

  private _timedOut: boolean = false;
  get timedOut(): boolean { return this._timedOut }

  private _settled: boolean = false;
  get settled(): boolean { return this._settled }

  private networkRequestTimeout: NodeJS.Timeout = undefined;

  requestSent(peer: NetworkPeerIf): void {
    this._peer = peer;
    this.networkRequestTimeout = setTimeout(() => {
      this._settled = true;
      this._timedOut = true;
      this.settledPromiseResolve();
    }, this.peer.options.networkTimeoutMillis);
  }

  terminated(): void {
    clearTimeout(this.networkRequestTimeout);
    this._settled = true;
    this._timedOut = false;
    this.settledPromiseResolve();
  }
}

export interface SubscriptionRequestSupplemental {
  key: Buffer,
  currentTry?: number,
  maxTries?: number,
}
export class SubscriptionRequest extends PendingRequest<SubscriptionConfirmationMessage, SubscriptionRequestSupplemental> {}
