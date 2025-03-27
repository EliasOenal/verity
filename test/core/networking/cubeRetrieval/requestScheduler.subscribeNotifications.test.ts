import { Settings } from "../../../../src/core/settings";
import { Cube } from "../../../../src/core/cube/cube";
import { CubeType } from "../../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeStore } from "../../../../src/core/cube/cubeStore";
import { CubeSubscription } from "../../../../src/core/networking/cubeRetrieval/pendingRequest";
import { RequestScheduler } from "../../../../src/core/networking/cubeRetrieval/requestScheduler";
import { MessageClass, NetConstants, SupportedTransports } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../../src/core/networking/networkManagerIf";
import { SubscribeNotificationsMessage, SubscriptionConfirmationMessage, SubscriptionResponseCode } from "../../../../src/core/networking/networkMessage";
import { NetworkPeerIf } from "../../../../src/core/networking/networkPeerIf";
import { DummyNetworkManager } from "../../../../src/core/networking/testingDummies/dummyNetworkManager";
import { DummyNetworkPeer } from "../../../../src/core/networking/testingDummies/dummyNetworkPeer";
import { PeerDB } from "../../../../src/core/peering/peerDB";
import { requiredDifficulty, testCoreOptions } from "../../testcore.definition";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { NetworkManager } from "../../../../src/core/networking/networkManager";
import { DummyNetworkTransport } from "../../../../src/core/networking/testingDummies/dummyNetworkTransport";

const SHORTENED_SUB_PERIOD = 100;

describe('RequestScheduler subscribeNotifications() tests', () => {
let scheduler: RequestScheduler;
let cubeStore: CubeStore;
let dummyNetworkManager: NetworkManagerIf;
let dummyPeer: DummyNetworkPeer;
let sub: CubeSubscription;

const notificationKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42);
const zeroKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x00);

  describe('regular workflow', () => {
    beforeAll(async () => {
      // Create a CubeStore
      // note: copying cubeStoreOptions here so we can manipulate them
      // within the tests without affecting subsequent tests
      cubeStore = new CubeStore(Object.assign({}, testCoreOptions));
      await cubeStore.readyPromise;

      // Create a dummy NetworkManager and a RequestScheduler
      dummyNetworkManager = new DummyNetworkManager(cubeStore, new PeerDB(), {
        lightNode: true,
      });
      scheduler = dummyNetworkManager.scheduler;

      // having a mock peer
      dummyPeer = new DummyNetworkPeer(dummyNetworkManager);
      scheduler.networkManager.outgoingPeers = [dummyPeer];

      // make subscripton request
      const subPromise: Promise<CubeSubscription> = scheduler.subscribeNotifications(notificationKey);

      // mock peer response, and make the subscription period very short
      const resp = new SubscriptionConfirmationMessage(
        SubscriptionResponseCode.SubscriptionConfirmed,
        [notificationKey], [zeroKey], SHORTENED_SUB_PERIOD,
      );
      scheduler.handleSubscriptionConfirmation(resp);

      // wait for subscription request to return
      sub = await subPromise;
  });

    afterAll(async () => {
      await cubeStore.shutdown();
      scheduler.shutdown();
    });

    it('will register the subscription', () => {
      expect(scheduler.notificationsAlreadySubscribed(notificationKey)).toBe(true);
      expect(scheduler.notificationSubscriptionDetails(notificationKey)).toBe(sub);
      expect(sub.sup!.key.equals(notificationKey)).toBe(true);
    });

    it('sends a subscription request to any connected peer', () => {
      expect(dummyPeer.sentMessages.length).toBe(1);
      expect(dummyPeer.sentMessages[0].type).toBe(MessageClass.SubscribeNotifications);
      expect(Array.from((dummyPeer.sentMessages[0] as SubscribeNotificationsMessage).cubeKeys())[0].
        equals(notificationKey)).toBe(true);
    });

    it('will ignore duplicate calls', async () => {
      // spuriously request duplicate subscription
      const subPromise: Promise<CubeSubscription> = scheduler.subscribeNotifications(notificationKey);
      await subPromise;

      // expect the registered subscription to not have changed
      expect(scheduler.notificationsAlreadySubscribed(notificationKey)).toBe(true);
      expect(scheduler.notificationSubscriptionDetails(notificationKey)).toBe(sub);

      // expect the subscription request to not have been sent again
      expect(dummyPeer.sentMessages.length).toBe(1);
    });


    it('will auto-renew a subscription once it expires', async() => {
      // wait for subscription to time out
      await sub.promise;
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

      // Expect mock peer to now have received a grand total of two subscription
      // requests for notificationKey, the original one and the renewal
      const reqs = dummyPeer.sentMessages.filter(m => m.type === MessageClass.SubscribeNotifications);
      expect(reqs.length).toBe(2);
      expect(Array.from((reqs[0] as SubscribeNotificationsMessage).cubeKeys())[0]
        .equals(notificationKey)).toBe(true);
      expect(Array.from((reqs[1] as SubscribeNotificationsMessage).cubeKeys())[0]
        .equals(notificationKey)).toBe(true);

      // mock peer response to renewal request
      const renewalResp = new SubscriptionConfirmationMessage(
        SubscriptionResponseCode.SubscriptionConfirmed,
        [notificationKey], [zeroKey], SHORTENED_SUB_PERIOD,
      );
      scheduler.handleSubscriptionConfirmation(renewalResp);

      // yield control to allow subscription renewal to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // expect a new subscription to have been created
      const newSub: CubeSubscription = scheduler.notificationSubscriptionDetails(notificationKey);
      expect(newSub).toBeInstanceOf(CubeSubscription);
      expect(newSub).not.toBe(sub);
    });

    // NOTE: This test must always come last as it lets the subscription expire!
    it('will clean up subscriptions after they expire if renewal is disabled', async() => {
      // disable auto-renew
      const currentSub = scheduler.notificationSubscriptionDetails(notificationKey);
      currentSub.sup!.shallRenew = false;

      // wait for subscription to time out
      await currentSub.promise;
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

      // expect the subscription to have been removed
      expect(scheduler.notificationSubscriptionDetails(notificationKey)).toBeUndefined();
      expect(scheduler.notificationsAlreadySubscribed(notificationKey)).toBe(false);
    });
  });  // regular workflow

  describe('error handling', () => {
    it.todo('write tests');
  });
});
