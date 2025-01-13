import { Buffer } from 'buffer';
import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { Cube } from '../../../src/core/cube/cube';
import { CubeType } from '../../../src/core/cube/cube.definitions';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';
import { CubeField } from '../../../src/core/cube/cubeField';

// As you can see, we're severely lacking unit test coverage for CubeInfo.
// Yet another reason to maybe get rid of it altogether and just use Cube
// objects instead.

describe('CubeInfo', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  describe('updatecount property', () => {
    describe('dormant Cubes', () => {
      it('knows the update count when actively supplied', () => {
        const binaryCube: Buffer = Buffer.alloc(NetConstants.CUBE_SIZE, 42);  // fake Cube
        const fakeKey: Buffer = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337);
        const cubeInfo: CubeInfo = new CubeInfo({
          key: fakeKey,
          cube: binaryCube,
          cubeType: CubeType.PMUC,
          updatecount: 42,
        });
        expect(cubeInfo.updatecount).toBe(42);
      });

      it('tries to activate the Cube to get the update count', async () => {
        const keyPair = sodium.crypto_sign_keypair();
        const cube: Cube = Cube.Create({
          cubeType: CubeType.PMUC,
          fields: CubeField.PmucUpdateCount(42),
          publicKey: Buffer.from(keyPair.publicKey),
          privateKey: Buffer.from(keyPair.privateKey),
        });
        const binaryCube: Buffer = await cube.getBinaryData();

        const cubeInfo: CubeInfo = new CubeInfo({
          key: Buffer.from(keyPair.publicKey),
          cube: binaryCube,
          cubeType: CubeType.PMUC,
          // note missing updatecount
        });
        expect(cubeInfo.updatecount).toBe(42);
      });

      it('returns undefined when it cannot activate the Cube to get the update count', () => {
        const binaryCube: Buffer = Buffer.alloc(NetConstants.CUBE_SIZE, 42);  // fake Cube
        const fakeKey: Buffer = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337);
        const cubeInfo: CubeInfo = new CubeInfo({
          key: fakeKey,
          cube: binaryCube,
          cubeType: CubeType.PMUC,
          // note missing updatecount
        });
        expect(cubeInfo.updatecount).toBe(undefined);
      });

      it.todo('tests using PMUC_NOTIFY');
    });

    describe('active Cubes', () => {
      it.todo('fetches the update count from the Cube');
      it.todo('does not allow to override the update count');
    });
  });
});
