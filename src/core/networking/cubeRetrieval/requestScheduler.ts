import { Settings } from '../../settings';
import { NetConstants } from '../networkDefinitions';
import { KeyRequestMode } from '../networkMessage';

import { RequestStrategy, RandomStrategy } from './requestStrategy';
import { RequestedCube } from './requestedCube';

import { ShortenableTimeout } from '../../helpers/shortenableTimeout';
import { CubeFieldType, type CubeKey } from '../../cube/cube.definitions';
import { CubeInfo } from '../../cube/cubeInfo';
import { cubeContest, getCurrentEpoch, keyVariants, shouldRetainCube } from '../../cube/cubeUtil';
import type { NetworkManager, NetworkManagerIf } from '../networkManager';
import type { NetworkPeer } from '../networkPeer';

import { logger } from '../../logger';

import { Buffer } from 'buffer';  // for browsers

// TODO: only schedule next request after previous request has been *fulfilled*,
// or after a sensible timeout

// TODO: Add option to fire a request immediately, within reasonable limits.
// This is required for interactive applications to perform reasonably on
// light nodes.

// TODO: non-fulfilled requests must be rescheduled while within timeout

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
  private requestedNotifications: Map<string, RequestedCube> = new Map();
  private subscribedCubes: CubeKey[] = [];  // TODO use same format as for requestedCubes
  private cubeRequestTimer: ShortenableTimeout = new ShortenableTimeout(this.performCubeRequest, this);
  private keyRequestTimer: ShortenableTimeout = new ShortenableTimeout(this.performKeyRequest, this);
  private _shutdown: boolean = false;

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

  /**
   * Request a Cube from the network.
   * This obviously only makes sense for light nodes as full nodes will always
   * attempt to sync all available Cubes.
   * @returns A promise resolving to the CubeInfo of the requested Cube.
   *  Promise will reject if Cube cannot be retrieved within timeout.
   */
  requestCube(
    keyInput: CubeKey | string,
    scheduleIn: number = this.options.interactiveRequestDelay,
    timeout: number = this.options.requestTimeout
  ): Promise<CubeInfo> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return new Promise<CubeInfo>((resolve, reject) => reject());

    let alreadyReq: Promise<CubeInfo>;
    if (alreadyReq = this.isAlreadyRequested(keyInput))
      return alreadyReq;
    const key = keyVariants(keyInput);  // normalise input
    const req = new RequestedCube(key.binaryKey, timeout);  // create request
    this.requestedCubes.set(key.keyString, req);  // remember request
    this.scheduleCubeRequest(scheduleIn);  // schedule request
    return req.promise;  // return result eventually
  }

  /**
   * Subscribe to a Cube, ensuring you will receive any an all remote updates.
   * This obviously only makes sense for mutable Cubes, i.e. MUCs.
   * It also obviously only makes sense for light nodes as full nodes will always
   * attempt to sync all available Cubes.
   **/
  // Note: We don't have any actual notion of subscriptions on the core network
  // layer yet. What this currently does is just re-request the same Cube over
  // and over again, which is obviously stupid.
  subscribeCube(
      keyInput: CubeKey | string,
      scheduleIn: number = this.options.interactiveRequestDelay,
  ): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;
    if (this.options.lightNode) {  // full nodes are implicitly subscribed to everything
      const key = keyVariants(keyInput);
      if (this.subscribedCubes.some(subbedKey => subbedKey.equals(key.binaryKey))) {
        return;  // already subscribed, nothing to do here
      }
      this.subscribedCubes.push(key.binaryKey);
      this.scheduleCubeRequest(scheduleIn);  // schedule request
    }
  }

  isAlreadyRequested(keyInput: CubeKey | string): Promise<CubeInfo> {
    // TODO support subscribed Cubes
    const key = keyVariants(keyInput);
    const req = this.requestedCubes.get(key.keyString);
    return req ? req.promise : undefined;
  }

  /**
   * Request all Cubes notifying the specified key from the network.
   * This obviously only makes sense for light nodes as full nodes will always
   * attempt to sync all available Cubes.
   * @returns A promise resolving to the first notification to this key.
   *  Caller should check their local CubeStore to find all notifications.
   *  Promise will reject if no notifications can be retrieved within timeout.
   */
  // maybe TODO: something like an AsyncGenerator as return type would make much more sense
  requestNotifications(
    recipientKey: Buffer,
    scheduleIn: number = this.options.interactiveRequestDelay,
    timeout: number = this.options.requestTimeout,
  ): Promise<CubeInfo> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return new Promise<CubeInfo>((resolve, reject) => reject());

    const key = keyVariants(recipientKey);  // normalise input
    const req = new RequestedCube(key.binaryKey, timeout);  // create request
    this.requestedNotifications.set(key.keyString, req);  // remember request
    this.scheduleCubeRequest(scheduleIn);  // schedule request
    return req.promise;  // return result eventually
  }


  /** @returns true if request scheduled, false if not scheduled
   *           (which happens when there already is a request scheduled)
   */
  scheduleCubeRequest(millis: number = undefined): boolean {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return false;

    if (millis === undefined) {
      millis = this.options.requestInterval * this.calcRequestScaleFactor();
    }
    if (this.cubeRequestTimer.set(millis)) {
      logger.trace(`RequestScheduler.scheduleCubeRequest(): scheduled next Cube request in ${millis} ms`);
    } else logger.trace(`RequestScheduler.scheduleCubeRequest(): I was called to schedule the next request in ${millis}ms, but there's already one scheduled in ${this.cubeRequestTimer.getRemainingTime()}ms`);
    return true;
  }

  scheduleKeyRequest(millis: number = undefined): boolean {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return false;

    if (this.options.lightNode) {
      logger.trace(`RequestScheduler.scheduleKeyRequest() called as a light node, this is wrong; doing nothing`);
      return false;
    }
    if (millis === undefined) {
      millis = this.options.requestInterval * this.calcRequestScaleFactor();
    }
    if (this.keyRequestTimer.set(millis)) {
      logger.trace(`RequestScheduler.scheduleKeyRequest(): scheduled next key request in ${millis} ms`);
    } else logger.trace(`RequestScheduler.scheduleKeyRequest(): I was called to schedule the next request in ${millis}ms, but there's already one scheduled in ${this.keyRequestTimer.getRemainingTime()}ms`);
    return true;
  }

  /**
   * Will be called by NetworkPeers getting offered Cubes by remote nodes
   */
  async handleCubesOffered(offered: Iterable<CubeInfo>, offeringPeer: NetworkPeer): Promise<void> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    let cubeRequestRequired: boolean = false;
    for (const incomingCubeInfo of offered) {
      try {
        // if retention policy is enabled, ensure the offered Cube has
        // not yet reached its recycling date
        const currentEpoch = getCurrentEpoch(); // Get the current epoch
        if(this.networkManager.cubeStore.options.enableCubeRetentionPolicy &&
        !shouldRetainCube(
            incomingCubeInfo.keyString,
            incomingCubeInfo.date,
            incomingCubeInfo.difficulty,
            currentEpoch)) {
          logger.info(`RequestScheduler.handleCubesOffered(): Was offered cube hash outside of retention policy by peer ${offeringPeer.toString()}, ignoring.`);
          continue;
        }

        // If we're a light node, check if we're even interested in this Cube
        if (this.options.lightNode) {
          if (!(this.requestedCubes.has(incomingCubeInfo.keyString)) &&
              !(this.subscribedCubes.includes(incomingCubeInfo.key))
          ){
            continue;
          }
          // TODO implement
          // Slight problem here: An offered key could be in response to
          // a notification request, be we have currently no way of telling
          // whether that's the case
        }

        // Do we already have this Cube?
        const storedCube: CubeInfo =
          await this.networkManager.cubeStore.getCubeInfo(incomingCubeInfo.key, true);
        // Request Cube if not in cube storage, or if it is in
        // storage but the incoming one wins the CubeContest
        if (storedCube === undefined ||
          cubeContest(storedCube, incomingCubeInfo) === incomingCubeInfo
        ) {
          this.requestCube(incomingCubeInfo.key);
          // maybe TODO: ensure this request is not send to another node before we're done?
          cubeRequestRequired = true;
        }
      } catch(error) {
        logger.info(`NetworkPeer ${this.toString()}: handleKeyResponse(): Error handling incoming Cube ${incomingCubeInfo.keyString} (CubeType ${incomingCubeInfo.cubeType}): ${error}`);
      }
    }
    if (cubeRequestRequired) this.performCubeRequest(offeringPeer);
  }

  private calcRequestScaleFactor(): number {
    const conn = this.networkManager.onlinePeerCount;
    const max = this.networkManager.options.maximumConnections;
    const notConn = (max-1)-(conn-1);

    const base = 1/this.options.requestScaleFactor;
    const step = (1-base) / (max-1);

    return base + notConn*step;
  }

  private performCubeRequest(peerSelected?: NetworkPeer): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // cancel timer calling this exact function
    this.cubeRequestTimer.clear();
    // is there even anything left to request?
    if (this.requestedCubes.size === 0 &&
        this.subscribedCubes.length === 0 &&
        this.requestedNotifications.size === 0
    ) {
      logger.trace(`RequestScheduler.performRequest(): doing nothing as there are no open requests`);
      return;  // nothing to do
    }
    // select a peer to send request to
    if (peerSelected === undefined) peerSelected =
      this.options.requestStrategy.select(this.networkManager.onlinePeers);
    if (peerSelected !== undefined) {
      // request all Cubes that we're looking for, up the the maximum allowed
      const keys: CubeKey[] = [];
      for (const [keystring, req] of this.requestedCubes) {
        if (keys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
        if (!req.requestRunning) {
          keys.push(req.key);
          req.requestRunning = true;  // TODO: this must be set back to false if the request fails
        }
      }
      for (const key of this.subscribedCubes) {
        if (keys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
        // Note: This is COMPLETELY INEFFICIENT BULLSHIT!
        // It means we're requesting the exact same Cube over and over again.
        // We need to implement a proper subscription mechanism at the core
        // networking layer.
        keys.push(key);
      }
      if (keys.length > 0) {
        logger.trace(`RequestScheduler.performRequest(): requesting ${keys.length} Cubes from ${peerSelected.toString()}`);
        peerSelected.sendCubeRequest(keys);
      }
      // Note: The cube response will currently still be directly handled by the
      // NetworkPeer. This should instead also be controlled by the RequestScheduler.

      // request notifications
      const notificationKeys: Buffer[] = [];
      for (const [keystring, req] of this.requestedNotifications) {
        if (notificationKeys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
        if (!req.requestRunning) {
          notificationKeys.push(req.key);
          req.requestRunning = true;
        }
      }
      if (notificationKeys.length > 0) {
        logger.trace(`RequestScheduler.performRequest(): requesting notifications to ${notificationKeys.length} notifications keys from ${peerSelected.toString()}`);
        peerSelected.sendNotificationRequest(notificationKeys);
      }
    } else {
      logger.info("RequestScheduler.performRequest(): No matching peer to run request, scheduling next try.")
    }
    // schedule next request
    this.scheduleCubeRequest();
  }

  private performKeyRequest(peerSelected?: NetworkPeer): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // cancel timer calling this exact function
    this.keyRequestTimer.clear();
    // select a peer to send request to
    if (peerSelected === undefined) peerSelected =
      this.options.requestStrategy.select(this.networkManager.onlinePeers);
    if (peerSelected !== undefined) {
      peerSelected.sendKeyRequests();
    }
    this.scheduleKeyRequest();
  }

  // TODO remove? caller can call requestCube in a loop directly
  requestCubes(keys: CubeKey[]): Promise<CubeInfo>[];
  requestCubes(keys: CubeInfo[]): Promise<CubeInfo>[];
  requestCubes(keys: Array<CubeKey | CubeInfo>): Promise<CubeInfo>[];
  requestCubes(
    requests: Array<CubeKey | CubeInfo>):
  Promise<CubeInfo> | Promise<CubeInfo>[] {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return [];

    const promises: Promise<CubeInfo>[] = [];
    for (const req of requests) {
      promises.push(this.requestCube(req as CubeKey));  // or as CubeInfo, don't care
    }
    return promises;
  }

  cubeAddedHandler(cubeInfo: CubeInfo) {
    // no not provide any further callbacks if this scheduler has already been shut down
    if (this._shutdown) return;

    // does this fulfil a Cube request?
    let req: RequestedCube = this.requestedCubes.get(cubeInfo.keyString);
    // or does it maybe fulfil a notification request?
    if (!req) {
      // TODO: do not potentially reactivate Cube, this is very inefficient
      const recipientKey: Buffer =
        cubeInfo.getCube().fields.getFirst(CubeFieldType.NOTIFY)?.value;
      if (recipientKey) req = this.requestedNotifications.get(keyVariants(recipientKey).keyString);
    }
    if (req) {
      req.fulfilled(cubeInfo);
      this.requestedCubes.delete(cubeInfo.keyString);
    }
  }

  shutdown(): void {
    this._shutdown = true;
    this.cubeRequestTimer.clear();
    this.keyRequestTimer.clear();
    this.networkManager.cubeStore.removeListener("cubeAdded", (cubeInfo: CubeInfo) =>
      this.cubeAddedHandler(cubeInfo));
    for (const [key, req] of this.requestedCubes) req.shutdown();
    for (const [key, req] of this.requestedNotifications) req.shutdown();
  }
}
