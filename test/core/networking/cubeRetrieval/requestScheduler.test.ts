import { CubeInfo } from "../../../../src/core/cube/cubeInfo";
import { NetConstants } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManager, NetworkManagerIf } from "../../../../src/core/networking/networkManager";
import { RequestScheduler } from "../../../../src/core/networking/cubeRetrieval/requestScheduler";
import { Cube } from "../../../../src/core/cube/cube";

import { EventEmitter } from 'events';
import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeFieldType, CubeKey, CubeType } from "../../../../src/core/cube/cube.definitions";
import { CubeStore, CubeStoreOptions } from "../../../../src/core/cube/cubeStore";
import { getCurrentEpoch, shouldRetainCube, cubeContest } from "../../../../src/core/cube/cubeUtil";
import { RequestedCube } from "../../../../src/core/networking/cubeRetrieval/requestedCube";
import { NetworkPeer } from "../../../../src/core/networking/networkPeer";
import { unixtime } from "../../../../src/core/helpers/misc";

import { jest } from '@jest/globals'
import { Settings } from "../../../../src/core/settings";

const reducedDifficulty = 0;

// TODO add test to ensure light nodes don't blindly follow KeyResponses
// mocks
class mockNetworkPeer {
  called = undefined;
  param = undefined;
  calls = 0;
  sendKeyRequests() {
    this.called = "sendKeyRequests";
    this.calls++;
  }
  sendCubeRequest(param: Array<any>) {
    this.called = "sendCubeRequest";
    this.param = param;
    this.calls++;
  }
}

const cubeStoreOptions: CubeStoreOptions = {
  inMemoryLevelDB: true,
  requiredDifficulty: reducedDifficulty,
  enableCubeRetentionPolicy: false,
  dbName: 'cubes.test',
  dbVersion: 1,
};

class mockNetworkManager {
  cubeStore = new CubeStore(cubeStoreOptions);
  onlinePeers: Array<any> = [];
  options = {maximumConnections: 10};
  get onlinePeerCount() { return this.onlinePeers.length }
};


