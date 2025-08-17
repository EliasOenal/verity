import { Settings } from "../../../../src/core/settings";
import { Cube } from "../../../../src/core/cube/cube";
import { CubeKey, CubeType } from "../../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeStore } from "../../../../src/core/cube/cubeStore";
import { CubeSubscription } from "../../../../src/core/networking/cubeRetrieval/pendingRequest";
import { RequestScheduler } from "../../../../src/core/networking/cubeRetrieval/requestScheduler";
import { NetConstants } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManagerIf } from "../../../../src/core/networking/networkManagerIf";
import { SubscriptionConfirmationMessage, SubscriptionResponseCode } from "../../../../src/core/networking/networkMessage";
import { NetworkPeerIf } from "../../../../src/core/networking/networkPeerIf";
import { DummyNetworkManager } from "../../../../src/core/networking/testingDummies/dummyNetworkManager";
import { DummyNetworkPeer } from "../../../../src/core/networking/testingDummies/dummyNetworkPeer";
import { PeerDB } from "../../../../src/core/peering/peerDB";
import { requiredDifficulty, testCoreOptions } from "../../testcore.definition";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('RequestScheduler subscribeCube() tests', () => {
  describe.each([
    true,
    false,
  ])('tests run as both full and light node', (lightNode) => {
      let scheduler: RequestScheduler;
      let cubeStore: CubeStore;
      let dummyNetworkManager: NetworkManagerIf;
      let dummyPeer: NetworkPeerIf;

      beforeEach(async () => {
        // Create a CubeStore
        // note: copying cubeStoreOptions here so we can manipulate them
        // within the tests without affecting subsequent tests
        cubeStore = new CubeStore(Object.assign({}, testCoreOptions));
        await cubeStore.readyPromise;

        // Create a dummy NetworkManager and a RequestScheduler
        dummyNetworkManager = new DummyNetworkManager(cubeStore, new PeerDB(), {
          lightNode: lightNode,  // test will be run for both cases
          requestInterval: 50,  // running requests 20 times per second totally is a sensible idea
          requestScaleFactor: 4,  // = default value at the time of writing these tests
        });
        scheduler = dummyNetworkManager.scheduler;

        // having a mock peer
        dummyPeer = new DummyNetworkPeer(dummyNetworkManager);
        scheduler.networkManager.outgoingPeers = [dummyPeer];
      });

      afterEach(async () => {
        vi.clearAllMocks();
        await cubeStore.shutdown();
        scheduler.shutdown();
      });

    describe(`subscribeCube() as a ${lightNode? 'light node':'full node'}`, () => {
      if (lightNode) {
        describe('regular workflow', () => {
          it('sends a subscription request to any connected peer', async() => {
            // prepare test Cube
            const cube = Cube.Create({
              fields: CubeField.RawContent(CubeType.PIC, "Cubus sum"),
              cubeType: CubeType.PIC, requiredDifficulty,
            });
            const testKey = await cube.getKey();
            // For this test, we assume that the Cube is already present locally
            await cubeStore.addCube(cube);
            // prepare spy
            const sendSubscribeCube = vi.spyOn(dummyPeer, 'sendSubscribeCube');

            // make request
            const subPromise: Promise<CubeSubscription> = scheduler.subscribeCube(testKey);

            // mock peer response
            const resp = new SubscriptionConfirmationMessage(
              SubscriptionResponseCode.SubscriptionConfirmed,
              [testKey], [await cube.getHash()], Settings.CUBE_SUBSCRIPTION_PERIOD
            );
            scheduler.handleSubscriptionConfirmation(resp, dummyPeer);

            await subPromise;
            // expect subscription to be registered
            expect(scheduler.cubeAlreadySubscribed(testKey)).toBe(true);

            // expect request to have been sent
            expect(sendSubscribeCube).toHaveBeenCalledTimes(1);
            expect(sendSubscribeCube.mock.lastCall![0]).toContainEqual(testKey);
          });

          it('will subscribe without automatically requesting missing cubes', async() => {
            // prepare test Cube
            const cube = Cube.Create({
              fields: CubeField.RawContent(CubeType.PIC, "Cubus sum"),
              cubeType: CubeType.PIC, requiredDifficulty,
            });
            const testKey = await cube.getKey();

            // prepare spy
            const sendSubscribeCube = vi.spyOn(dummyPeer, 'sendSubscribeCube');

            // make subscription request (cube is not present locally)
            const subPromise: Promise<CubeSubscription> = scheduler.subscribeCube(testKey);

            // Give the subscription request time to be registered
            await new Promise(resolve => setTimeout(resolve, 10));

            // mock peer response to subscription request
            const resp = new SubscriptionConfirmationMessage(
              SubscriptionResponseCode.SubscriptionConfirmed,
              [testKey], [await cube.getHash()], Settings.CUBE_SUBSCRIPTION_PERIOD
            );
            scheduler.handleSubscriptionConfirmation(resp, dummyPeer);

            await subPromise;

            // Assert that NO cube request was automatically scheduled
            // (the new behavior is that subscribeCube does not implicitly call requestCube)
            const implicitCubeRequest = scheduler.existingCubeRequest(testKey);
            expect(implicitCubeRequest).toBeFalsy();

            // Assert that the subscription has been registered successfully
            expect(scheduler.cubeAlreadySubscribed(testKey)).toBe(true);

            // Assert that the subscription request was sent
            expect(sendSubscribeCube).toHaveBeenCalledTimes(1);
            expect(sendSubscribeCube.mock.lastCall![0]).toContainEqual(testKey);
          });

          it('will auto-renew a subscription before it times out', async() => {
            // prepare test Cube
            const cube = Cube.Create({
              fields: CubeField.RawContent(CubeType.PIC, "Cubus sum"),
              cubeType: CubeType.PIC, requiredDifficulty,
            });
            const testKey = await cube.getKey();
            // For this test, we assume that the Cube is already present locally
            await cubeStore.addCube(cube);
            // prepare spy
            const sendSubscribeCube = vi.spyOn(dummyPeer, 'sendSubscribeCube');

            // make request
            const subPromise: Promise<CubeSubscription> = scheduler.subscribeCube(testKey);

            // mock peer response, and make the subscription period very short
            const resp = new SubscriptionConfirmationMessage(
              SubscriptionResponseCode.SubscriptionConfirmed,
              [testKey], [await cube.getHash()], 100
            );
            scheduler.handleSubscriptionConfirmation(resp, dummyPeer);

            // expect mock peer to have received one subscription request
            expect(sendSubscribeCube).toHaveBeenCalledTimes(1);
            expect(sendSubscribeCube.mock.lastCall![0]).toContainEqual(testKey);

            // expect subscription to be registered
            const sub: CubeSubscription = await subPromise;
            expect(sub).toBeInstanceOf(CubeSubscription);
            expect(scheduler.cubeSubscriptionDetails(testKey)).toBe(sub);

            // wait for subscription to time out
            await sub.promise;

            // mock peer response to renewal request
            const renewalResp = new SubscriptionConfirmationMessage(
              SubscriptionResponseCode.SubscriptionConfirmed,
              [testKey], [await cube.getHash()], Settings.CUBE_SUBSCRIPTION_PERIOD
            );
            scheduler.handleSubscriptionConfirmation(renewalResp, dummyPeer);

            // yield control to allow subscription renewal to be processed
            await new Promise(resolve => setTimeout(resolve, 100));

            // expect a new subscription to have been created
            const newSub: CubeSubscription = scheduler.cubeSubscriptionDetails(testKey);
            expect(newSub).toBeInstanceOf(CubeSubscription);
            expect(newSub).not.toBe(sub);

            // expect mock peer to now have received a total of two subscription
            // requests, the original one and the renewal
            // (mock peer is the only peer in this test)
            expect(sendSubscribeCube).toHaveBeenCalledTimes(2);
            expect(sendSubscribeCube.mock.lastCall![0]).toContainEqual(testKey);
          });
        });  // regular workflow

        describe('error handling', () => {
          it.todo('will not renew a subscription earlier than halfway through the subscription period', async() => {
            // prepare test Cube
            const cube = Cube.Create({
              fields: CubeField.RawContent(CubeType.PIC, "Cubus sum"),
              cubeType: CubeType.PIC, requiredDifficulty,
            });
            const testKey = await cube.getKey();
            // For this test, we assume that the Cube is already present locally
            await cubeStore.addCube(cube);

            // make request
            const subPromise: Promise<CubeSubscription> = scheduler.subscribeCube(testKey, {
              renewSubscriptionsBeforeExpiryMillis: 1000,
            });

            // mock peer response, and make the subscription period very short
            const resp = new SubscriptionConfirmationMessage(
              SubscriptionResponseCode.SubscriptionConfirmed,
              [testKey], [await cube.getHash()], 100
            );
            scheduler.handleSubscriptionConfirmation(resp, dummyPeer);

            // expect renewal time to be set to halfway through the subscription period,
            // rather than the user-defined value

            // TODO expose this through the API and then obviously
            // TODO test it :)
          });

          it.todo('write more tests');
        });
      }  // light node

      if (!lightNode) {
        it('should ignore subscription requests when running as a full node', () => {  // TODO is this actually something we want to assert?
          scheduler.options.lightNode = false;
          const testKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42) as CubeKey;
          scheduler.subscribeCube(testKey);
          // @ts-ignore spying on private attribute
          expect(scheduler.subscribedCubes).not.toContainEqual(testKey);
        });
      }
    });  // subscribeCube()
  });  // tests run as both full and light node
});
