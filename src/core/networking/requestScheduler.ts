import { Settings } from '../settings';
import { logger } from '../logger';
import { NetConstants } from './networkDefinitions';
import type { CubeKey } from '../cube/cubeDefinitions';
import type { CubeInfo } from '../cube/cubeInfo';
import type { NetworkManager } from './networkManager';
import type { NetworkPeer } from './networkPeer';

import { Buffer } from 'buffer';  // for browsers

// TODO: only schedule next request after previous request has been *fulfilled*,
// or after a sensible timeout

export interface RequestSchedulerOptions {
  lightNode?: boolean;
  requestStrategy?: RequestStrategy;
  requestInterval?: number;
  requestScaleFactor?: number;
  requestTimeout?: number;
}

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

  constructor(
    readonly key: CubeKey,
    timeout = Settings.CUBE_REQUEST_TIMEOUT,
  ) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.timeout = setTimeout(() => this.reject(undefined), timeout);
  }

  fulfilled(cubeInfo: CubeInfo): void {
    clearTimeout(this.timeout);
    this.resolve(cubeInfo);
  }

  shutdown(): void {
    clearTimeout(this.timeout);
  }
}

/**
 * RequestStrategies determine which connected node we'll ask whenever we
 * request a Cube, whether it is because a local application has requested it
 * or whether we're a full node and just try to get our hands on every single
 * Cube out there.
 */
abstract class RequestStrategy {
  select(available: NetworkPeer[]): NetworkPeer {
    return undefined;
  }
}
/**
 * What does it sound like? We'll just ask any connected node, potentially
 * several times in a row if luck has it.
 * This is the most basic and probably least useful strategy.
 **/
class RandomStrategy extends RequestStrategy {
  select(available: NetworkPeer[]): NetworkPeer {
    const index = Math.floor(Math.random()*available.length);
    return available[index];
  }
}



/**
 * Queries our connected peers for Cubes, depending on the configuration and
 * on local application's requests.
 */
export class RequestScheduler {
  /**
   * If true, will only fetch explicitly requested Cubes.
   * (Note: This also means we will never send KeyRequests as we're not
   * interested in learning random available keys.)
   * If false, we're a full node and will try to fetch every single Cube out there.
   **/
  lightNode: boolean = true;

  private _requestStrategy: RequestStrategy;
  get requestStrategy(): RequestStrategy { return this._requestStrategy }

  requestInterval?: number;
  requestScaleFactor?: number;
  requestTimeout?: number;

  private requestedCubes: Map<string, RequestedCube> = new Map();
  private currentTimer: NodeJS.Timeout = undefined;

  constructor(
    readonly networkManager: NetworkManager,
    options?: RequestSchedulerOptions
  ){
    // set options
    this.lightNode = options?.lightNode ?? true;
    this.requestStrategy = options.requestStrategy ?? new RandomStrategy();
    this.requestInterval = options?.requestInterval ?? Settings.KEY_REQUEST_TIME;
    this.requestScaleFactor = options?.requestScaleFactor ?? Settings.REQUEST_SCALE_FACTOR;
    this.requestTimeout = options?.requestTimeout ?? Settings.CUBE_REQUEST_TIMEOUT;

    this.networkManager.cubeStore.on("cubeAdded", (cubeInfo: CubeInfo) =>
      this.cubeAddedHandler(cubeInfo));
  }

  requestCube(
    key: CubeKey,
    timeout: number = this.requestTimeout
  ): Promise<CubeInfo> {
    const req = new RequestedCube(key, timeout);  // create request
    this.requestedCubes.set(key.toString('hex'), req);  // remember request
    this.scheduleNextRequest(0);  // schedule request
    return req.promise;  // return result eventually
  }

  set requestStrategy(newStrat: RequestStrategy) {
    this._requestStrategy = newStrat;
  };

