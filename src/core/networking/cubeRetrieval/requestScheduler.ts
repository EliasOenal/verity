import type { NetworkPeerIf } from '../networkPeerIf';
import type { NetworkManagerIf } from '../networkManagerIf';

import { Settings } from '../../settings';
import { NetConstants, NetworkPeerError } from '../networkDefinitions';
import { CubeFilterOptions, KeyRequestMessage, KeyRequestMode, NetworkMessage, SubscriptionConfirmationMessage } from '../networkMessage';

import { RequestStrategy, RandomStrategy, BestScoreStrategy } from './requestStrategy';
import { PendingRequest } from './pendingRequest';

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
// While we already support scheduling a request in "0ms", i.e. immediately,
// this does not guarantee the request will actually be sent immediately as there
// may already be another request running.

// TODO: non-fulfilled requests must be rescheduled while within timeout

// TODO: this thing has become a bit bloated...
//   - code review & clean-up
//   - potentially refactor into smaller units

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
  requestRetries?: number;
  interactiveRequestDelay?: number;
}

export interface CubeRequestOptions {
  scheduleIn?: number;
  timeout?: number;
  requestFrom?: NetworkPeerIf;
}

/**
 * Queries our connected peers for Cubes, depending on the configuration and
 * on local application's requests.
 */
export class RequestScheduler {
  /**
   * A map of Cubes requested by the user.
   * Key: The Cube key,
   *      or in case of a Cube requested from a specific peer: The peer's
   *      ID concatenated with the Cube key.
   * Value: A PendingRequest object containing a promise to resolve to a CubeInfo
   **/
  private requestedCubes: Map<string, CubeRequest> = new Map();
  /** Notifications requested by the user in direct Cube request mode */
  private requestedNotifications: Map<string, CubeRequest> = new Map();
  /** Notifications requested by the user in key request mode */
  private expectedNotifications: Map<string, CubeRequest> = new Map();
  /** Cubes (MUC, PMUC) subscribed to by the user */
  private subscribedCubes: Map<string, CubeRequest> = new Map();

