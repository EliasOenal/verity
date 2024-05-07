import { Settings } from "../../settings";
import type { CubeKey } from "../../cube/cubeDefinitions";
import type { CubeInfo } from "../../cube/cubeInfo";

/**
 * Internal data structure representing a local application's request for a
 * Cube. Contains a promise and its associated resolve and reject functions
 * so we can let the application know when their request has been fulfilled
 * (or is not fulfillable).
 **/
export class RequestedCube {
  public requestRunning = false;
  public promise: Promise<CubeInfo>;

  private timeout: NodeJS.Timeout = undefined;
  private resolve: Function;
  private reject: Function;

  /**
   * @param key Which Cube to request
   * @param timeout A retrieval timeout in milliseconds after which the
   *        retrieval promise will reject, or 0 for no timeout.
   */
  constructor(
    readonly key: CubeKey,
    timeout = Settings.CUBE_REQUEST_TIMEOUT,
  ) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    if (timeout > 0) {
      this.timeout = setTimeout(() => this.reject(undefined), timeout);
    }
  }

  fulfilled(cubeInfo: CubeInfo): void {
    clearTimeout(this.timeout);
    this.resolve(cubeInfo);
  }

  shutdown(): void {
    clearTimeout(this.timeout);
  }
}
