import { Cube } from "../../../src/core/cube/cube";
import { CubeFieldType, CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
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
      await sodium.ready;
      net = await LineShapedNetwork.Create(61301, 61302);
      const keyPair = sodium.crypto_sign_keypair();
      key = Buffer.from(keyPair.publicKey);
      privateKey = Buffer.from(keyPair.privateKey);
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
    });

    it.skip('will receive the initial MUC when subscribing', async () => {
      expect(await net.recipient.cubeStore.getNumberOfStoredCubes()).toBe(0);
      await net.recipient.networkManager.scheduler.subscribeCube(key);
      const received: Cube = await net.recipient.cubeStore.getCube(key);
      expect(received.getFirstField(CubeFieldType.MUC_RAWCONTENT).valueString).
        toContain('cubus usoris mutabilis sum');
    });

    it.skip('will receive MUC updates while subscribed', async () => {
      // sender updates the MUC
      const updatedMuc = Cube.Create({
        cubeType: CubeType.MUC,
        privateKey,
        publicKey: key, requiredDifficulty,
        fields: [
          CubeField.RawContent(CubeType.MUC, 'ab domino meo renovatus sum'),
          CubeField.Date(1000001),
        ],
      });
      const propagationPromise = net.recipient.cubeStore.expectCube(key);
      net.sender.cubeStore.addCube(updatedMuc);

      // wait for update to propagate to recipient
      await propagationPromise;
      const received: Cube = await net.recipient.cubeStore.getCube(key);

      expect(received.getFirstField(CubeFieldType.MUC_RAWCONTENT).valueString).
        toContain('ab domino meo renovatus sum');
    });

    it.todo('will auto-renew the subscription after it expires');
    it.todo('will not miss any updates happening during the renewal');
    it.todo('will catch up on any missed updates on renewal');
    it.todo('can sync the same MUC both ways');
  })
});
