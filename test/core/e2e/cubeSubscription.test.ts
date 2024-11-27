import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { requiredDifficulty } from "../testcore.definition";
import { LineShapedNetwork } from "./e2eSetup";

import sodium from 'libsodium-wrappers-sumo';

describe('Cube subscription e2e tests', () => {
  describe('scenario 1', () => {
    let net: LineShapedNetwork;
    let originalMuc: Cube;
    let key: CubeKey;
    let privateKey: Buffer;

    beforeAll(async () => {
      // prepare crypto
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      key = Buffer.from(keyPair.publicKey);
      privateKey = Buffer.from(keyPair.privateKey);

      // prepare a test network
      net = await LineShapedNetwork.Create(61301, 61302);

      // recipient subscribes to the MUC
      net.recipient.networkManager.scheduler.subscribeCube(key, {
        timeout: 10000,
      });

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

      // wait for update to propagate to recipient
      // await propagationPromise;
      // const received: Cube = await net.recipient.cubeStore.getCube(key);

      // expect(received.getFirstField(CubeFieldType.MUC_RAWCONTENT).valueString).
      //   toContain('ab domino meo renovatus sum');
    });

    it.todo('will auto-renew the subscription after it expires');
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