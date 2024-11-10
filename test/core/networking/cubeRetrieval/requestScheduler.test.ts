import type { NetworkManagerIf } from "../../../../src/core/networking/networkManagerIf";

import { CubeInfo } from "../../../../src/core/cube/cubeInfo";
import { NetConstants } from "../../../../src/core/networking/networkDefinitions";
import { RequestScheduler } from "../../../../src/core/networking/cubeRetrieval/requestScheduler";
import { Cube } from "../../../../src/core/cube/cube";

import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeFieldType, CubeKey, CubeType } from "../../../../src/core/cube/cube.definitions";
import { CubeStore, CubeStoreOptions } from "../../../../src/core/cube/cubeStore";
import { NetworkPeerIf } from 'core/networking/networkPeerIf';
import { unixtime } from "../../../../src/core/helpers/misc";

import { DummyNetworkManager } from "../../../../src/core/networking/testingDummies/networkManagerDummy";
import { DummyNetworkPeer } from '../../../../src/core/networking/testingDummies/networkPeerDummy';

import { Settings } from "../../../../src/core/settings";
import { PeerDB } from "../../../../src/core/peering/peerDB";

import { vi } from 'vitest'
import { SubscriptionConfirmationMessage, SubscriptionResponseCode } from "../../../../src/core/networking/networkMessage";

const reducedDifficulty = 0;

const cubeStoreOptions: CubeStoreOptions = {
  inMemory: true,
  requiredDifficulty: reducedDifficulty,
  enableCubeRetentionPolicy: false,
  dbName: 'cubes.test',
  dbVersion: 1,
};

