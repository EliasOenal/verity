import { Settings } from '../../src/core/settings';
import { Cube } from '../../src/core/cube';
import { CubeStore as CubeStore } from '../../src/core/cubeStore';
import { CubeField, CubeFieldType, CubeFields } from '../../src/core/cubeFields';

import sodium from 'libsodium-wrappers'

describe('cubeStore', () => {
  let cubeStore: CubeStore;
  const reduced_difficulty = 0;
  const validBinaryCube = Buffer.from([
    // Protocol Version and Reserved Bits (1 byte)
    0b00000000,

    // Date (5 bytes)
    0x00, 0x00, 0x00, 0x00, 0x00,

    // Payload TLV field
    0x04, // Type: Payload
    0x0A,       // Length: 10 bytes little endian
    0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x77, 0x6F, 0x72, // Value: "Hello, wor"

    // Padding TLV field (remaining bytes to fill 1024)
    0x00 | 0b11, // Type: Padding
    0xEC,       // Length: 1004 bytes
    0x00, 0x00, 0x37, 0x4D, // Nonce passing challenge requirement
    // Padding data (up to index 1023) - For demonstration, all zeros
    ...Array.from({ length: 1000 }, () => 0x00),
  ])


  describe('tests at full difficulty', () => {
    // If these tests actually calculate hashcash, let's keep them to an absolute
    // minimum if we can.
    beforeEach(() => {
      cubeStore = new CubeStore({
        enableCubePersistance: false,
        requiredDifficulty: Settings.REQUIRED_DIFFICULTY,
      });
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
      // Manually set a field in the binary data for testing
      binaryData[6] = CubeFieldType.PAYLOAD; // Type
      binaryData.writeUInt8(100, 7); // Length
      const cube = new Cube(binaryData);
      expect(await cubeStore.addCube(cube)).toBeUndefined();
      expect(cubeStore.getNumberOfStoredCubes()).toEqual(0);
    }, 3000);
  });


  describe('tests without hashcash', () => {
    beforeEach(() => {
      cubeStore = new CubeStore({
        enableCubePersistance: false,
        requiredDifficulty: 0,  // require no hashcash for faster testing
      });
    });

    it('should add 20 cubes to the storage and get them back', async () => {
      const promises: Array<Promise<Cube>> = [];
      for (let i = 0; i < 20; i++) {
        const cube = new Cube(undefined, reduced_difficulty);
        cube.setDate(i);
        // @ts-ignore cube could be Promise<undefined> instead of Promise<Buffer> but I don't care
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

      // Define required MUC fields
      const fields = new CubeFields([
        new CubeField(CubeFieldType.SMART_CUBE | 0b00, 0, Buffer.alloc(0)),
        new CubeField(CubeFieldType.PUBLIC_KEY, 32, publicKey),
        new CubeField(CubeFieldType.PADDING_NONCE, 909, Buffer.alloc(909)),
        new CubeField(CubeFieldType.SIGNATURE, 72, Buffer.alloc(72))
      ]);

      // Create first MUC with specified TLV fields
      const muc = new Cube();
      muc.setCryptoKeys(publicKey, privateKey);
      muc.setFields(fields);
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

      // Create second MUC with specified TLV fields
      const muc2 = new Cube();
      muc2.setCryptoKeys(publicKey, privateKey);
      muc2.setFields(fields);
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

      const muc = Cube.MUC(publicKey, privateKey, CubeField.Payload("Hi, I'm a MUC!"));
      const muckey = await muc.getKey();
      expect(muckey).toEqual(publicKey);

      const binarymuc = await muc.getBinaryData();
      expect(binarymuc).toBeDefined();
      const cubeadded = await cubeStore.addCube(binarymuc);
      expect(cubeadded.getKeyIfAvailable()).toEqual(muckey);

      const restoredmuc = cubeStore.getCube(muckey);
      expect(restoredmuc).toBeDefined();
      const restoredpayload = restoredmuc?.getFields().getFirstField(CubeFieldType.PAYLOAD);
      expect(restoredpayload).toBeDefined();
      expect(restoredpayload?.value.toString('utf8')).toEqual("Hi, I'm a MUC!");
    });
  });
});
