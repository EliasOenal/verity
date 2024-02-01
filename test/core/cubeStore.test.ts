import { Settings } from '../../src/core/settings';
import { Cube } from '../../src/core/cube/cube';
import { CubeStore as CubeStore } from '../../src/core/cube/cubeStore';
import { CubeField, CubeFieldType, CubeFields, coreFieldParsers, coreTlvDumbParser, coreTlvFieldParsers } from '../../src/core/cube/cubeFields';

import sodium from 'libsodium-wrappers'
import { logger } from '../../src/core/logger';
import { validBinaryCube } from './cube.test';
import { CubeType } from '../../src/core/cube/cubeDefinitions';

describe('cubeStore', () => {
  let cubeStore: CubeStore;
  const reduced_difficulty = 0;

  describe('tests at full difficulty', () => {
    // If these tests actually calculate hashcash, let's keep them to an absolute
    // minimum if we can.
    beforeEach(() => {
      cubeStore = new CubeStore({
        enableCubePersistance: false,
        requiredDifficulty: Settings.REQUIRED_DIFFICULTY,
      });
    });
    it('should add a freshly sculpted cube at full difficulty', async () => {
      expect(cubeStore.getNumberOfStoredCubes()).toEqual(0);
      const cube = Cube.Dumb(CubeField.Payload(
        "Ego sum cubus recens sculputus."));
      const key = await cube.getKey();
      await cubeStore.addCube(cube);
      expect(cubeStore.getNumberOfStoredCubes()).toEqual(1);

      const restored = cubeStore.getCube(key, coreTlvFieldParsers);  // parse payload too
      expect(restored).toBeInstanceOf(Cube);
      expect(restored.fields.getFirst(CubeFieldType.PAYLOAD).
        value.toString('ascii')).toEqual("Ego sum cubus recens sculputus.");
    });

    it('should add a cube from binary data', async () => {
      const cubeKey = (await cubeStore.addCube(validBinaryCube)).getKeyIfAvailable();
      expect(cubeKey).toBeInstanceOf(Buffer);
      expect(cubeKey!.length).toEqual(32);
      expect(cubeStore.getCube(cubeKey!)).toBeDefined();
      expect(await (cubeStore.getCube(cubeKey!)!.getBinaryData())).toEqual(validBinaryCube);
    }, 3000);

    it('should error when adding a cube with invalid binary data', async () => {
      const buffer = Buffer.alloc(1024);
      expect(await cubeStore.addCube(buffer)).toBeUndefined();
    }, 3000);

    it('should error when getting a cube with invalid hash', async () => {
      const buffer = Buffer.alloc(32);
      expect(cubeStore.getCube(buffer)).toBeUndefined();
    }, 3000);

    it('should not add cubes with insufficient difficulty', async () => {
      const binaryData = Buffer.alloc(1024);
      binaryData[0] = CubeType.DUMB;  // manually set Cube type
      // Manually set a field in the binary data for testing
      binaryData[6] = CubeFieldType.PAYLOAD; // Type
      binaryData.writeUInt8(100, 7); // Length
      const cube = new Cube(binaryData);
      expect(await cubeStore.addCube(cube)).toBeUndefined();
      expect(cubeStore.getNumberOfStoredCubes()).toEqual(0);
    }, 3000);
  });


  describe('tests without hashcash', () => {
    // These tests run at a reduced challenge difficulty setting of zero to
    // make sure our tests don't spend forever calculating hashcash.
    // So should all other Cube-sculpting tests in other units.
    beforeEach(() => {
      cubeStore = new CubeStore({
        enableCubePersistance: false,
        requiredDifficulty: 0,  // require no hashcash for faster testing
      });
    });

    it('should add 20 cubes to the storage and get them back', async () => {
      // create 20 cubes and wait till they are stored
      const promises: Array<Promise<Cube>> = [];
      for (let i = 0; i < 20; i++) {
        const cube = Cube.Dumb(CubeField.Payload(
            "Sum cubus inutilis qui in tua taberna residebo et spatium tuum absumam."),
          coreFieldParsers, Cube, reduced_difficulty);
        promises.push(cubeStore.addCube(cube));
      }
      const cubes = await Promise.all(promises);

      cubes.forEach((cube, i) => {
        const hash = cube.getKeyIfAvailable();
        if (!hash) throw new Error(`Hash is undefined for cube ${i}`);
        const binaryData = cubeStore.getCube(hash)?.getBinaryData();
        expect(hash).toBeInstanceOf(Buffer);
        if (hash) {
          expect(hash.length).toEqual(32);
          expect(cubeStore.getCube(hash)!.getBinaryData()).toEqual(binaryData);
        }
      });

      expect(cubeStore.getNumberOfStoredCubes()).toEqual(20);
    }, 30000);

    it('should update the initial MUC with the updated MUC.', async () => {
      // Generate a key pair for testing
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      // Create original MUC
      const muc = Cube.MUC(publicKey, privateKey, CubeField.Payload(
        "Sum cubus usoris mutabilis, signatus a domino meo."),
        coreFieldParsers, Cube, reduced_difficulty);
      muc.setDate(1695340000);
      const key = await muc.getKey();
      const info = await muc.getCubeInfo();
      expect(key).toBeDefined();
      expect(info).toBeDefined();
      expect(muc.getDate()).toEqual(1695340000);
      expect(info.date).toEqual(1695340000);
      await cubeStore.addCube(muc);
      expect(cubeStore.getCube(key).getDate()).toEqual(1695340000);
      expect(cubeStore.getCubeInfo(key).date).toEqual(1695340000);

      // Create updated MUC
      const muc2 = Cube.MUC(publicKey, privateKey, CubeField.Payload(
        "Actualizatus sum a domino meo, sed clavis mea semper eadem est."),
        coreFieldParsers, Cube, reduced_difficulty);
      // Make sure date is ever so slightly newer
      muc2.setDate(1695340001);
      const key2 = await muc2.getKey();
      const info2 = await muc2.getCubeInfo();
      expect(key2).toBeDefined();
      expect(info2).toBeDefined();
      expect(muc2.getDate()).toEqual(1695340001);
      expect(info2.date).toEqual(1695340001);
      await cubeStore.addCube(muc2);

      // Verify that the first MUC has been updated with the second MUC
      const retrievedMuc = cubeStore.getCube(key);
      expect(retrievedMuc).toBeDefined();
      expect(retrievedMuc.getDate()).toEqual(1695340001);
    }, 5000);

    it('correctly stores and retrieves a binary MUC with payload', async () => {
      // Generate a key pair for testing
      await sodium.ready;
      const keyPair = sodium.crypto_sign_keypair();
      const publicKey: Buffer = Buffer.from(keyPair.publicKey);
      const privateKey: Buffer = Buffer.from(keyPair.privateKey);

      const muc = Cube.MUC(publicKey, privateKey, CubeField.Payload(
        "Etiam post conversionem in binarium et reversionem, idem cubus usoris mutabilis sum."));
      const muckey = await muc.getKey();
      expect(muckey).toEqual(publicKey);

      const binarymuc = await muc.getBinaryData();
      expect(binarymuc).toBeDefined();
      const cubeadded = await cubeStore.addCube(binarymuc);
      expect(cubeadded.getKeyIfAvailable()).toEqual(muckey);

      const restoredmuc = cubeStore.getCube(muckey, coreTlvFieldParsers);  // restore payload too
      expect(restoredmuc).toBeDefined();
      const restoredpayload = restoredmuc?.fields.getFirst(CubeFieldType.PAYLOAD);
      expect(restoredpayload).toBeDefined();
      expect(restoredpayload?.value.toString('utf8')).toEqual(
        "Etiam post conversionem in binarium et reversionem, idem cubus usoris mutabilis sum.");
    });
  });
});