  /**
   * A map of responses to Cube subscription requests we are currently waiting for.
   * Key: String representation of the requested key blob (i.e. the single
   * requested key, or the hash of all requested keys).
   * Value: The pending request
   */
  private pendingSubscriptionConfirmations:
    Map<string, SubscriptionRequest> = new Map();

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
    options.lightNode ??= true;
    options.requestStrategy ??= new RandomStrategy();
    options.requestInterval ??= Settings.KEY_REQUEST_TIME;
    options.requestScaleFactor ??= Settings.REQUEST_SCALE_FACTOR;
    options.requestTimeout ??= Settings.CUBE_REQUEST_TIMEOUT;
    options.interactiveRequestDelay ??= Settings.INTERACTIVE_REQUEST_DELAY;

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
    options: CubeRequestOptions = {},
  ): Promise<CubeInfo> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return Promise.resolve(undefined);
    // set defaults options
    options.scheduleIn ??= this.options.interactiveRequestDelay;
    options.timeout ??= this.options.requestTimeout;
    // normalise input
    const key = keyVariants(keyInput);
    // sanity checks
    if (Settings.RUNTIME_ASSERTIONS) {
      if (options.requestFrom && !options.requestFrom.valid()) {
        throw new NetworkPeerError("RequestScheduler.requestCube(): Invalid peer selected for Cube request");
      }
    }

    // determine how to refer to this pending request: either just by its key,
    // or by both the peer ID and the Cube key if requested from a specific peer
    const primaryMapKey: string = options.requestFrom?.idString?
      // if we're requesting from a specific peer, the combination of
      // their ID and the Cube key is the primary map key
      options.requestFrom.idString + key.keyString :
      key.keyString;
    const additionalMapKey: string = options.requestFrom?.idString?
      // if we're requesting from a specific peer, the Cube key alone is a
      // secondary map key as this request will significantly fulfil any
      // non-specific requests for this Cube
      key.keyString :
      undefined;

    // check if this request is already pending
    const alreadyReq: Promise<CubeInfo> = this.existingCubeRequest(primaryMapKey);
    if (alreadyReq) return alreadyReq;

    // create and remember this request
    const req = new CubeRequest(options.timeout, {
      key: key.binaryKey,
    });
    this.requestedCubes.set(primaryMapKey, req);
    if (additionalMapKey && !this.requestedCubes.has(additionalMapKey)) {
      // never overwrite an existing request
      this.requestedCubes.set(additionalMapKey, req);
    }

    if (options.requestFrom !== undefined) {
      // send direct Cube request to user-selected peer
      // maybe TODO: schedule and collect Cube requests to user-defined peers?
      options.requestFrom.sendCubeRequest([key.binaryKey]);
    } else {
      // schedule Cube request
      this.scheduleCubeRequest(options.scheduleIn);
    }
    return req.promise;  // return result eventually
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


  /**
   * Subscribe to a Cube, ensuring you will receive any and all remote updates.
   * This obviously only makes sense for mutable Cubes, i.e. MUCs.
   * It also obviously only makes sense for light nodes as full nodes will always
   * attempt to sync all available Cubes.
   **/
  // TODO: add option to persist trying to subscribe even if Cube does not exist
  // TODO implement requestFrom
  // TODO implement timeout
  async subscribeCube(
      keyInput: CubeKey | string,
      options: CubeRequestOptions = {},
  ): Promise<void> {  // TODO provide proper return value
    // Sanity checks:
    // Do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;
    // Full nodes are implicitly subscribed to everything
    if (!this.options.lightNode) return;

    // Input normalisation:
    const key = keyVariants(keyInput);
    // Already subscribed?
    if (this.subscribedCubes.has(key.keyString)) return;
    // set defaults options
    options.scheduleIn ??= this.options.interactiveRequestDelay;
    options.timeout ??= this.options.requestTimeout;

    // Do we even have this Cube locally?
    // If we don't have it, does it even exist on the network?
    let ourCubeInfo: CubeInfo = await this.networkManager.cubeStore.getCubeInfo(key.keyString);
    if (ourCubeInfo === undefined) {
      ourCubeInfo = await this.requestCube(key.keyString);
      if (ourCubeInfo === undefined) {
        logger.trace(`RequestScheduler.subscribeCube(): Could not find Cube ${key.keyString} locally or remotely`);
        return;
      }
    }

    // Select a node to subscribe from.
    // TODO: Improve selection strategy.
    //   For the moment, we're just using the node with the best local score,
    //   which can be reasonably expected to be a full node.
    //   In the long run, we should however actually prefer light nodes.
    let availablePeers: NetworkPeerIf[] = this.networkManager.onlinePeers;
    const strat: RequestStrategy = new BestScoreStrategy();

    let peerSelected: NetworkPeerIf;
    let subscriptionConfirmed: boolean = false;
    while (!subscriptionConfirmed && availablePeers.length > 0) {
      // Peer selection:
      // Any candidate peers available?
      if (availablePeers.length === 0) {
        peerSelected = undefined;
        break;
      }
      // Select a candidate peer
      peerSelected = strat.select(availablePeers);
      // Remove selected peer from list of available peers to avoid duplication
      availablePeers = availablePeers.filter(p => p !== peerSelected);

      // Send subscription request...
      // maybe TODO optimise: group multiple subscriptions to the same peer?
      peerSelected.sendSubscribeCube([key.binaryKey]);
      // ... and await reply
      const req = new SubscriptionRequest(Settings.NETWORK_TIMEOUT, // low prio TODO: parametrise timeout
        { key: key.binaryKey } );
      this.pendingSubscriptionConfirmations.set(key.keyString, req);
      const resp: SubscriptionConfirmationMessage = await req.promise;
      // low prio TODO after wire format 2.0:
      // send pre-checks to several candidate nodes at once,
      // then select best one to subscribe to

      // Check response:
      // 1) Did the remote node even answer?
      if (resp === undefined) {
        peerSelected = undefined;
        continue;
      }
      // 2) Does the response quote the requested key?
      if (!resp.requestedKeyBlob.equals(key.binaryKey)) {
        peerSelected = undefined;
        continue;
      }
      // 3) Does the remote node have the same version as us?
      //    If not, request this remote node's version:
      //    if the remote version is newer, subscribe;
      //    if the remote version is older, choose other node.
      if (!resp.cubesHashBlob.equals(await ourCubeInfo.getCube().getHash())) {
        const remoteCubeInfo: CubeInfo = await this.requestCube(
          key.keyString, { requestFrom: peerSelected });
        // disregard this peer if it:
        // - does not respond or does not have the requested Cube
        if (remoteCubeInfo === undefined) {
          peerSelected = undefined;
          continue;
        }
        // - if the remote version is older than ours
        //   (note: calling cubeContest with reverse params as we want the
        //   remote to "win" (qualify for subscription) in case of a tie --
        //   a "tie" is actually the most favourable outcome as it means we
        //   are in sync with the candidate node)
        if (cubeContest(remoteCubeInfo, ourCubeInfo) !== remoteCubeInfo) {
          peerSelected = undefined;
          continue;
        }
      }

      // All looking fine, select this node
      break;

      // TODO: If node selection fails, schedule a retry, same as for a regular request
      // (which also has not been implemented yet)

      // TODO optimise: Allow subscribing to multiple Cubes at once.
      //   If the remote node indicates there's a version mismatch, don't re-request
      //   all of the Cubes, but try to figure out which one(s) we're missing in log time
    }

    if (peerSelected === undefined) {
      logger.trace(`RequestScheduler.subscribeCube(): Could not subscribe to Cube ${key.keyString}`);
      return undefined;
    }

    // Register this subscription
    this.subscribedCubes.set(key.keyString, new PendingRequest(
      Settings.CUBE_SUBSCRIPTION_PERIOD,  // TODO use subscription period as reported back by serving node
      { key: key.binaryKey },
    ));
    // TODO: renew subscription after it expires
  }


  handleSubscriptionConfirmation(msg: SubscriptionConfirmationMessage): void {
    // fetch the pending request
    const keyBlob = keyVariants(msg.requestedKeyBlob);
    const req: SubscriptionRequest =
      this.pendingSubscriptionConfirmations.get(keyBlob.keyString);
    if (req !== undefined) {
      // mark the request fulfilled
      req.fulfilled(msg);
      // and remove from pending set
      this.pendingSubscriptionConfirmations.delete(keyBlob.keyString);
    } else {
      // no such request -- this is either a bug or the remote node is confused
      logger.trace(`RequestScheduler.handleSubscriptionConfirmation(): Received confirmation for unknown request with key blob ${keyBlob.keyString}`);
    }
  }

  isAlreadyRequested(
      keyInput: CubeKey | string,
      includeSubscriptions: boolean = true,
  ): boolean {
    const key = keyVariants(keyInput);
    let req = this.requestedCubes.get(key.keyString);
    if (!req && includeSubscriptions) req = this.subscribedCubes.get(key.keyString);
    if (req) return true;
    else return false;
  }
  isAlreadySubscribed(keyInput: CubeKey | string): boolean {
    const key = keyVariants(keyInput);
    return this.subscribedCubes.has(key.keyString);
  }
  existingCubeRequest(keyInput: CubeKey | string): Promise<CubeInfo> {
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
      const req = new CubeRequest(timeout, {
        key: key.binaryKey,
      });  // create request
      this.requestedNotifications.set(key.keyString, req);  // remember request
      this.scheduleCubeRequest(scheduleIn);  // schedule request
      return req.promise;  // return result eventually
    } else {
      // remember this request and create a promise for it
      const req = new CubeRequest(timeout, {
        key: key.binaryKey,
      });
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

  /**
   * Will be called by NetworkPeers getting delivered Cubes by remote nodes
   */
  async handleCubesDelivered(
      binaryCubes: Iterable<Buffer>,
      offeringPeer: NetworkPeerIf,
  ): Promise<void> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    for (const binaryCube of binaryCubes) {
      // first of all, activate this Cube
      const cube = this.networkManager.cubeStore.activateCube(binaryCube);
      const keyString = await cube.getKeyString();
      if (cube === undefined) continue;  // drop this Cube if it's not valid

      // If we're a light node, check if we're even interested in this Cube
      if (this.options.lightNode) {
        // maybe TODO: the key should always be available after reactivation;
        //   do we want to switch to the non-async key getter?
        if (!(this.requestedCubes.has(keyString)) &&
            !(this.subscribedCubes.has(keyString))
        ){
          continue;  // drop this Cube, we're not interested in it
        }
      }
      // Add the cube to the CubeStorage
      // Grant this peer local reputation if cube is accepted.
      // TODO BUGBUG: This currently grants reputation score for duplicates,
      // which is absolutely contrary to what we want :'D
      const value = await this.networkManager.cubeStore.addCube(binaryCube);  // TODO: use pre-activated version instead
      if (value) { offeringPeer.scoreReceivedCube(value.getDifficulty()); }

      // Check if this delivery fulfils a pending request
      const keyStrings: string[] = [keyString, offeringPeer.idString + keyString];
      this.cubeRequestFulfilled(keyStrings, await cube.getCubeInfo());  // maybe TODO: avoid creating duplicate CubeInfo
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
    const reschedule: boolean = this.performCubeRequest(peerSelected);
    if (reschedule) this.scheduleCubeRequest();
  }

  /**
   * @returns True if a request has been performed, false if it has not.
   */
  private performCubeRequest(peerSelected?: NetworkPeerIf): boolean {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // is there even anything left to request?
    if (this.requestedCubes.size === 0 &&
        this.requestedNotifications.size === 0
    ) {
      logger.trace(`RequestScheduler.performRequest(): doing nothing as there are no open requests`);
      return false;  // nothing to do
    }
    // select a peer to send request to, unless we were told to use a specific one
    if (peerSelected === undefined) peerSelected =
      this.options.requestStrategy.select(this.networkManager.onlinePeers);
    if (peerSelected === undefined) {
      logger.info("RequestScheduler.performRequest(): Could not find a suitable peer; doing nothing.");
      return false;
    }

    // request all Cubes that we're looking for, up the the maximum allowed
    const keys: CubeKey[] = [];
    for (const [keystring, req] of this.requestedCubes) {
      if (keys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
      if (!req.sup.networkRequestRunning) {
        keys.push(req.sup.key);
        req.sup.networkRequestRunning = true;  // TODO: this must be set back to false if the request fails, which is not currently done
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
      if (!req.sup.networkRequestRunning) {
        notificationKeys.push(req.sup.key);
        req.sup.networkRequestRunning = true;
      }
    }
    if (notificationKeys.length > 0) {
      logger.trace(`RequestScheduler.performRequest(): requesting notifications to ${notificationKeys.length} notifications keys from ${peerSelected.toString()}`);
      peerSelected.sendNotificationRequest(notificationKeys);
    }
    return true;
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
      timeoutSecs: number = Settings.NETWORK_TIMEOUT,
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

  private cubeAddedHandler(cubeInfo: CubeInfo) {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // does this fulfil a Cube request?
    // note: This is duplicates what we already do in handleCubesDelivered(),
    //       maybe remove it here? Possible rationale for leaving it in might be
    //       that it ensures a request gets fulfilled even if a new Cube is
    //       smuggled in without this scheduler noticing.
    this.cubeRequestFulfilled([cubeInfo.keyString], cubeInfo);

    // does this fulfil a notification request in direct CubeRequest mode?
    // TODO: do not potentially reactivate Cube a dormant Cube as it's inefficient
    const recipientKey: Buffer =
      cubeInfo.getCube().getFirstField(CubeFieldType.NOTIFY)?.value;
    if (recipientKey) {
      const directNotificationRequest: CubeRequest = this.requestedNotifications.get(keyVariants(recipientKey).keyString);
      if (directNotificationRequest) {
        directNotificationRequest.fulfilled(cubeInfo);
        this.requestedNotifications.delete(cubeInfo.keyString);
      }
    }

    // does this fulfill a notification request in KeyRequest mode?
    if (recipientKey) {
      const indirectNotificationRequest: CubeRequest = this.expectedNotifications.get(keyVariants(recipientKey).keyString);
      if (indirectNotificationRequest) {
        indirectNotificationRequest.fulfilled(cubeInfo);
        this.expectedNotifications.delete(cubeInfo.keyString);
      }
    }
  }

  private cubeRequestFulfilled(keyStrings: string[], cubeInfo: CubeInfo): void {
    for (const keyString of keyStrings) {
      const req = this.requestedCubes.get(keyString);
      if (req !== undefined) {
        // mark the request fulfilled
        req.fulfilled(cubeInfo);  // maybe TODO: avoid creating duplicate CubeInfo
        // and remove from pending set
        this.requestedCubes.delete(keyString);
      }
    }
  }

  private cubeRequestRetry(req: CubeRequest): void {

  }
}


export interface CubeRequestSupplemental {
  key: Buffer,

  /**
   * Indicates whether we have sent out a network request for this request
   * and are currently awaiting a peer response.
   * Note that this is a public property, i.e. it is up to the caller to
   * correctly implement this functionality.
   */
  networkRequestRunning?: boolean;

  currentTry?: number,
  maxTries?: number,
}
export class CubeRequest extends PendingRequest<CubeInfo, CubeRequestSupplemental> {}
export interface SubscriptionRequestSupplemental {
  key: Buffer,
  currentTry?: number,
  maxTries?: number,
}
export class SubscriptionRequest extends PendingRequest<SubscriptionConfirmationMessage, SubscriptionRequestSupplemental> {}