describe('RequestScheduler', () => {
  describe('mock-based unit tests (custom)', () => {
    let scheduler: RequestScheduler;
    const testKey = Buffer.from("01".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');
    const testKey2 = Buffer.from("02".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');
    const testKey3 = Buffer.from("03".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');

    beforeEach(async () => {
      // create a scheduler
      scheduler = new RequestScheduler(
        // with a mock NetworkManager
        new mockNetworkManager() as unknown as NetworkManager,
        {
          requestInterval: 50,
          requestScaleFactor: 4,
        }
      );
      await scheduler.networkManager.cubeStore.readyPromise;
      // having a mock peer
      (scheduler.networkManager as unknown as mockNetworkManager).onlinePeers =
        [ new mockNetworkPeer() ];
    });

    afterEach(() => {
      scheduler.shutdown();
    });

    describe('requestCube()', () => {
      it('should accept and fulfil a Cube request', async () => {
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

      it('should reject Cube requests after timeout', async () => {
        const promise = scheduler.requestCube(testKey, 0, 10);  // I fully expect you to fetch my Cube in 10ms
        expect(promise).rejects.toBeUndefined();
        await new Promise(resolve => setTimeout(resolve, 20));  // give it some time
      });

      it.todo('should request a Cube from another node if first request fails');
      // (must keep track of nodes already requested from I guess)

      it.todo('should never request a Cube from two nodes at once, not even as a full node');
        // (this implies KeyResponses must be fed through the Scheduler)
    });

    describe('requestNotification()', () => {
      it('should accept and fulfil a Notification request', async () => {
        expect((scheduler as any).requestedNotifications.size).toEqual(0);  // spying on private attribute
        const promise = scheduler.requestNotifications(testKey);
        expect((scheduler as any).requestedNotifications.size).toEqual(1);  // spying on private attribute

        // simulate successful network retrieval by adding a matching notification Cube
        const contentField: CubeField =
          CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis");
        const notification = Cube.Frozen({
          fields:                 [
            contentField,
            CubeField.Notify(testKey),
          ],
          requiredDifficulty: reducedDifficulty,
        })
        await scheduler.networkManager.cubeStore.addCube(notification);

        const result = await promise;
        expect(result.key).toEqual(notification.getKeyIfAvailable());
        expect(result.getCube().fields.getFirst(
          CubeFieldType.NOTIFY).value).toEqual(testKey);
        expect(result.getCube().fields.getFirst(
          CubeFieldType.FROZEN_NOTIFY_RAWCONTENT)).toEqual(contentField);
        expect((scheduler as any).requestedCubes.size).toEqual(0);  // spying on private attribute
      });
    });

    describe('scheduleNextRequest() and performCubeRequest()', () => {
      it('should schedule CubeRequests in light mode', async () => {
        scheduler.options.lightNode = true;
        scheduler.requestCube(testKey);
        await new Promise(resolve => setTimeout(resolve, 200));  // give it some time
        expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
          called).toEqual("sendCubeRequest");
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

      it('should group together multiple Cube requests', async() => {
        scheduler.requestCube(testKey);
        // even async requests within interactiveRequestDelay (default 100ms)
        // should be grouped
        await new Promise(resolve => setTimeout(resolve, 80));
        // still within interactive delay, should not have been called yet
        expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
        calls).toBe(0);
        scheduler.requestCube(testKey2);
        // call should still be performed within the original 100ms
        await new Promise(resolve => setTimeout(resolve, 40));
        expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
          calls).toBe(1);
      });

      it('should correctly calculate the request scale factor', () => {
        (scheduler.networkManager as unknown as mockNetworkManager).onlinePeers =
        [1];  // no scaling
        // @ts-ignore testing private method
        expect(scheduler.calcRequestScaleFactor()).toBe(1);

        (scheduler.networkManager as unknown as mockNetworkManager).onlinePeers =
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];  // full scaling
        // @ts-ignore testing private method
        expect(scheduler.calcRequestScaleFactor()).toBe(0.25);
      });
    });

    describe('subscribeCube()', () => {
      it('should request a subscribed Cube in light mode', async() => {
        scheduler.options.lightNode = true;
        scheduler.subscribeCube(testKey);
        // @ts-ignore spying on private attribute
        expect(scheduler.subscribedCubes).toContainEqual(testKey);
        await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
        expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
          called).toEqual("sendCubeRequest");
        expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
          param).toContainEqual(testKey);
      });

      it('should ignore Cube requests when running as a full node', () => {
        scheduler.options.lightNode = false;
        scheduler.subscribeCube(testKey);
        // @ts-ignore spying on private attribute
        expect(scheduler.subscribedCubes).not.toContainEqual(testKey);
      });
    });  // subscribeCube()
  });

  describe('mock-based unit tests (standard jest mocks)', () => {
    describe.each([
      true,
      false,
    ])('tests run as both full and light node', (lightNode) => {
      describe(`handleCubesOffered() as ${lightNode ? 'light node' : 'full node'}`, () => {
        let scheduler: RequestScheduler;
        let mockNetworkManager: jest.Mocked<NetworkManagerIf>;
        let mockOfferingPeer: jest.Mocked<NetworkPeer>;
        let cubeStore: CubeStore;

        beforeEach(async () => {
          // note: copying cubeStoreOptions here so we can manipulate them
          // within the tests without affecting subsequent tests
          cubeStore = new CubeStore(Object.assign({}, cubeStoreOptions));
          await cubeStore.readyPromise;
          mockNetworkManager = {
            cubeStore: cubeStore,
            onlinePeers: [],
            onlinePeerCount: 0,
            options: { maximumConnections: 5 },
          } as unknown as jest.Mocked<NetworkManagerIf>;

          mockOfferingPeer = {
            sendCubeRequest: jest.fn(),
            toString: jest.fn().mockReturnValue('MockPeer'),
          } as unknown as jest.Mocked<NetworkPeer>;

          scheduler = new RequestScheduler(mockNetworkManager, { lightNode: lightNode });
        });

        afterEach(async () => {
          jest.clearAllMocks();
          await scheduler.shutdown();
          await cubeStore.shutdown()
        });

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
          const performCubeRequest = jest.spyOn(scheduler as any, 'performCubeRequest');

          // perform test
          await scheduler.handleCubesOffered([oldCubeInfo], mockOfferingPeer);

          // assertions
          expect(performCubeRequest).not.toHaveBeenCalled();
          expect(scheduler.isAlreadyRequested(oldCubeInfo.key)).toBeFalsy();
          expect(mockOfferingPeer.sendCubeRequest).not.toHaveBeenCalled();
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
          const performCubeRequest = jest.spyOn(scheduler as any, 'performCubeRequest');

          // perform test
          await scheduler.handleCubesOffered([testCubeInfo], mockOfferingPeer);

          // assertions
          expect(scheduler.isAlreadyRequested(testCubeInfo.key)).toBeTruthy();
          expect(performCubeRequest).toHaveBeenCalled();
          expect(mockOfferingPeer.sendCubeRequest).toHaveBeenCalled();
        });

        it('should request cubes that win the cube contest', async () => {
          // sculpt test Cubes:
          // an old one already in store...
          const oldCube: Cube = Cube.PIC({
            fields: [
              CubeField.RawContent(CubeType.PIC, "Cubus perpetuus immutabilis sum"),
              CubeField.Date(unixtime() - 172800),  // sculpted two days ago
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
          const performCubeRequest = jest.spyOn(scheduler as any, 'performCubeRequest');

          // perform test
          await scheduler.handleCubesOffered([testCubeInfo], mockOfferingPeer);

          // assertions
          expect(scheduler.isAlreadyRequested(testCubeInfo.key)).toBeTruthy();
          expect(performCubeRequest).toHaveBeenCalled();
          expect(mockOfferingPeer.sendCubeRequest).toHaveBeenCalled();
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
              CubeField.Date(unixtime() - 172800),  // sculpted two days ago
            ],
            requiredDifficulty: reducedDifficulty,
          });
          const testCubeInfo = await oldCube.getCubeInfo();

          // prepare to spy on method calls
          const performCubeRequest = jest.spyOn(scheduler as any, 'performCubeRequest');

          // perform test
          await scheduler.handleCubesOffered([testCubeInfo], mockOfferingPeer);

          // assertions
          expect(scheduler.isAlreadyRequested(testCubeInfo.key)).toBeFalsy();
          expect(performCubeRequest).not.toHaveBeenCalled();
          expect(mockOfferingPeer.sendCubeRequest).not.toHaveBeenCalled();
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