describe('RequestScheduler', () => {
  describe.each([
    true,
    false,
  ])('tests run as both full and light node', (lightNode) => {
  describe('mock-based unit tests (custom)', () => {
    let scheduler: RequestScheduler;
    let cubeStore: CubeStore;
    let dummyNetworkManager: NetworkManagerIf;
    let dummyPeer: NetworkPeerIf;

    const testKey = Buffer.from("01".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');
    const testKey2 = Buffer.from("02".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');
    const testKey3 = Buffer.from("03".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');

    beforeEach(async () => {
      // Create a CubeStore
      // note: copying cubeStoreOptions here so we can manipulate them
      // within the tests without affecting subsequent tests
      cubeStore = new CubeStore(Object.assign({}, cubeStoreOptions));
      await cubeStore.readyPromise;

      // Create a dummy NetworkManager and a RequestScheduler
      dummyNetworkManager = new DummyNetworkManager(cubeStore, new PeerDB(), undefined, {
        lightNode: lightNode,  // test will be run for both cases
        requestInterval: 50,  // running requests 20 times per second totally is a sensible idea
        requestScaleFactor: 4,  // default value a the time of writing these tests
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

    describe('requestCube()', () => {
      it(`should accept and fulfil a Cube request as a ${lightNode? 'light node':'full node'}`, async () => {
        // assert starting with no open requests
        expect((scheduler as any).requestedCubes.size).toEqual(0);  // spying on private attr
        // request a test Cube
        const cube = testCube();
        const promise = scheduler.requestCube(await cube.getKey());
        expect((scheduler as any).requestedCubes.size).toEqual(1);  // spying on private attr

        // simulate successful network retrieval by adding Cube
        await scheduler.networkManager.cubeStore.addCube(cube);

        const result = await promise;
        expect(result.key.equals(await cube.getKey())).toBeTruthy();
        // @ts-ignore spying on private attr
        expect(scheduler.requestedCubes.size).toEqual(0);
      });

      it('should return undefined when Cube requests time out', async () => {
        const promise = scheduler.requestCube(testKey, {scheduleIn: 0, timeout: 10});  // I fully expect you to fetch my Cube in 10ms
        expect(promise).resolves.toBeUndefined();
      });

      it.todo('should request a Cube from another node if first request fails');
      // (must keep track of nodes already requested from I guess)

      it.todo('should never request a Cube from two nodes at once, not even as a full node');

      it('can request from a user-defined node', async() => {
        // create some more mock peers
        const dummyPeer2 = new DummyNetworkPeer();
        const dummyPeer3 = new DummyNetworkPeer();
        const dummyPeer4 = new DummyNetworkPeer();
        const dummyPeer5 = new DummyNetworkPeer();
        scheduler.networkManager.outgoingPeers =
          [dummyPeer, dummyPeer2, dummyPeer3, dummyPeer4, dummyPeer5];

        // create a test Cube
        const cube = testCube();

        // request the Cube from a specific peer:
        // prepare spy
        const reqPeer1 = vi.spyOn(dummyPeer as any, 'sendCubeRequest');
        const reqPeer2 = vi.spyOn(dummyPeer2 as any, 'sendCubeRequest');
        const reqPeer3 = vi.spyOn(dummyPeer3 as any, 'sendCubeRequest');
        const reqPeer4 = vi.spyOn(dummyPeer4 as any, 'sendCubeRequest');
        const reqPeer5 = vi.spyOn(dummyPeer5 as any, 'sendCubeRequest');

        // perform request
        const promise = scheduler.requestCube(await cube.getKey(), {
          requestFrom: dummyPeer3, scheduleIn: 0, timeout: 100,
        });

        // simulate successful network retrieval by adding Cube
        await scheduler.networkManager.cubeStore.addCube(cube);
        const result = await promise;

        // ensure request was sent to the right peer
        expect(reqPeer1).not.toHaveBeenCalled();
        expect(reqPeer2).not.toHaveBeenCalled();
        expect(reqPeer3).toHaveBeenCalledTimes(1);
        expect(reqPeer4).not.toHaveBeenCalled();
        expect(reqPeer5).not.toHaveBeenCalled();
      });

      it.todo('properly cleans up pending requests');
    });

    describe(`requestNotification() as a ${lightNode? 'light node':'full node'}`, () => {
      it('should accept and fulfil a Notification request in direct Cube request mode', async () => {
        expect((scheduler as any).requestedNotifications.size).toEqual(0);  // spying on private attribute
        const promise: Promise<CubeInfo> = scheduler.requestNotifications(testKey, 0, undefined, true);
        expect((scheduler as any).requestedNotifications.size).toEqual(1);  // spying on private attribute

        // simulate successful network retrieval by adding a matching notification Cube
        const contentField: CubeField =
          CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis");
        const notification = Cube.Frozen({
          fields: [
            contentField,
            CubeField.Notify(testKey),
          ],
          requiredDifficulty: reducedDifficulty,
        })
        await scheduler.networkManager.cubeStore.addCube(notification);

        const result = await promise;
        expect(result.key).toEqual(notification.getKeyIfAvailable());
        expect(result.getCube().getFirstField(
          CubeFieldType.NOTIFY).value).toEqual(testKey);
        expect(result.getCube().getFirstField(
          CubeFieldType.FROZEN_NOTIFY_RAWCONTENT)).toEqual(contentField);
        expect((scheduler as any).requestedCubes.size).toEqual(0);  // spying on private attribute
      });
    });

    describe(`scheduleNextRequest() and performCubeRequest() as a ${lightNode? 'light node':'full node'}`, () => {
      it('should schedule CubeRequests', async () => {
        // prepare spies
        // note! we cannot spy on performCubeRequest() directly, because it is
        // not called directly as a method; instead it is called as a callback
        // from within cubeRequestTimer.
        const performCubeRequest = vi.spyOn((scheduler as any).cubeRequestTimer, 'callback');
        const sendCubeRequest = vi.spyOn(dummyPeer as any, 'sendCubeRequest');

        scheduler.requestCube(testKey);
        await new Promise(resolve => setTimeout(resolve, 200));  // give it some time
        expect(performCubeRequest).toHaveBeenCalled();
        expect(sendCubeRequest).toHaveBeenCalled();
      });

      // this is no longer current --
      // TODO: write tests for scheduleKeyRequest() and performKeyRequest()
      // it('should schedule KeyRequests in full mode', async () => {
      //   scheduler.options.lightNode = false;
      //   scheduler.requestCube(testKey);
      //   await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
      //   expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
      //     called).toEqual("sendKeyRequests");
      // });

      it(`should group together multiple Cube requests as a ${lightNode? 'light node':'full node'}`, async() => {
        // prepare spies
        const performCubeRequest = vi.spyOn((scheduler as any).cubeRequestTimer, 'callback');
        const sendCubeRequest = vi.spyOn(dummyPeer as any, 'sendCubeRequest');

        // Make a request. It should not be executed immediately, but
        // instead be grouped together with the next one below.
        scheduler.requestCube(testKey);

        await new Promise(resolve => setTimeout(resolve, 80));
        // still within interactive delay, should not have been called yet
        expect(performCubeRequest).not.toHaveBeenCalled();
        expect(sendCubeRequest).not.toHaveBeenCalled();

        // Make another request, expect both requests to be performed together.
        scheduler.requestCube(testKey2);
        // call should still be performed within the original 100ms
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(performCubeRequest).toHaveBeenCalledTimes(1);
        expect(sendCubeRequest).toHaveBeenCalledTimes(1);
      });

      it('should correctly calculate the request scale factor', () => {
        // mock one single online peer, thus no request scaling
        scheduler.networkManager.outgoingPeers = [new DummyNetworkPeer()];
        // @ts-ignore testing private method
        expect(scheduler.calcRequestScaleFactor()).toBe(1);

        // mock MAXIMUM_CONNECTIONS online peers, thus full request scaling
        scheduler.networkManager.outgoingPeers =
          Array(Settings.MAXIMUM_CONNECTIONS).fill(new DummyNetworkPeer());
        // @ts-ignore testing private method
        expect(scheduler.calcRequestScaleFactor()).toBe(0.25);
      });
    });

    describe(`subscribeCube() as a ${lightNode? 'light node':'full node'}`, () => {
      if (lightNode) {
        it('sends a subscription request to any connected peer', async() => {
          // set up test options
          scheduler.options.lightNode = true;
          // prepare test Cube
          const cube = testCube();
          const testKey = await cube.getKey();
          // For this test, we assume that the Cube is already present locally
          await cubeStore.addCube(cube);
          // prepare spy
          const sendSubscribeCube = vi.spyOn(dummyPeer, 'sendSubscribeCube');

          // make request
          const subPromise: Promise<void> = scheduler.subscribeCube(testKey);

          // mock peer response
          const resp = new SubscriptionConfirmationMessage(
            SubscriptionResponseCode.SubscriptionConfirmed,
            [testKey], [await cube.getHash()], Settings.CUBE_SUBSCRIPTION_PERIOD
          );
          scheduler.handleSubscriptionConfirmation(resp);

          await subPromise;
          // expect subscription to be registered
          expect(scheduler.isAlreadySubscribed(testKey)).toBe(true);

          // expect request to have been sent
          expect(sendSubscribeCube).toHaveBeenCalledTimes(1);
          expect(sendSubscribeCube.mock.lastCall[0]).toContainEqual(testKey);
        });

        it('will first request the Cube if not present locally', async() => {
          // set up test options
          scheduler.options.lightNode = true;
          // prepare test Cube
          const cube = testCube();
          const testKey = await cube.getKey();

          // prepare spy
          const sendSubscribeCube = vi.spyOn(dummyPeer, 'sendSubscribeCube');

          // make request
          const subPromise: Promise<void> = scheduler.subscribeCube(testKey);
          await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

          // Assert that a CubeRequest has been scheduled first
          // as the Cube is not yet present locally
          const preliminaryCubeRequest = scheduler.existingCubeRequest(testKey);
          expect(preliminaryCubeRequest).toBeTruthy();

          // Assert that the subscription has *not* been registered yet as the
          // preliminary CubeRequest is still running
          expect(scheduler.isAlreadySubscribed(testKey)).toBe(false);

          // mock response to preliminary CubeRequest
          scheduler.handleCubesDelivered([await cube.getBinaryData()], dummyPeer);
          const preliminaryCubeInfo = await preliminaryCubeRequest;
          expect(await preliminaryCubeInfo.getCube().getHash()).toEqual(await cube.getHash());
          // Yield control once again to allow the subscription to be registered
          await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

          // mock peer response
          const resp = new SubscriptionConfirmationMessage(
            SubscriptionResponseCode.SubscriptionConfirmed,
            [testKey], [await cube.getHash()], Settings.CUBE_SUBSCRIPTION_PERIOD
          );
          scheduler.handleSubscriptionConfirmation(resp);
          await subPromise;

          // Assert that the subscription has now been registered
          expect(scheduler.isAlreadySubscribed(testKey)).toBe(true);

          // Assert that the subscription request has been now been sent
          expect(sendSubscribeCube).toHaveBeenCalledTimes(1);
          expect(sendSubscribeCube.mock.lastCall[0]).toContainEqual(testKey);
        });
      }

      if (!lightNode) it('should ignore Cube requests when running as a full node', () => {  // TODO is this actually something we want to assert?
        scheduler.options.lightNode = false;
        scheduler.subscribeCube(testKey);
        // @ts-ignore spying on private attribute
        expect(scheduler.subscribedCubes).not.toContainEqual(testKey);
      });
    });  // subscribeCube()

    describe(`handleCubesOffered() as ${lightNode ? 'light node' : 'full node'}`, () => {
        it('should ignore cubes that do not meet the retention policy', async () => {
          await cubeStore.readyPromise;

          // set options for this test
          cubeStore.options.enableCubeRetentionPolicy = true;

          // sculpt a test Cube
          const date = 148302000;
          const oldCube: Cube = Cube.Frozen({
            fields: [
              CubeField.RawContent(CubeType.FROZEN, "Viva Malta Repubblika!"),
              CubeField.Date(date),
            ],
            requiredDifficulty: reducedDifficulty,
          });
          const oldCubeInfo: CubeInfo = await oldCube.getCubeInfo();
          expect(oldCubeInfo.date).toBe(date);

          // prepare to spy on method calls
          const performCubeRequest = vi.spyOn((scheduler as any).cubeRequestTimer, 'callback');
          const sendCubeRequest = vi.spyOn(dummyPeer as any, 'sendCubeRequest');

          // perform test
          await scheduler.handleKeysOffered([oldCubeInfo], dummyPeer);

          // assertions
          expect(performCubeRequest).not.toHaveBeenCalled();
          expect(scheduler.isAlreadyRequested(oldCubeInfo.key)).toBeFalsy();
          expect(dummyPeer.sendCubeRequest).not.toHaveBeenCalled();
        });

        it('should request cubes that are not in storage and meet the retention policy', async () => {
          // set options for this test
          cubeStore.options.enableCubeRetentionPolicy = true;

          // sculpt a test Cube
          const testCube: Cube = Cube.Frozen({
            fields: [
              CubeField.RawContent(CubeType.FROZEN, "Cubus sum"),
            ],
            requiredDifficulty: Settings.REQUIRED_DIFFICULTY,  // running on full difficulty due to issue Github#134
          });
          const testCubeInfo: CubeInfo = await testCube.getCubeInfo();

          // if we are a light node, the Cubes must have been requested locally
          if (scheduler.options.lightNode) {
              scheduler.requestCube(testCubeInfo.key);
          }

          // prepare to spy on method calls
          // note: spying on performCubeRequest directly as in this context
          // it is called directly by scheduler.handleCubesOffered() and not
          // scheduled / called back to.
          const performCubeRequest = vi.spyOn((scheduler as any), 'performCubeRequest');
          const sendCubeRequest = vi.spyOn(dummyPeer as any, 'sendCubeRequest');

          // perform test
          await scheduler.handleKeysOffered([testCubeInfo], dummyPeer);

          // assertions
          expect(scheduler.isAlreadyRequested(testCubeInfo.key)).toBeTruthy();
          expect(performCubeRequest).toHaveBeenCalled();
          expect(sendCubeRequest).toHaveBeenCalled();
        });

        it('should request cubes that win the cube contest', async () => {
          // sculpt test Cubes:
          // an old one already in store...
          const oldCube: Cube = Cube.PIC({
            fields: [
              CubeField.RawContent(CubeType.PIC, "Cubus perpetuus immutabilis sum"),
              CubeField.Date(unixtime() - 315360000),  // sculpted ten years ago
            ],
            requiredDifficulty: reducedDifficulty,
          });
          await cubeStore.addCube(oldCube);
          // ... and a new one that will be offered to us
          const newCube: Cube = Cube.PIC({
            fields: [
              CubeField.RawContent(CubeType.PIC, "Cubus perpetuus immutabilis sum"),
              CubeField.Date(unixtime()),  // sculpted right now
            ],
            requiredDifficulty: reducedDifficulty,
          });
          const testCubeInfo = await newCube.getCubeInfo();

          // if we are a light node, the Cubes must have been requested locally
          if (scheduler.options.lightNode) scheduler.requestCube(testCubeInfo.key);

          // prepare to spy on method calls
          // note: spying on performCubeRequest directly as in this context
          // it is called directly by scheduler.handleCubesOffered() and not
          // scheduled / called back to.
          const performCubeRequest = vi.spyOn((scheduler as any), 'performCubeRequest');
          const sendCubeRequest = vi.spyOn(dummyPeer as any, 'sendCubeRequest');

          // perform test
          await scheduler.handleKeysOffered([testCubeInfo], dummyPeer);

          // assertions
          expect(scheduler.isAlreadyRequested(testCubeInfo.key)).toBeTruthy();
          expect(performCubeRequest).toHaveBeenCalled();
          expect(sendCubeRequest).toHaveBeenCalled();
        });

        it('should not request cubes that lose the cube contest', async () => {
          // sculpt test Cubes:
          // a new one already in store...
          const newCube: Cube = Cube.PIC({
            fields: [
              CubeField.RawContent(CubeType.PIC, "Cubus perpetuus immutabilis sum"),
              CubeField.Date(unixtime()),  // sculpted right now
            ],
            requiredDifficulty: reducedDifficulty,
          });
          await cubeStore.addCube(newCube);
          // ... and an older one that will be offered to us
          const oldCube: Cube = Cube.PIC({
            fields: [
              CubeField.RawContent(CubeType.PIC, "Cubus perpetuus immutabilis sum"),
              CubeField.Date(unixtime() - 315360000),  // sculpted ten years
            ],
            requiredDifficulty: reducedDifficulty,
          });
          const testCubeInfo = await oldCube.getCubeInfo();

          // prepare to spy on method calls
          const performCubeRequest = vi.spyOn((scheduler as any).cubeRequestTimer, 'callback');
          const sendCubeRequest = vi.spyOn(dummyPeer as any, 'sendCubeRequest');

          // perform test
          await scheduler.handleKeysOffered([testCubeInfo], dummyPeer);

          // assertions
          expect(scheduler.isAlreadyRequested(testCubeInfo.key)).toBeFalsy();
          expect(performCubeRequest).not.toHaveBeenCalled();
          expect(sendCubeRequest).not.toHaveBeenCalled();
        });
      });  // handleCubesOffered()
    });  //tests run as both full and light node
  });  // mock-based unit tests
});


function testCube(): Cube {
  const contentField: CubeField =
    CubeField.RawContent(CubeType.FROZEN, "Cubus sum");
  const cube = Cube.Frozen({
    fields: contentField,
    requiredDifficulty: reducedDifficulty,
  });
  return cube;
}
