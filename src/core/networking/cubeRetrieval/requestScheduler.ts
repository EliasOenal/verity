import type { NetworkPeerIf } from '../networkPeerIf';
import type { NetworkManagerIf } from '../networkManagerIf';
import type { Cube } from '../../cube/cube';
import type { CubeInfo } from '../../cube/cubeInfo';

import { Settings } from '../../settings';
import { Shuttable } from '../../helpers/coreInterfaces';
import { MessageClass, NetConstants, NetworkPeerError, NodeType } from '../networkDefinitions';
import { CubeFilterOptions, KeyRequestMessage, KeyRequestMode, SubscriptionConfirmationMessage, SubscriptionResponseCode } from '../networkMessage';

import { ShortenableTimeout } from '../../helpers/shortenableTimeout';
import { CubeFieldType, GetCubeOptions, type NotificationKey, type CubeKey } from '../../cube/cube.definitions';
import { cubeContest, getCurrentEpoch, shouldRetainCube } from '../../cube/cubeUtil';
import { asCubeKey, keyVariants } from '../../cube/keyUtil';

import { RequestStrategy, RandomStrategy, BestScoreStrategy } from './requestStrategy';
import { CubeRequest, CubeSubscription, SubscriptionRequest } from './pendingRequest';

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

export interface CubeRequestOptions extends GetCubeOptions {
  scheduleIn?: number;
  timeout?: number;
  requestFrom?: NetworkPeerIf;
}

export interface CubeSubscribeOptions extends CubeRequestOptions {
  /**
   * How early to renew a subscription before expiry (in milliseconds).
   */
  renewSubscriptionsBeforeExpiryMillis?: number;

  /**
   * Do not set this property manually.
   * It's an internal option signalling that this call represents an
   * automatic renewal of an existing subscription.
   */
  thisIsARenewal?: boolean;

  /**
   * Do not set this property manually.
   * It will automatically set for you based on whether you call
   * subscribeCube() or subscribeNotifications().
   */
  type?: MessageClass.SubscribeCube | MessageClass.SubscribeNotifications;
}

/**
 * Queries our connected peers for Cubes, depending on the configuration and
 * on local application's requests.
 */
export class RequestScheduler implements Shuttable {
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
  private subscribedCubes: Map<string, CubeSubscription> = new Map();
  private subscribedNotifications: Map<string, CubeSubscription> = new Map();

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

