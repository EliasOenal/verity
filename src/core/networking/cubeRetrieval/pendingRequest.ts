import { Settings } from "../../settings";

/**
 * Internal data structure representing a local application's network request,
 * e.g. for a Cube.
 * Contains a promise and its associated resolve and reject functions
 * so we can let the application know when their request has been fulfilled
 * (or is not fulfillable).
 **/
export class PendingRequest<Value, SupplementalData> {
  public requestRunning = false;
  public promise: Promise<Value>;

  private timeout: NodeJS.Timeout = undefined;
  private resolve: (value?: Value | PromiseLike<Value>) => void;

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
      this.resolve = resolve;
    });
    if (timeout > 0) {
      this.timeout = setTimeout(() => {
        this.resolve(undefined);
      }, timeout);
    }
  }

  fulfilled(data: Value): void {
    clearTimeout(this.timeout);
    this.resolve(data);
  }

  shutdown(): void {
    clearTimeout(this.timeout);
    this.resolve(undefined);  // Optionally reject here to allow the caller to handle the cancellation
  }
}
