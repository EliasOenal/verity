import { Settings } from "../../settings";

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
