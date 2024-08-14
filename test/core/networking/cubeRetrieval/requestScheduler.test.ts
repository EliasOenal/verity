import { CubeInfo } from "../../../../src/core/cube/cubeInfo";
import { NetConstants } from "../../../../src/core/networking/networkDefinitions";
import { NetworkManager } from "../../../../src/core/networking/networkManager";
import { RequestScheduler } from "../../../../src/core/networking/cubeRetrieval/requestScheduler";
import { Cube } from "../../../../src/core/cube/cube";

import { EventEmitter } from 'events';
import { CubeField } from "../../../../src/core/cube/cubeField";
import { CubeFieldType, CubeType } from "../../../../src/core/cube/cube.definitions";
import { CubeStore, CubeStoreOptions } from "../../../../src/core/cube/cubeStore";

const reducedDifficulty = 0;

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
  requiredDifficulty: reducedDifficulty,
  enableCubeRetentionPolicy: false,
  cubeDbName: 'cubes.test',
  cubeDbVersion: 1,
  notifyDbName: 'notifications.test',
  notifyDbVersion: 1,
};

class mockNetworkManager {
  cubeStore = new CubeStore(cubeStoreOptions);
  onlinePeers: Array<any> = [];
  options = {maximumConnections: 10};
  get onlinePeerCount() { return this.onlinePeers.length }
};


describe('RequestScheduler', () => {
  describe('mock-based unit tests', () => {
    let scheduler: RequestScheduler;
    const testKey = Buffer.from("01".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');
    const testKey2 = Buffer.from("02".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');
    const testKey3 = Buffer.from("03".repeat(NetConstants.CUBE_KEY_SIZE), 'hex');

    beforeEach(() => {
      // create a scheduler
      scheduler = new RequestScheduler(
        // with a mock NetworkManager
        new mockNetworkManager() as unknown as NetworkManager,
        {
          requestInterval: 50,
          requestScaleFactor: 4,
        }
      );
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
        const promise = scheduler.requestCube(testKey, 10);  // I fully expect you to fetch my Cube in 10ms
        expect(promise).rejects.toBeUndefined();
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

      it('should reject Cube requests after timeout', async () => {
        const promise = scheduler.requestCube(testKey, 10);  // I fully expect you to fetch my Cube in 10ms
        expect(promise).rejects.toBeUndefined();
      });
    });

    describe('scheduleNextRequest() and performRequest()', () => {
      it('should schedule CubeRequests in light mode', async () => {
        scheduler.options.lightNode = true;
        scheduler.requestCube(testKey);
        await new Promise(resolve => setTimeout(resolve, 200));  // give it some time
        expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
          called).toEqual("sendCubeRequest");
      });

      it('should schedule KeyRequests in full mode', async () => {
        scheduler.options.lightNode = false;
        scheduler.requestCube(testKey);
        await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
        expect((scheduler.networkManager.onlinePeers[0] as unknown as mockNetworkPeer).
          called).toEqual("sendKeyRequests");
      });

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
    });

  });

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