    this.networkManager.cubeStore.on("cubeAdded", this.cubeAddedHandler);
  }

  /**
   * Request a Cube from the network.
   * This obviously only makes sense for light nodes as full nodes will always
   * attempt to sync all available Cubes.
   * @returns A promise resolving to the CubeInfo of the requested Cube.
   *  Promise will return undefined if Cube cannot be retrieved within timeout.
   */
  // TODO minor BUGBUG: options.family is ignored
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
      key: key.binaryKey as CubeKey,
    });
    this.requestedCubes.set(primaryMapKey, req);
    // clean up the request when it's done
    req.promise.then(() => {
      // only clean up if the stored request is actually the one that's done
      const registered: CubeRequest = this.requestedCubes.get(primaryMapKey);
      if (registered === req)this.requestedCubes.delete(primaryMapKey)
    });
    // also remember this request by its secondary map key if applicable
    if (additionalMapKey && !this.requestedCubes.has(additionalMapKey)) {
      // never overwrite an existing request
      this.requestedCubes.set(additionalMapKey, req);
      req.promise.then(() => {
        // only clean up if the stored request is actually the one that's done
        const registered: CubeRequest = this.requestedCubes.get(additionalMapKey);
        if (registered === req) this.requestedCubes.delete(additionalMapKey)
      });
    }

    if (options.requestFrom !== undefined) {
      // send direct Cube request to user-selected peer
      // maybe TODO: schedule and collect Cube requests to user-defined peers?
      options.requestFrom.sendCubeRequest([key.binaryKey as CubeKey]);
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
      options: CubeSubscribeOptions = {},
  ): Promise<CubeSubscription> {
    // Sanity checks:
    // Do not accept any calls if this scheduler has already been shut down.
    if (this._shutdown) return undefined;
    // Full nodes are implicitly subscribed to everything
    if (!this.options.lightNode) return undefined;

    // set defaults options
    options.scheduleIn ??= this.options.interactiveRequestDelay;
    options.timeout ??= this.options.requestTimeout;
    options.type ??= MessageClass.SubscribeCube;
    options.renewSubscriptionsBeforeExpiryMillis ??= Settings.RENEW_SUBCRIPTION_BEFORE_EXPIRY_MILLIS;
    const subMap = options.type === MessageClass.SubscribeNotifications?
      this.subscribedNotifications : this.subscribedCubes;

    // Input normalisation:
    const key = keyVariants(keyInput);

    // Already subscribed?
    if (!options.thisIsARenewal && subMap.has(key.keyString)) {
      return undefined;  // TODO why undefined?!?!?!? return existing sub!
    }

    // Subscribe to connected full nodes only
    // Get all online peers that are full nodes
    const fullNodePeers = this.networkManager.onlinePeers.filter(peer => 
        peer.remoteNodeType === NodeType.Full
    );

    if (fullNodePeers.length === 0) {
      logger.warn(`RequestScheduler.subscribeCube(): Could not subscribe to ${options.type === MessageClass.SubscribeCube ? 'Cube' : options.type === MessageClass.SubscribeNotifications ? 'Notification' : 'unknown sub type ' + options.type + ' '} ${key.keyString} because no full nodes are available.`);
      return undefined;
    }

    // Subscribe to ALL connected full nodes for resilience
    logger.trace(`RequestScheduler.subscribeCube(): Attempting to subscribe to ${fullNodePeers.length} full nodes for ${key.keyString}`);
    
    // Send subscription requests to all full nodes
    const pendingRequests: Map<NetworkPeerIf, SubscriptionRequest> = new Map();
    for (const peer of fullNodePeers) {
      peer.sendSubscribeCube([key.binaryKey as CubeKey], options.type);
      
      // Create a unique request key for each peer to avoid conflicts
      const peerRequestKey = `${peer.idString}-${key.keyString}`;
      const req = new SubscriptionRequest(Settings.NETWORK_TIMEOUT, { key: key.binaryKey });
      this.pendingSubscriptionConfirmations.set(peerRequestKey, req);
      pendingRequests.set(peer, req);
    }
    
    // Wait for all responses (or timeout)
    const responses = await Promise.allSettled(Array.from(pendingRequests.values()).map(req => req.promise));
    
    // Process responses and collect successful subscriptions
    const successfulPeers: NetworkPeerIf[] = [];
    const successfulResponses: SubscriptionConfirmationMessage[] = [];
    let index = 0;
    
    for (const peer of fullNodePeers) {
      const response = responses[index];
      index++;
      
      // Clean up the pending request
      const peerRequestKey = `${peer.idString}-${key.keyString}`;
      this.pendingSubscriptionConfirmations.delete(peerRequestKey);
      
      if (response.status === 'fulfilled' && response.value) {
        const subscriptionResponse = response.value;
        
        // Check if subscription was confirmed
        if (subscriptionResponse.responseCode === SubscriptionResponseCode.SubscriptionConfirmed &&
            subscriptionResponse.subscriptionDuration &&
            subscriptionResponse.requestedKeyBlob.equals(key.binaryKey)) {
          
          // For cube subscriptions, check if we should try to get updates
          // Note: We no longer automatically fetch cubes during subscription.
          // Callers should explicitly call requestCube() if they want current data.
          if (options.type === MessageClass.SubscribeCube) {
            logger.trace(`RequestScheduler.subscribeCube(): Successfully subscribed to ${key.keyString} on peer ${peer.toString()}, subscription will receive future updates`);
          }
          
          // Accept subscription from any willing full node for multi-node resilience
          successfulPeers.push(peer);
          successfulResponses.push(subscriptionResponse);
          logger.trace(`RequestScheduler.subscribeCube(): Successfully subscribed to ${key.keyString} on peer ${peer.toString()}`);
        } else {
          logger.warn(`RequestScheduler.subscribeCube(): Subscription to ${key.keyString} was rejected by peer ${peer.toString()}`);
        }
      } else {
        logger.warn(`RequestScheduler.subscribeCube(): No response or timeout from peer ${peer.toString()} for subscription to ${key.keyString}`);
      }
    }
    
    // Check if at least one subscription succeeded
    if (successfulPeers.length === 0) {
      logger.warn(`RequestScheduler.subscribeCube(): All subscription attempts failed for ${key.keyString}`);
      return undefined;
    }
    
    logger.trace(`RequestScheduler.subscribeCube(): Successfully subscribed to ${key.keyString} on ${successfulPeers.length} full nodes`);

    // For notification subscriptions, whitelist all successful peers to accept unsolicited KeyResponse messages
    // This is needed because notification cubes have different keys than the notification key subscribed to
    if (options.type === MessageClass.SubscribeNotifications) {
      for (let i = 0; i < successfulPeers.length; i++) {
        this.expectKeyResponse(successfulPeers[i], successfulResponses[i].subscriptionDuration);
      }
    }

    // Use the minimum subscription duration among all successful responses for consistency
    const minSubscriptionDuration = Math.min(...successfulResponses.map(resp => resp.subscriptionDuration));

    // Register this subscription
    const sub: CubeSubscription = new CubeSubscription(
      minSubscriptionDuration,
      { key: key.binaryKey },
    );
    sub.subscribedPeers = successfulPeers; // Store all successful peers
    subMap.set(key.keyString, sub);

    // Turn on auto-renewal by default
    sub.sup.shallRenew = true;
    // Auto-renewal shall take place before the subscription expires;
    // as early as the user specified, but no earlier than halfway through
    // the subscription period.
    const beforeExpiryMillis = Math.min(
      options.renewSubscriptionsBeforeExpiryMillis,  // when specified
      minSubscriptionDuration / 2  // but no earlier than halfway through
    );
    const renewAfterMillis = minSubscriptionDuration - beforeExpiryMillis;

    // Set up renewal
    // maybe TODO handle renewals internally within CubeSubscription?
    sub.renewalTimeout = setTimeout(() => {
      // Only renew if the subscription has not been overwritten or deleted yet
      const registered: CubeSubscription = subMap.get(key.keyString);
      if (registered === sub && registered.sup.shallRenew === true) {
        this.subscribeCube(key.binaryKey as CubeKey, { ...options, thisIsARenewal: true });
      }
    }, renewAfterMillis);

    // Clean up subscription after it expires,
    // but only if it has not been renewed or overwritten yet
    sub.promise.then(() => {
      const registered: CubeSubscription = subMap.get(key.keyString);
      if (registered === sub) subMap.delete(key.keyString)

    });

    return sub;
  }

  subscribeNotifications(
      key: NotificationKey,
      options: CubeSubscribeOptions = {},
  ): Promise<CubeSubscription> {
    return this.subscribeCube(
      key as unknown as CubeKey,  // HACKHACK, CubeKey and NotificationKey have the same format
      { ...options, type: MessageClass.SubscribeNotifications },
    );
  }


  /**
   * Removes a Cube subscription
   * Note: We currently can't actually cancel a subscription with a remote node.
   * What this currently does is to cancel the renewal once the current
   * subscription period expires.
   */
  cancelCubeSubscription(keyInput: CubeKey | string): void {
    const key = keyVariants(keyInput);
    const sub: CubeSubscription = this.subscribedCubes.get(key.keyString);
    if (sub !== undefined) sub.sup.shallRenew = false;
    this.subscribedCubes.delete(key.keyString);
  }
  /**
   * Removes a notification subscription
   * Note: We currently can't actually cancel a subscription with a remote node.
   * What this currently does is to cancel the renewal once the current
   * subscription period expires.
   */
  cancelNotificationSubscription(keyInput: NotificationKey | string): void {
    const key = keyVariants(keyInput);
    const sub: CubeSubscription = this.subscribedNotifications.get(key.keyString);
    if (sub !== undefined) sub.sup.shallRenew = false;
    this.subscribedNotifications.delete(key.keyString);
  }

  handleSubscriptionConfirmation(msg: SubscriptionConfirmationMessage, fromPeer?: NetworkPeerIf): void {
    // fetch the pending request using peer-specific key if peer is provided
    const keyBlob = keyVariants(msg.requestedKeyBlob);
    let requestKey = keyBlob.keyString;
    
    // Try peer-specific key first if we have peer information
    if (fromPeer) {
      const peerSpecificKey = `${fromPeer.idString}-${keyBlob.keyString}`;
      if (this.pendingSubscriptionConfirmations.has(peerSpecificKey)) {
        requestKey = peerSpecificKey;
      }
    }
    
    const req: SubscriptionRequest = this.pendingSubscriptionConfirmations.get(requestKey);
    if (req !== undefined) {
      // mark the request fulfilled
      req.fulfilled(msg);
      // and remove from pending set
      this.pendingSubscriptionConfirmations.delete(requestKey);
    } else {
      // no such request -- this is either a bug or the remote node is confused
      logger.trace(`RequestScheduler.handleSubscriptionConfirmation(): Received confirmation for unknown request with key blob ${keyBlob.keyString} from peer ${fromPeer?.toString() ?? 'unknown'}`);
    }
  }

  cubeAlreadyRequested(
      keyInput: CubeKey | string,
      includeSubscriptions: boolean = true,
  ): boolean {
    const key = keyVariants(keyInput);

    let req: CubeRequest | CubeSubscription =
      this.requestedCubes.get(key.keyString);
    if (!req && includeSubscriptions) {
      req = this.subscribedCubes.get(key.keyString);
    }
    if (req) return true;
    else return false;
  }

  cubeAlreadySubscribed(keyInput: CubeKey | string): boolean {
    return this.subscribedCubes.has(keyVariants(keyInput).keyString);
  }

  notificationsAlreadyRequested(
    recipientKey: CubeKey | string,
    includeSubscriptions: boolean = true,
  ): boolean {
    const key = keyVariants(recipientKey);

    // Consider direct notification requests first
    let req: CubeRequest | CubeSubscription =
      this.requestedNotifications.get(key.keyString);
    // Also consider active subscriptions when requested
    if (!req && includeSubscriptions) {
      req = this.subscribedNotifications.get(key.keyString);
    }
    // And consider indirect (KeyRequest) notification requests
    if (!req) {
      req = this.expectedNotifications.get(key.keyString);
    }
    return !!req;
  }

  notificationsAlreadySubscribed(recipientKey: NotificationKey | string): boolean {
    return this.subscribedNotifications.has(keyVariants(recipientKey).keyString);
  }

  existingCubeRequest(keyInput: CubeKey | string): Promise<CubeInfo> {
    return this.cubeRequestDetails(keyInput)?.promise;
  }

  /**
   * This method exposes internal status and should usually not be used
   * by applications.
   * @returns The PendingRequest object for the specified key, or undefined if
   *   no such request was made.
   */
  cubeRequestDetails(keyInput: CubeKey | string): CubeRequest {
    const key = keyVariants(keyInput);
    return this.requestedCubes.get(key.keyString);
  }
  /**
   * This method exposes internal status and should usually not be used
   * by applications.
   * @returns The PendingRequest object for the specified key, or undefined if
   *   no such request was made.
   */
  cubeSubscriptionDetails(keyInput: CubeKey | string): CubeSubscription {
    const key = keyVariants(keyInput);
    return this.subscribedCubes.get(key.keyString);
  }
  notificationSubscriptionDetails(keyInput: NotificationKey | string): CubeSubscription {
    const key = keyVariants(keyInput);
    return this.subscribedNotifications.get(key.keyString);
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
  // TODO refactor: accept an option object rather than the current parameter list
  requestNotifications(
    recipientKey: Buffer,
    scheduleIn: number = this.options.interactiveRequestDelay,
    timeout: number = this.options.requestTimeout,
    directCubeRequest: boolean = false,
  ): Promise<CubeInfo> {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return Promise.resolve(undefined);
    const key = keyVariants(recipientKey);  // normalise input

    // Create request object
    const req = new CubeRequest(timeout, { key: key.binaryKey as CubeKey });

    // Based on what our caller requested, either request notifications Cubes
    // directly, or indirectly through a KeyRequest.
    if (directCubeRequest) {
      logger.trace(`RequestScheduler.requestNotifications(): Planning notification request for ${key.keyString} in direct CubeRequest mode`);
      // In direct mode, remember this request in requestedNotifications so it
      // will be batched and sent as a direct NotificationRequest by
      // performCubeRequest().
      this.requestedNotifications.set(key.keyString, req);
      // Directly send a CubeRequest. This makes sense if we don't have any
      // notifications for this recipient yet.
      this.scheduleCubeRequest(scheduleIn);  // schedule request
      return req.promise;  // return result eventually
    } else {
      logger.trace(`RequestScheduler.requestNotifications(): Planning notification request for ${key.keyString} in indirect KeyRequest mode`);
      // Start with a KeyRequest only. This makes sense if we already have (a lot of)
      // notifications for this recipient and want to avoid redownloading them all.
      // IMPORTANT: Do NOT also add to requestedNotifications here; otherwise a
      // subsequent performCubeRequest() will send a direct NotificationRequest
      // in addition to the KeyRequest, leading to duplicate deliveries.
  this.expectedNotifications.set(key.keyString, req);
      const filter: CubeFilterOptions = {
        notifies: key.binaryKey as NotificationKey,
      }
  // Keep KeyResponse whitelisting alive for the duration of this request's timeout
  this.performKeyRequest(undefined, filter, timeout);
      // KeyResponse will automatically be handled in handleKeysOffered()
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
      // logger.trace(`RequestScheduler.scheduleCubeRequest(): scheduled next Cube request in ${millis} ms`);
    } else {
      // logger.trace(`RequestScheduler.scheduleCubeRequest(): I was called to schedule the next request in ${millis}ms, but there's already one scheduled in ${this.cubeRequestTimer.getRemainingTime()}ms`);
    }
    return true;
  }

  scheduleKeyRequest(millis: number = undefined): boolean {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return false;

    if (this.options.lightNode) {
      logger.info(`RequestScheduler.scheduleKeyRequest() called as a light node, this is wrong; doing nothing`);
      return false;
    }
    if (millis === undefined) {
      millis = this.options.requestInterval * this.calcRequestScaleFactor();
    }
    if (this.keyRequestTimer.set(millis)) {
      // logger.trace(`RequestScheduler.scheduleKeyRequest(): scheduled next key request in ${millis} ms`);
    } else {
      // logger.trace(`RequestScheduler.scheduleKeyRequest(): I was called to schedule the next request in ${millis}ms, but there's already one scheduled in ${this.keyRequestTimer.getRemainingTime()}ms`);
    }
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
              incomingCubeInfo.date, incomingCubeInfo.difficulty, currentEpoch)) {
          logger.info(`RequestScheduler.handleKeysOffered(): Was offered cube hash outside of retention policy by peer ${offeringPeer.toString()}, ignoring.`);
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

    const delivered: Cube[] = [];
    for (const binaryCube of binaryCubes) {
      // first of all, activate this Cube
      const cube = this.networkManager.cubeStore.activateCube(binaryCube);
      if (cube === undefined) {
        logger.trace(`RequestScheduler.handleCubesDelivered(): Ignoring an invalid Cube delivered by ${offeringPeer.toString()}`);
        continue;  // drop this Cube if it's not valid
      }
      const keyString = await cube.getKeyString();

      // If we're a light node, check if we're even interested in this Cube
      if (this.options.lightNode) {
        // is this a notification Cube?
        const notify: CubeKey = asCubeKey(cube.getFirstField(CubeFieldType.NOTIFY)?.value);

        // We're only interested if we have subscribed or requested this very
        // Cube, or if it notifies a notification key we're interested in
        if (!(this.cubeAlreadyRequested(keyString)) &&  // included subscriptions
            (
              !notify ||
              !(this.notificationsAlreadyRequested(notify))
            )
        ){
          logger.trace(`RequestScheduler.handleCubesDelivered(): Ignoring Cube ${keyString} from peer ${offeringPeer.toString()} as we do not seem to have requested it`);
          continue;  // drop this Cube, we're not interested in it
        }
      }

      // Add the cube to the CubeStorage
      // Grant this peer local reputation if cube is accepted.
      // TODO BUGBUG: This currently grants reputation score for duplicates,
      // which is absolutely contrary to what we want :'D
      logger.trace(`RequestScheduler.handleCubesDelivered(): Accepting Cube ${keyString} delivered by ${offeringPeer.toString()}`);
      const value = await this.networkManager.cubeStore.addCube(cube, {
        autoIncrementPmuc: false,  // never manipulate Cubes received from peers
      });
      if (value) { offeringPeer.scoreReceivedCube(value.getDifficulty()); }

      // Check if this delivery fulfils a pending Cube request
      const keyStrings: string[] = [keyString, offeringPeer.idString + keyString];
      this.cubeRequestFulfilled(keyStrings, await cube.getCubeInfo());  // TODO get rid of CubeInfo and pass Cube directly

      delivered.push(cube);
    }

    // Check if this delivery fulfils a pending notification request
    // Note: In contrast to a Cube request -- which is a well defined thing and
    //   can only be fulfilled by delivery of that exact Cube, a notification
    //   request is a rather fuzzy thing as there may be any number of
    //   notifications for a given notification key.
    //   In fact, the line between a "notification request" and a
    //   "notification subscription" is a rather blurry one.
    //   We currently mark a notification request as completed as soon as we
    //   receive any delivery containing a Cube for that notification key.

    for (const cube of delivered) {
      const recipientKey: Buffer =
        cube.getFirstField(CubeFieldType.NOTIFY)?.value;

      // does this fulfill a notification request in direct, i.e. CubeRequest mode?
      if (recipientKey) {
        const directNotificationRequest: CubeRequest = this.requestedNotifications.get(keyVariants(recipientKey).keyString);
        if (directNotificationRequest) {
          directNotificationRequest.fulfilled(await cube.getCubeInfo());  // TODO get rid of CubeInfo and pass Cube directly
          // Note: Not removing the request as it appears wise to accept
          //   further notification for this request's timeout period.
          // this.requestedNotifications.delete(await cube.getKeyString());
        }
      }

      // does this fulfill a notification request in indirect, i.e. KeyRequest mode?
      if (recipientKey) {
        const indirectNotificationRequest: CubeRequest = this.expectedNotifications.get(keyVariants(recipientKey).keyString);
        if (indirectNotificationRequest) {
          indirectNotificationRequest.fulfilled(await cube.getCubeInfo());  // TODO get rid of CubeInfo and pass Cube directly
          // Note: Not removing the request as it appears wise to accept
          //   further notification for this request's timeout period.
          // this.expectedNotifications.delete(await cube.getKeyString());
        }
      }
    }

    // TODO: In case of an empty (i.e. negative) CubeResponse, we should identify
    //   the associated requests and mark them as failed, so they can be retried
    //   at a different peer. However, our crappy 1.0 wire format does not
    //   include any reference that would allow us to associate this response
    //   with its original request, and I'm not gonna touch the 1.0 wire format
    //   again because it's crappy.
  }

  // Implement Shuttable

  /**
   * Will be set to true when shutdown() is called. From this point forward,
   * our methods will refuse service on further calls.
   */
  private _shutdown: boolean = false;
  get shuttingDown(): boolean { return this._shutdown }
  private shutdownPromiseResolve: () => void;
  shutdownPromise: Promise<void> =
    new Promise(resolve => this.shutdownPromiseResolve = resolve);

  shutdown(): Promise<void> {
    this._shutdown = true;
    this.shutdownPromiseResolve();
    this.cubeRequestTimer.clear();
    this.keyRequestTimer.clear();
    this.networkManager.cubeStore.removeListener("cubeAdded", this.cubeAddedHandler);
    for (const [key, req] of this.requestedCubes) req.shutdown();
    for (const [key, req] of this.requestedNotifications) req.shutdown();
    for (const [key, req] of this.expectedNotifications) req.shutdown();
    for (const [key, req] of this.subscribedCubes) req.shutdown();
    for (const [key, req] of this.subscribedNotifications) req.shutdown();
    for (const [peer, timeout] of this.expectedKeyResponses) timeout.clear();
    return this.shutdownPromise;
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
      // TODO: this may cause the same (unfulfillable) requests over and over
      //   again until they time out, ignoring any other requests that might
      //   be queued
      if (keys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
      if (!req.networkRequestRunning) {
        keys.push(req.sup.key as CubeKey);
        req.requestSent(peerSelected).then(() => {
          this.scheduleCubeRequest();  // schedule retry after network timeout
        });
      }
    }
    if (keys.length > 0) {
      logger.trace(`RequestScheduler.performRequest(): requesting ${keys.length} Cubes from ${peerSelected.toString()}`);
      peerSelected.sendCubeRequest(keys);
    }
    // Note: The cube response will currently still be directly handled by the
    // NetworkPeer. This should instead also be controlled by the RequestScheduler.

    // request notifications
    const notificationKeys: NotificationKey[] = [];
    for (const [keystring, req] of this.requestedNotifications) {
      if (notificationKeys.length >= NetConstants.MAX_CUBES_PER_MESSAGE) break;
      if (!req.networkRequestRunning) {
        notificationKeys.push(req.sup.key as NotificationKey);
        req.requestSent(peerSelected).then(() => {
          this.scheduleCubeRequest();  // schedule retry after network timeout
        })
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

  private performKeyRequest(
    peerSelected?: NetworkPeerIf,
    options: CubeFilterOptions = {},
    expectedResponseTimeout?: number,
  ): void {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // select a peer to send request to, unless we were told to use a specific one
    if (peerSelected === undefined) peerSelected =
      this.options.requestStrategy.select(this.networkManager.onlinePeers);
    if (peerSelected === undefined) {
      logger.debug('RequestScheduler.performKeyRequest(): Could not find a suitable peer; doing nothing.');
      return;
    }

  if (this.options.lightNode) this.expectKeyResponse(peerSelected, expectedResponseTimeout ?? Settings.NETWORK_TIMEOUT);

    // We will now translate the supplied filter options to our crappy
    // non-orthogonal 1.0 wire format. Non-fulfillable requests will be
    // ignored. Hopefully we can get rid of this crap once we introduce a
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

    // NOTE: must use arrow syntax to have this event handler pre-bound;
    //  otherwise, event subscription will not properly cancel on close
  private cubeAddedHandler: (cubeInfo: CubeInfo) => void = cubeInfo => {
    // do not accept any calls if this scheduler has already been shut down
    if (this._shutdown) return;

    // does this fulfil a Cube request?
    // note: This is duplicates what we already do in handleCubesDelivered(),
    //       maybe remove it here? Possible rationale for leaving it in might be
    //       that it ensures a request gets fulfilled even if a new Cube is
    //       smuggled in without this scheduler noticing.
    this.cubeRequestFulfilled([cubeInfo.keyString], cubeInfo);
  }

  private cubeRequestFulfilled(keyStrings: string[], cubeInfo: CubeInfo): void {
    for (const keyString of keyStrings) {
      const req = this.requestedCubes.get(keyString);
      if (req !== undefined) {
        // mark the request fulfilled
        req.fulfilled(cubeInfo);  // maybe TODO: avoid creating duplicate CubeInfo
        // note: removing the request from requestedCube happens through a
        //  separate event handler set up in requestCube()
      }
    }
  }
}
