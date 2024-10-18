import type { NetworkPeerIf } from '../networkPeerIf';
import type { NetworkManagerIf } from '../networkManagerIf';

import { Settings } from '../../settings';
import { NetConstants } from '../networkDefinitions';
import { CubeFilterOptions, KeyRequestMessage, KeyRequestMode } from '../networkMessage';

import { RequestStrategy, RandomStrategy } from './requestStrategy';
import { RequestedCube } from './requestedCube';

import { ShortenableTimeout } from '../../helpers/shortenableTimeout';
import { CubeFieldType, type CubeKey } from '../../cube/cube.definitions';
import { CubeInfo } from '../../cube/cubeInfo';
import { cubeContest, getCurrentEpoch, keyVariants, shouldRetainCube } from '../../cube/cubeUtil';

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
  /** Cubes requested by the user */
  private requestedCubes: Map<string, RequestedCube> = new Map();
  /** Notifications requested by the user in direct Cube request mode */
  private requestedNotifications: Map<string, RequestedCube> = new Map();
  /** Notifications requested by the user in key request mode */
  private expectedNotifications: Map<string, RequestedCube> = new Map();
  /** Cubes (MUC, PMUC) subscribed to by the user */
  private subscribedCubes: Map<string, RequestedCube> = new Map();

  /** Timer for regularly scheduled CubeRequests */
  private cubeRequestTimer: ShortenableTimeout = new ShortenableTimeout(this.performAndRescheduleCubeRequest, this);
  /** Timer for regularly scheduled KeyRequests */
  private keyRequestTimer: ShortenableTimeout = new ShortenableTimeout(this.performAndRescheduleKeyRequest, this);

  /**
   * Light nodes don't usually act on KeyResponse messages,
   * except when they requested them.
   **/
  private expectedKeyResponses: Map<NetworkPeerIf, ShortenableTimeout> = new Map();

  /**
   * Will be set to true when shutdown() is called. From this point forward,
   * our methods will refuse service on further calls.
   */
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
   *  Promise will return undefined if Cube cannot be retrieved within timeout.
   */
  requestCube(
    keyInput: CubeKey | string,
    scheduleIn: number = this.options.interactiveRequestDelay,
    timeout: number = this.options.requestTimeout
  ): Promise<CubeInfo> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return Promise.resolve(undefined);

    let alreadyReq: Promise<CubeInfo>;
    if (alreadyReq = this.existingRequest(keyInput))
      return alreadyReq;
    const key = keyVariants(keyInput);  // normalise input
    const req = new RequestedCube(key.binaryKey, timeout);  // create request
    this.requestedCubes.set(key.keyString, req);  // remember request
    this.scheduleCubeRequest(scheduleIn);  // schedule request
    return req.promise;  // return result eventually
  }

  /**
   * Subscribe to a Cube, ensuring you will receive any and all remote updates.
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
    // Sanity checks:
    // Do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;
    // Full nodes are implicitly subscribed to everything
    if (!this.options.lightNode) return;
    // Normalise input
    const key = keyVariants(keyInput);
    // Already subscribed?
    if (this.subscribedCubes.has(key.keyString)) return;

    // Select a node to subscribe from.
    // TODO: Select a *sensible* node.
    //   It should either be a full node or one that has already served us a
    //   current version of this Cube recently.
    const peerSelected: NetworkPeerIf =
      this.options.requestStrategy.select(this.networkManager.onlinePeers);

    // HACKHACK first send a regular CubeRequest
    peerSelected.sendCubeRequest([key.binaryKey]);
    // send subscription request
    // maybe TODO: group multiple subscriptions to the same peer?
    peerSelected.sendSubscribeCube([key.binaryKey]);

    // Register this subscription
    // TODO: Once responses are implemented, evaluate response
    this.subscribedCubes.set(key.keyString, new RequestedCube(
      key.binaryKey,
      // TODO use subscription period as reported back by serving node
      Settings.CUBE_SUBSCRIPTION_PERIOD,
    ));
    this.scheduleCubeRequest(scheduleIn);  // schedule request
  }

  isAlreadyRequested(keyInput: CubeKey | string): boolean {
    const key = keyVariants(keyInput);
    let req = this.requestedCubes.get(key.keyString);
    if (!req) req = this.subscribedCubes.get(key.keyString);
    if (req) return true;
    else return false;
  }

  existingRequest(keyInput: CubeKey | string): Promise<CubeInfo> {
    const key = keyVariants(keyInput);
    let req = this.requestedCubes.get(key.keyString)?.promise;
    return req;
  }

  /**
   * Request all Cubes notifying the specified key from the network.
   * This obviously only makes sense for light nodes as full nodes will always
   * attempt to sync all available Cubes.
   * @returns A promise resolving to the first notification to this key. Note:
   *  - Caller should check their local CubeStore to find all notifications retrieved.
   *  - A resolved promise does not guarantee that all notifications available
   *    on the network or even on the node they were requested from have been retrieved.
   *  - Promise will return undefined if no new notifications can be retrieved within timeout.
   */
  // maybe TODO: something like an AsyncGenerator as return type would make much more sense
  requestNotifications(
    recipientKey: Buffer,
    scheduleIn: number = this.options.interactiveRequestDelay,
    timeout: number = this.options.requestTimeout,
    directCubeRequest: boolean = false,
  ): Promise<CubeInfo> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return Promise.resolve(undefined);
    const key = keyVariants(recipientKey);  // normalise input

    if (directCubeRequest) {
      // Directly send a CubeRequest. This makes sense if we don't have any
      // notifications for this recipient yet.
      const req = new RequestedCube(key.binaryKey, timeout);  // create request
      this.requestedNotifications.set(key.keyString, req);  // remember request
      this.scheduleCubeRequest(scheduleIn);  // schedule request
      return req.promise;  // return result eventually
    } else {
      // remember this request and create a promise for it
      const req: RequestedCube = new RequestedCube(key.binaryKey, timeout);
      this.expectedNotifications.set(key.keyString, req);
      // Start with a KeyRequest. This makes sense if we already have (a lot of)
      // notifications for this recipient and want to avoid redownloading them all.
      const filter: CubeFilterOptions = {
        notifies: key.binaryKey,
      }
      this.performKeyRequest(undefined, filter);
      // KeyResponse will automatically be handled in handleCubesOffered()
      return req.promise;
    }

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
   * Will be called by NetworkPeers getting offered keys by remote nodes
   */
  async handleKeysOffered(offered: Iterable<CubeInfo>, offeringPeer: NetworkPeerIf): Promise<void> {
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
              !(this.subscribedCubes.has(incomingCubeInfo.keyString)) &&
              !(this.expectedKeyResponses.has(offeringPeer))  // whitelisted due to previous filtering KeyRequest
          ){
            continue;  // ignore offered key
          }
          // Note a curious edge case:
          // An offered key could be in response to a notification request,
          // be we have currently no way of telling whether that's the case.
          // We currently handle this by whitelisting the node we send the
          // notification key request to (via expectedKeyResponses),
          // but that effectively means nodes responding to our notification
          // requests can spam light nodes with random Cubes.
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
    const res = base + notConn*step;
    return res;
  }

  /**
   * Wrapper around performCubeRequest() which will also schedule the next
   * request after the usual time.
   */
  private performAndRescheduleCubeRequest(peerSelected?: NetworkPeerIf): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;
    this.cubeRequestTimer.clear();  // cancel timer calling this exact function
    this.performCubeRequest(peerSelected);
    this.scheduleCubeRequest();
  }

  private performCubeRequest(peerSelected?: NetworkPeerIf): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // is there even anything left to request?
    if (this.requestedCubes.size === 0 &&
        this.requestedNotifications.size === 0
    ) {
      logger.trace(`RequestScheduler.performRequest(): doing nothing as there are no open requests`);
      return;  // nothing to do
    }
    // select a peer to send request to, unless we were told to use a specific one
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
      logger.info("RequestScheduler.performRequest(): Could not find a suitable peer; doing nothing.")
    }
  }

  /**
   * Wrapper around performKeyRequest() used for regular / "full node" key
   * requests. Will reschedule another key request after the usual time.
   */
  private performAndRescheduleKeyRequest(peerSelected?: NetworkPeerIf): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;
    this.keyRequestTimer.clear();  // cancel timer calling this exact function
    this.performKeyRequest(peerSelected);
    this.scheduleKeyRequest();
  }

  private performKeyRequest(peerSelected?: NetworkPeerIf, options: CubeFilterOptions = {}): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // select a peer to send request to, unless we were told to use a specific one
    if (peerSelected === undefined) peerSelected =
      this.options.requestStrategy.select(this.networkManager.onlinePeers);
    if (peerSelected === undefined) {
      logger.debug('RequestScheduler.performKeyRequest(): Could not find a suitable peer; doing nothing.');
      return;
    }

    if (this.options.lightNode) this.expectKeyResponse(peerSelected);

    // We will now translate the supplied filter options to our crappy
    // non-orthogonal 1.0 wire format. Non-fulfillable requests will be
    // ignored. Hopefully we can get rid of this crap one we introduce a
    // sensible wire format.
    if (!KeyRequestMessage.filterLegal(options)) {
      logger.trace('RequestScheduler.performKeyRequest(): Unfulfillable combination of filters; doing nothing.');
      return;
    }
    // do we need to send a specific key request?
    let mode: KeyRequestMode = undefined;
    if (options.notifies && (options.timeMin || options.timeMax)) mode = KeyRequestMode.NotificationTimestamp;
    else if (options.notifies) mode = KeyRequestMode.NotificationChallenge;
    if (mode !== undefined) {
      // if so, send the required one
      peerSelected.sendSpecificKeyRequest(mode, options);
    }
    else {
      // otherwise, let the peer decide which mode(s) to use
      peerSelected.sendKeyRequests();
    }
  }

  /**
   * If we're a light node, expect a KeyResponse.
   * (Light nodes don't act on those by default -- this method basically
   * whitelists KeyResponses from a certain peer on light nodes.)
   */
  // maybe TODO: We currently need to always keep the whitelisting all the way
  // till expiry, even if we receive a reply before that. That's because there
  // may be multiple expected KeyResponses from this peer and we currently
  // don't keep count.
  private expectKeyResponse(
      from: NetworkPeerIf,
      timeoutSecs: number = Settings.CUBE_REQUEST_TIMEOUT,  // TODO: this is WRONG; should be Settings.NETWORK_TIMEOUT... but we "temporarily" set this to zero, so it won't work
  ): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // this method is only for light nodes
    if (this.options.lightNode) {
      // expect the response within timeout
      const newTimeout = new ShortenableTimeout(() => {
        this.expectedKeyResponses.delete(from);
      }, this);
      newTimeout.set(timeoutSecs);
      // clear any previous timeout we might have for this peer
      const previousTimeout: ShortenableTimeout = this.expectedKeyResponses.get(from);
      if (previousTimeout) previousTimeout.clear();
      // remember this expected key response
      this.expectedKeyResponses.set(from, newTimeout);
    } else {
      logger.trace('RequestScheduler: expectKeyResponse() called on a full node, which makes no sense. Ignoring.');
    }
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
    const cubeRequest: RequestedCube = this.requestedCubes.get(cubeInfo.keyString);
    if (cubeRequest) {
      cubeRequest.fulfilled(cubeInfo);
      this.requestedCubes.delete(cubeInfo.keyString);
    }

    // does this fulfil a notification request in direct CubeRequest mode?
    // TODO: do not potentially reactivate Cube, this is very inefficient
    const recipientKey: Buffer =
      cubeInfo.getCube().getFirstField(CubeFieldType.NOTIFY)?.value;
    if (recipientKey) {
      const directNotificationRequest: RequestedCube = this.requestedNotifications.get(keyVariants(recipientKey).keyString);
      if (directNotificationRequest) {
        directNotificationRequest.fulfilled(cubeInfo);
        this.requestedNotifications.delete(cubeInfo.keyString);
      }
    }

    // does this fulfill a notification request in KeyRequest mode?
    if (recipientKey) {
      const indirectNotificationRequest: RequestedCube = this.expectedNotifications.get(keyVariants(recipientKey).keyString);
      if (indirectNotificationRequest) {
        indirectNotificationRequest.fulfilled(cubeInfo);
        this.expectedNotifications.delete(cubeInfo.keyString);
      }
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
    for (const [key, req] of this.expectedNotifications) req.shutdown();
    for (const [peer, timeout] of this.expectedKeyResponses) timeout.clear();
  }
}