  /** @returns true if request scheduled, false if not scheduled
   *           (which happens when there already is a request scheduled)
   */
  scheduleNextRequest(millis: number = undefined): boolean {
    if (this.currentTimer !== undefined) {
      logger.trace(`RequestScheduler.scheduleNextRequest(): ignoring call as there is already a request scheduled`);
      return false;
    }
    if (millis === undefined) {
      millis = this.requestInterval * this.calcRequestScaleFactor();
    }
    logger.trace(`RequestScheduler.scheduleNextRequest(): scheduling next request in ${millis} ms`);
    this.currentTimer = setTimeout(() => this.performRequest(), millis);
    return true;
  }

  private clearScheduledRequest(): void {
    clearTimeout(this.currentTimer);
    this.currentTimer = undefined;
  }

  private calcRequestScaleFactor(): number {
    const conn = this.networkManager.connectedPeerCount;
    const max = this.networkManager.maximumConnections;
    const notConn = (max-1)-(conn-1);

    const base = 1/this.requestScaleFactor;
    const step = (1-base) / (max-1);

    return base + notConn*step;
  }

  private performRequest(): void {
    // cancel timer calling this exact function
    this.clearScheduledRequest();
    // is there even anything left to request?
    if (this.lightNode && this.requestedCubes.size === 0) {
      logger.trace(`RequestScheduler.performRequest(): doing nothing, we're a light node and there are no open requests`);
      return;  // nothing to do
    }
    // select a peer to send request to
    const peerSelected: NetworkPeer =
      this.requestStrategy.select(this.networkManager.connectedPeers);
    if (peerSelected !== undefined) {
      if (this.lightNode) {
        // request all Cubes that we're looking for, up the the maximum allowed
        const keys: CubeKey[] = [];
        for (const [keystring, req] of this.requestedCubes) {
          if (keys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
          if (!req.requestRunning) keys.push(req.key);
        }
        logger.trace(`RequestScheduler.performRequest(): requesting ${keys.length} Cubes from ${peerSelected.toString()}`);
        peerSelected.sendCubeRequest(keys);
        // Note: The cube response will currently still be directly handled by the
        // NetworkPeer. This should instead also be controlled by the RequestScheduler.
      } else {
        logger.trace(`RequestScheduler.performRequest(): sending KeyRequest to ${peerSelected.toString()}`);
        // if we're a full node, send a key request
        peerSelected.sendKeyRequest();
        // Note / TODO: For full nodes, the key response will currently still be directly
        // handled by the NetworkPeer. This should instead also be controlled
        // by the RequestScheduler.
      }
    } else {
      logger.info("RequestScheduler.performRequest(): No matching peer to run request, scheduling next try.")
    }
    // schedule next request
    this.scheduleNextRequest();
  }

  requestCubes(keys: CubeKey[]): Promise<CubeInfo>[];
  requestCubes(keys: CubeInfo[]): Promise<CubeInfo>[];
  requestCubes(keys: Array<CubeKey | CubeInfo>): Promise<CubeInfo>[];
  requestCubes(
    requests: Array<CubeKey | CubeInfo>):
  Promise<CubeInfo> | Promise<CubeInfo>[] {
    const promises: Promise<CubeInfo>[] = [];
    for (const req of requests) {
      promises.push(this.requestCube(req as CubeKey));  // or as CubeInfo, don't care
    }
    return promises;
  }

  cubeAddedHandler(cubeInfo: CubeInfo) {
    // does this fulfil a request?
    const req = this.requestedCubes.get(cubeInfo.keyString);
    if (req) {
      req.fulfilled(cubeInfo);
      this.requestedCubes.delete(cubeInfo.keyString);
    }
  }

  shutdown(): void {
    this.clearScheduledRequest();
    this.networkManager.cubeStore.removeListener("cubeAdded", (cubeInfo: CubeInfo) =>
      this.cubeAddedHandler(cubeInfo));
    for (const [key, req] of this.requestedCubes) req.shutdown();
  }
}
