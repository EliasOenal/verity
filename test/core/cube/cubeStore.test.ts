import { Settings } from '../../../src/core/settings';

import { CubeKey, CubeType } from '../../../src/core/cube/cubeDefinitions';
import { Cube, coreTlvCubeFamily } from '../../../src/core/cube/cube';
import { CubeStore as CubeStore, CubeStoreOptions, EnableCubePersitence } from '../../../src/core/cube/cubeStore';
import { CubeField, CubeFieldType } from '../../../src/core/cube/cubeField';

import { MediaTypes, cciField, cciFieldType } from '../../../src/cci/cube/cciField';
import { cciCube, cciFamily } from '../../../src/cci/cube/cciCube';
import { cciFields } from '../../../src/cci/cube/cciFields';

import sodium from 'libsodium-wrappers-sumo'
import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { CubePersistenceOptions } from '../../../src/core/cube/cubePersistence';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';

// TODO: Add tests involving Cube deletion
// TODO: Add tests checking Tree of Wisdom state (partilarly in combination with deletion)
// TODO: For EnableCubePersistence.PRIMARY mode, add tests verifying the weak
//       ref cache actually works.
//       Also add tests for negative cache, i.e. Cubes unparsable
//       (not parseable at all or at chosen CubeFamily)

describe('cubeStore', () => {
  // TODO: Update payload field ID. Make tests actually check payload.
  const validBinaryCube =  Buffer.from([
    // Cube version (1) (half byte), Cube type (basic "frozen" Cube, 0) (half byte)
    0x10,
    // Payload TLV field
    0x04,  // payload field type is 4 (1 byte)
    0x14,  // payload length is 20 chars (1 byte)
    0x43, 0x75, 0x62, 0x75, 0x73, 0x20, // "Cubus "
    0x64, 0x65, 0x6d, 0x6f, 0x6e, 0x73, 0x74, 0x72,
    0x61, 0x74, 0x69, 0x76, 0x75, 0x73, // "demonstrativus"

    // Padding: padding is TLV field type 2 (6 bits), padding length is 990 (10 bits)
    0b00001011, 0b11011110,
    // 990 bytes of padding, all zeros for this example
    ...Array.from({ length: 990 }, () => 0x00),

    // Date (5 bytes)
    0x00, 0x65, 0xba, 0x8e, 0x38,
    0x00, 0x00, 0x00, 0xed  // Nonce passing challenge requirement
  ]);

  let cubeStore: CubeStore;
  const reducedDifficulty = 0;

  describe('tests at full difficulty', () => {
    // If these tests actually calculate hashcash, let's keep them to an absolute
    // minimum if we can.
    beforeEach(() => {
      cubeStore = new CubeStore({
        enableCubePersistence: EnableCubePersitence.OFF,
        requiredDifficulty: Settings.REQUIRED_DIFFICULTY,
        enableCubeRetentionPolicy: false,
      });
    });

    it('should add a freshly sculpted cube at full difficulty', async () => {
      expect(await cubeStore.getNumberOfStoredCubes()).toEqual(0);
      const cube = Cube.Frozen({fields: CubeField.Payload(
        "Ego sum cubus recens sculputus.")});
      const key = await cube.getKey();
      await cubeStore.addCube(cube);
      expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);

      const restored: Cube = await cubeStore.getCube(key, coreTlvCubeFamily);  // parse payload too
      expect(restored).toBeInstanceOf(Cube);
      expect(restored.fields.getFirst(CubeFieldType.PAYLOAD).
        value.toString('ascii')).toEqual("Ego sum cubus recens sculputus.");
    });

    it('should add a cube from binary data', async () => {
      const cube: Cube = await cubeStore.addCube(validBinaryCube);
      const cubeKey = await cube.getKey();
      expect(cubeKey).toBeInstanceOf(Buffer);
      expect(cubeKey.length).toEqual(32);
      expect(await cubeStore.getCube(cubeKey)).toBeDefined();
      expect(await ((await cubeStore.getCube(cubeKey!)!).getBinaryData())).toEqual(validBinaryCube);
    }, 3000);

    it('should error when adding a cube with invalid binary data', async () => {
      const buffer = Buffer.alloc(1024);
      expect(await cubeStore.addCube(buffer)).toBeUndefined();
    }, 3000);

    it('should error when getting a cube with invalid hash', async () => {
      const buffer = Buffer.alloc(32);
      expect(await cubeStore.getCube(buffer)).toBeUndefined();
    }, 3000);

    it('should not add cubes with insufficient difficulty', async () => {
      const binaryData = Buffer.alloc(1024);
      binaryData[0] = CubeType.FROZEN;  // manually set Cube type
      // Manually set a field in the binary data for testing
      binaryData[6] = CubeFieldType.PAYLOAD; // Type
      binaryData.writeUInt8(100, 7); // Length
      const cube = new Cube(binaryData);
      expect(await cubeStore.addCube(cube)).toBeUndefined();
      expect(await cubeStore.getNumberOfStoredCubes()).toEqual(0);
    }, 3000);
  });

  describe('tests without hashcash', () => {
    // These tests run at a reduced challenge difficulty setting of zero to
    // make sure our tests don't spend forever calculating hashcash.
    // So should all other Cube-sculpting tests in other units.

    describe.each([
      {
        enableCubePersistence: EnableCubePersitence.OFF,
        dbName: 'cubes.test',  // unnecessary at this setting, but including it anyway
      },
      {
        enableCubePersistence: EnableCubePersitence.BACKUP,
        dbName: 'cubes.test',
      },
      {
        enableCubePersistence: EnableCubePersitence.PRIMARY,
        dbName: 'cubes.test',
      },
    ])('tests run for all three persistence levels', (testOptions) => {
      describe('core level', () => {
        const cubeStoreOptions: CubeStoreOptions&CubePersistenceOptions = {
          enableCubePersistence: EnableCubePersitence.OFF,
          requiredDifficulty: reducedDifficulty,
          enableCubeRetentionPolicy: false,
        };
        Object.assign(cubeStoreOptions, testOptions);  // mix in options defined in describe.each
        beforeAll(async () => {
          cubeStore = new CubeStore(cubeStoreOptions);
          await cubeStore.readyPromise;
        });
        beforeEach(async () => {
          for await (const key of cubeStore.getAllKeys()) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
        });
        afterEach(async () => {
          for await (const key of cubeStore.getAllKeys()) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
        });
        afterAll(async () => {
          await cubeStore.shutdown();
        });

        describe('adding and retrieving Cubes', () => {
          it('should add 2 Cubes and get them back [testing getAllCubeInfos()]', async () => {
            const first: Cube = Cube.Frozen({fields: CubeField.Payload(
              "Cubus probationis")});
            const second: Cube = Cube.Frozen({fields: CubeField.Payload(
              "Cubus probationis")});
            await cubeStore.addCube(first);
            await cubeStore.addCube(second);
            const restored: CubeInfo[] = [];
            for await (const cubeInfo of cubeStore.getAllCubeInfos()) {
              restored.push(cubeInfo)
            }
            expect(restored).toHaveLength(2);
            const firstRestored: Cube = restored[0].getCube(coreTlvCubeFamily);
            const secondRestored: Cube = restored[1].getCube(coreTlvCubeFamily);
            expect(firstRestored.fields.getFirst(CubeFieldType.PAYLOAD)
              .value.toString('utf8')).toEqual("Cubus probationis");
            expect(secondRestored.fields.getFirst(CubeFieldType.PAYLOAD)
              .value.toString('utf8')).toEqual("Cubus probationis");
            // ensure we actually restored two different Cubes
            expect(restored[0].keyString).not.toEqual(restored[1].keyString);
          }, 1000000000);

          it('should add 20 Cubes and get them back [testing getCube() and getNumberOfStoredCubes()]', async () => {
            // create 20 cubes and wait till they are stored
            const cubes: Cube[] = [];
            for (let i = 0; i < 20; i++) {
              const cube = Cube.Frozen({
                fields: CubeField.Payload(
                  "Cubus inutilis in repositorio tuo residens et spatium tuum consumens"),
                requiredDifficulty: reducedDifficulty
              });
              cubes.push(cube);
              await cubeStore.addCube(cube);
            }

            for (const cube of cubes) {
              const key: CubeKey = await cube.getKey();
              expect(key).toBeInstanceOf(Buffer);
              expect(key.length).toEqual(32);
              const restoredCube: Cube = await cubeStore.getCube(key);
              expect(restoredCube).toBeInstanceOf(Cube);
              const binaryData = await cube.getBinaryData();
              expect(await (restoredCube.getBinaryData())).toEqual(binaryData);
            };
            const cubesStored: number = await cubeStore.getNumberOfStoredCubes();
            expect(cubesStored).toEqual(20);
          }, 30000);

          it('should update the initial MUC with the updated MUC', async () => {
            // Generate a key pair for testing
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);

            // Create original MUC
            const muc = Cube.MUC(publicKey, privateKey, {
                fields: CubeField.Payload(
                  "Sum cubus usoris mutabilis, signatus a domino meo."),
                requiredDifficulty: reducedDifficulty
            });
            muc.setDate(1695340000);
            const key = await muc.getKey();
            const info = await muc.getCubeInfo();
            expect(key).toBeDefined();
            expect(info).toBeDefined();
            expect(muc.getDate()).toEqual(1695340000);
            expect(info.date).toEqual(1695340000);
            expect(await cubeStore.getNumberOfStoredCubes()).toEqual(0);
            await cubeStore.addCube(muc);
            expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);
            expect((await cubeStore.getCube(key)).getDate()).toEqual(1695340000);
            expect((await cubeStore.getCubeInfo(key)).date).toEqual(1695340000);

            // Create updated MUC
            const muc2 = Cube.MUC(publicKey, privateKey, {
              fields: CubeField.Payload(
                "Actualizatus sum a domino meo, sed clavis mea semper eadem est."),
              requiredDifficulty: reducedDifficulty
            });
            // Make sure date is ever so slightly newer
            muc2.setDate(1695340001);
            const key2 = await muc2.getKey();
            const info2 = await muc2.getCubeInfo();
            expect(key2).toBeDefined();
            expect(key2.equals(key)).toBe(true);
            expect(info2).toBeDefined();
            expect(muc2.getDate()).toEqual(1695340001);
            expect(info2.date).toEqual(1695340001);
            await cubeStore.addCube(muc2);
            expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);  // still 1, MUC just updated

            // Verify that the first MUC has been updated with the second MUC
            const retrievedMuc = cubeStore.getCube(key);
            expect(retrievedMuc).toBeDefined();
            expect((await retrievedMuc).getDate()).toEqual(1695340001);
          }, 10000);

          it('correctly stores and retrieves a binary MUC with payload', async () => {
            // Generate a key pair for testing
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);

            const muc = Cube.MUC(publicKey, privateKey, {
              fields: CubeField.Payload(
                "Etiam post conversionem in binarium et reversionem, idem cubus usoris mutabilis sum."),
              requiredDifficulty: reducedDifficulty
            });
            const muckey = await muc.getKey();
            expect(muckey).toEqual(publicKey);

            const binarymuc = await muc.getBinaryData();
            expect(binarymuc).toBeDefined();
            const cubeadded = await cubeStore.addCube(binarymuc);
            expect(cubeadded.getKeyIfAvailable()).toEqual(muckey);

            const restoredmuc = cubeStore.getCube(muckey, coreTlvCubeFamily);  // restore payload too
            expect(restoredmuc).toBeDefined();
            const restoredpayload = (await restoredmuc)?.fields.getFirst(CubeFieldType.PAYLOAD);
            expect(restoredpayload).toBeDefined();
            expect(restoredpayload?.value.toString('utf8')).toEqual(
              "Etiam post conversionem in binarium et reversionem, idem cubus usoris mutabilis sum.");
          });

          it('should not parse TLV fields by default', async() => {
            const spammyCube = Cube.Frozen({  // Cube with 300 TLV fields
              fields: Array.from({ length: 300 }, () => CubeField.Payload("!")),
              requiredDifficulty: reducedDifficulty
            });
            const spammyBinary: Buffer = await spammyCube.getBinaryData();
            const spamKey: Buffer = await spammyCube.getKey();
            expect(spammyCube.fields.all.length).toBeGreaterThan(300);  // lots of spam
            await cubeStore.addCube(spammyBinary);

            const restored: Cube = await cubeStore.getCube(spamKey);
            expect(restored.fields.all.length).toEqual(3);  // spam ignored
          });
        });

        describe('deleting Cubes', () => {
          it.todo('write tests for deleting Cubes');
        });

        describe('edge cases adding Cubes', () => {
          it('should return undefined when trying to add a corrupt Cube', async () => {
            const corruptCube = Buffer.alloc(1024);
            corruptCube[0] = 0x01;  // Cube version 1
            corruptCube[1] = 0x00;  // Cube type 0
            corruptCube[2] = 0x01;  // TLV field type 1
            corruptCube[3] = 0x01;  // TLV field length 1
            corruptCube[4] = 0x00;  // TLV field value 0
            expect(await cubeStore.addCube(corruptCube)).toBeUndefined;
          });
        });

        describe('edge cases retrieving Cubes', () => {
          it('should return undefined when requesting an unavailable Cube', async () => {
            const mockKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42);
            expect(await cubeStore.getCube(mockKey)).toBeUndefined;
            expect(await cubeStore.getCubeInfo(mockKey)).toBeUndefined;
          });

          it('should return an empty iterable when requesting all entries', async () => {
            expect(await cubeStore.getAllCubeInfos().next()).toBeUndefined;
            expect(await cubeStore.getAllKeys().next()).toBeUndefined;
          });

          it.todo('should return undefined when trying to retrieve a corrupt Cube');
          // This test is not trivial to implement as this case can only happen
          // when using persitent storage, which is not enabled for these tests.
          // Basically a corrupt Cube needs to sneak into the database where it
          // is stored as binary, and trying to construct a CubeInfo for it on
          // retrieval will then fail.
          // This happened in the past when we updated the Cube format and
          // tried to retrieve old Cubes from the database.
        });
      });

      describe('tests involving CCI layer', () => {
        const cubeStoreOptions: CubeStoreOptions&CubePersistenceOptions = {
          enableCubePersistence: EnableCubePersitence.OFF,
          requiredDifficulty: reducedDifficulty,
          enableCubeRetentionPolicy: false,
          family: cciFamily,
        };
        Object.assign(cubeStoreOptions, testOptions);  // mix in options defined in describe.each
        beforeEach(async () => {
          cubeStore = new CubeStore(cubeStoreOptions);
          await cubeStore.readyPromise;
          for await (const key of cubeStore.getAllKeys()) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
        });
        afterEach(async () => {
          for await (const key of cubeStore.getAllKeys()) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          await cubeStore.shutdown();
        });

        it("respects the user's Cube parsing settings", async() => {
          const cube: cciCube = cciCube.Frozen({fields: [
            cciField.Application("Applicatio probandi"),
            cciField.MediaType(MediaTypes.TEXT),
            cciField.Username("Usor probandi"),
            cciField.Payload("In hac applicatio probationis, usor probandi creat contentum probandi, ut programma probatorium confirmet omnem testium datam conservatam esse."),
          ], requiredDifficulty: reducedDifficulty });
          const binaryCube: Buffer = await cube.getBinaryData();
          const key: Buffer = await cube.getKey();
          const added = await cubeStore.addCube(binaryCube);
          expect(added).toBeTruthy();

          const restored: cciCube = await cubeStore.getCube(key) as cciCube;
          expect(restored).toBeTruthy();
          expect(restored).toBeInstanceOf(cciCube);
          expect(restored.fields).toBeInstanceOf(cciFields);
          expect(restored.fields.getFirst(cciFieldType.APPLICATION).value.toString())
            .toEqual("Applicatio probandi");
          expect(restored.fields.getFirst(cciFieldType.MEDIA_TYPE).value.length).toEqual(1);
          expect(restored.fields.getFirst(cciFieldType.MEDIA_TYPE).value[0]).toEqual(
            MediaTypes.TEXT);
          expect(restored.fields.getFirst(cciFieldType.USERNAME).value.toString())
            .toEqual("Usor probandi");
          expect(restored.fields.getFirst(cciFieldType.PAYLOAD).value.toString()).toEqual(
            "In hac applicatio probationis, usor probandi creat contentum probandi, ut programma probatorium confirmet omnem testium datam conservatam esse.");
        });
      });
    });
  });
});
