import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { CubeSubscription } from "../../../src/core/networking/cubeRetrieval/pendingRequest";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

import sodium from 'libsodium-wrappers-sumo';

describe('Cube subscription e2e tests', () => {
  describe('scenario 1', () => {
    let net: LineShapedNetwork;
    let originalMuc: Cube;
    let key: CubeKey;
    let privateKey: Buffer;
    let initialSubPromise: Promise<CubeSubscription>;

    beforeAll(async () => {
      // prepare crypto
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      key = Buffer.from(keyPair.publicKey);
      privateKey = Buffer.from(keyPair.privateKey);

      // prepare a test network
      net = await LineShapedNetwork.Create(61301, 61302, {
        cubeSubscriptionPeriod: 2000,
      });

      // recipient subscribes to the MUC
      initialSubPromise =
        net.recipient.networkManager.scheduler.subscribeCube(key);

      // sculpt the original MUC at the sender
      originalMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key, requiredDifficulty,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'cubus usoris mutabilis sum'),
          CubeField.Date(1000000),
        ],
      });
      await net.sender.cubeStore.addCube(originalMuc);

      // sanity-check test setup:
      // sender should have a single Cube stored, all other nodes should have
      // none yet
      expect(await net.sender.cubeStore.getNumberOfStoredCubes()).toBe(1);
      expect(await net.fullNode1.cubeStore.getNumberOfStoredCubes()).toBe(0);
      expect(await net.fullNode2.cubeStore.getNumberOfStoredCubes()).toBe(0);
      expect(await net.recipient.cubeStore.getNumberOfStoredCubes()).toBe(0);
    });

    it('will receive the initial MUC when subscribing', async () => {
      expect (await waitForMucContent(
        net.recipient.cubeStore, key, 'cubus usoris mutabilis sum')).
        toBe(true);
    });

    it('will receive MUC updates while subscribed', async () => {
      // sender updates the MUC
      const updatedMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'ab domino meo renovatus sum'),
          CubeField.Date(1000001),
        ],
        requiredDifficulty,
      });
      // const propagationPromise = net.recipient.cubeStore.expectCube(key);
      await net.sender.cubeStore.addCube(updatedMuc);

      expect (await waitForMucContent(
        net.recipient.cubeStore, key, 'ab domino meo renovatus sum')).
        toBe(true);
    });

    it('will auto-renew the subscription after it expires', async() => {
      // wait for the subscription to expire
      const sub: CubeSubscription = await initialSubPromise;
      await sub.promise;  // denotes expiry

      // expect subscription to have actually expired
      expect(sub.settled).toBe(true);
      const expired =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);
      expect(expired).toBeUndefined();

      // give it some time for the subscription to renew
      await new Promise(resolve => setTimeout(resolve, 100));
      const renewedSub: CubeSubscription =
        net.recipient.networkManager.scheduler.cubeSubscriptionDetails(key);

      expect(renewedSub).toBeInstanceOf(CubeSubscription);
      expect(renewedSub).not.toBe(sub);
    });


    it.todo('will not miss any updates happening during the renewal');
    it.todo('will catch up on any missed updates on renewal');
    it.todo('can sync the same MUC both ways');

    afterAll(async () => {
      await net.shutdown();
    });

  });  // scenario 1

});



async function waitForMucContent(cubeStore: CubeStore, key: CubeKey, expectedContent: string, timeout: number = 1000): Promise<boolean> {
  let timeWaited: number = 0;
  while (true) {
    const cube = await cubeStore.getCube(key);
    if (cube) {
      const field = cube.getFirstField(CubeFieldType.MUC_RAWCONTENT);
      if (field.valueString.includes(expectedContent)) return true;
    }
    if (timeWaited > timeout) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
    timeWaited += 50;
  }
}