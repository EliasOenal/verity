import { Settings } from '../../settings';
import { NetConstants } from '../networkDefinitions';
import { KeyRequestMode } from '../networkMessage';

import { RequestStrategy, RandomStrategy } from './requestStrategy';
import { RequestedCube } from './requestedCube';

import { ShortenableTimeout } from '../../helpers/shortenableTimeout';
import type { CubeKey } from '../../cube/cube.definitions';
import type { CubeInfo } from '../../cube/cubeInfo';
import { keyVariants } from '../../cube/cubeUtil';
import type { NetworkManager, NetworkManagerIf } from '../networkManager';
import type { NetworkPeer } from '../networkPeer';

import { logger } from '../../logger';

import { Buffer } from 'buffer';  // for browsers

// TODO: only schedule next request after previous request has been *fulfilled*,
// or after a sensible timeout

// TODO: Add option to fire a request immediately, within reasonable limits.
// This is required for interactive applications to perform reasonably on
// light nodes.

export interface RequestSchedulerOptions {
  /**
   * If true, will only fetch explicitly requested Cubes.
   * (Note: This also means we will never send KeyRequests as we're not
   * interested in learning random available keys.)
   * If false, we're a full node and will try to fetch every single Cube out there.
   **/
  lightNode?: boolean;

  requestStrategy?: RequestStrategy;
  requestInterval?: number;
  requestScaleFactor?: number;
  requestTimeout?: number;
  interactiveRequestDelay?: number;
}

/**
 * Queries our connected peers for Cubes, depending on the configuration and
 * on local application's requests.
 */
export class RequestScheduler {
  private requestedCubes: Map<string, RequestedCube> = new Map();
  private subscribedCubes: CubeKey[] = [];
  private timer: ShortenableTimeout = new ShortenableTimeout(this.performRequest, this);

  constructor(
    readonly networkManager: NetworkManagerIf,
    readonly options: RequestSchedulerOptions = {},
  ){
    // set options
    options.lightNode = options?.lightNode ?? true;
    options.requestStrategy = options.requestStrategy ?? new RandomStrategy();
    options.requestInterval = options?.requestInterval ?? Settings.KEY_REQUEST_TIME;
    options.requestScaleFactor = options?.requestScaleFactor ?? Settings.REQUEST_SCALE_FACTOR;
    options.requestTimeout = options?.requestTimeout ?? Settings.CUBE_REQUEST_TIMEOUT;
    options.interactiveRequestDelay = options?.interactiveRequestDelay ?? Settings.INTERACTIVE_REQUEST_DELAY;

    this.networkManager.cubeStore.on("cubeAdded", (cubeInfo: CubeInfo) =>
      this.cubeAddedHandler(cubeInfo));
  }

  requestCube(
    keyInput: CubeKey | string,
    scheduleIn: number = this.options.interactiveRequestDelay,
    timeout: number = this.options.requestTimeout
  ): Promise<CubeInfo> {
    const key = keyVariants(keyInput);
    const req = new RequestedCube(key.binaryKey, timeout);  // create request
    this.requestedCubes.set(key.keyString, req);  // remember request
    this.scheduleNextRequest(scheduleIn);  // schedule request
    return req.promise;  // return result eventually
  }

  /**
   * Subscribe to a Cube, ensuring you will receive any an all remote updates.
   * This obviously only makes sense for mutable Cubes, i.e. MUCs.
   **/
  // Note: We don't have any actual notion of subscriptions on the core network
  // layer yet. What this currently does is just re-request the same Cube over
  // and over again, which is obviously stupid.
  subscribeCube(
      keyInput: CubeKey | string,
      scheduleIn: number = this.options.interactiveRequestDelay,
  ): void {
    if (this.options.lightNode) {  // full nodes are implicitly subscribed to everything
      const key = keyVariants(keyInput);
      if (this.subscribedCubes.some(subbedKey => subbedKey.equals(key.binaryKey))) {
        return;  // already subscribed, nothing to do here
      }
      this.subscribedCubes.push(key.binaryKey);
      this.scheduleNextRequest(scheduleIn);  // schedule request
    }
  }


  /** @returns true if request scheduled, false if not scheduled
   *           (which happens when there already is a request scheduled)
   */
  scheduleNextRequest(millis: number = undefined): boolean {
    if (millis === undefined) {
      millis = this.options.requestInterval * this.calcRequestScaleFactor();
    }
    logger.trace(`RequestScheduler.scheduleNextRequest(): scheduling next request in ${millis} ms`);
    this.timer.set(millis);
    return true;
  }

  private calcRequestScaleFactor(): number {
    const conn = this.networkManager.onlinePeerCount;
    const max = this.networkManager.options.maximumConnections;
    const notConn = (max-1)-(conn-1);

    const base = 1/this.options.requestScaleFactor;
    const step = (1-base) / (max-1);

    return base + notConn*step;
  }

  private performRequest(): void {
    // cancel timer calling this exact function
    this.timer.clear();
    // is there even anything left to request?
    if (this.options.lightNode &&
        this.requestedCubes.size === 0 && this.subscribedCubes.length === 0) {
      logger.trace(`RequestScheduler.performRequest(): doing nothing, we're a light node and there are no open requests`);
      return;  // nothing to do
    }
    // select a peer to send request to
    const peerSelected: NetworkPeer =
      this.options.requestStrategy.select(this.networkManager.onlinePeers);
    if (peerSelected !== undefined) {
      if (this.options.lightNode) {
        // request all Cubes that we're looking for, up the the maximum allowed
        const keys: CubeKey[] = [];
        for (const [keystring, req] of this.requestedCubes) {
          if (keys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
          if (!req.requestRunning) keys.push(req.key);
        }
        for (const key of this.subscribedCubes) {
          if (keys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
          // Note: This is COMPLETELY INEFFICIENT BULLSHIT!
          // It means we're requesting the exact same Cube over and over again.
          // We need to implement a proper subscription mechanism at the core
          // networking layer.
          keys.push(key);
        }
        logger.trace(`RequestScheduler.performRequest(): requesting ${keys.length} Cubes from ${peerSelected.toString()}`);
        peerSelected.sendCubeRequest(keys);
        // Note: The cube response will currently still be directly handled by the
        // NetworkPeer. This should instead also be controlled by the RequestScheduler.
      } else {
        logger.trace(`RequestScheduler.performRequest(): sending KeyRequest to ${peerSelected.toString()}`);
        // if we're a full node, send a key request
        peerSelected.sendKeyRequests();
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
    this.timer.clear();
    this.networkManager.cubeStore.removeListener("cubeAdded", (cubeInfo: CubeInfo) =>
      this.cubeAddedHandler(cubeInfo));
    for (const [key, req] of this.requestedCubes) req.shutdown();
  }
}
