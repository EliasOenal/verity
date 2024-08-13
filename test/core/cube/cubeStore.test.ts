import { Settings } from '../../../src/core/settings';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

import { CubeFieldLength, CubeFieldType, CubeKey, CubeType } from '../../../src/core/cube/cube.definitions';
import { Cube, coreCubeFamily } from '../../../src/core/cube/cube';
import { CubeIteratorOptions, CubeStore as CubeStore, CubeStoreOptions, EnableCubePersitence } from '../../../src/core/cube/cubeStore';
import { CubeField } from '../../../src/core/cube/cubeField';

import { cciField } from '../../../src/cci/cube/cciField';
import { cciCube, cciFamily } from '../../../src/cci/cube/cciCube';
import { cciFields } from '../../../src/cci/cube/cciFields';

import sodium from 'libsodium-wrappers-sumo'
import { paddedBuffer, parsePersistentNotificationBlob, writePersistentNotificationBlob } from '../../../src/core/cube/cubeUtil';
import { MediaTypes, cciFieldType } from '../../../src/cci/cube/cciCube.definitions';
import { CubeFields } from '../../../src/core/cube/cubeFields';

// declarations
let cubeStore: CubeStore;
const reducedDifficulty = 0;

// helper functions
async function populateStore(num: number): Promise<CubeKey[]> {
  const keys: CubeKey[] = [];
  for (let i = 0; i < num; i++) {
    const cube = Cube.Frozen({
      fields: CubeField.RawContent(CubeType.FROZEN, `Cubus numero ${i}`),
      requiredDifficulty: reducedDifficulty
    })
    keys.push(await cube.getKey());
    await cubeStore.addCube(cube);
  }
  return keys;
}

// TODO: Add tests involving Cube deletion
// TODO: Add tests checking Tree of Wisdom state (partilarly in combination with deletion)
// TODO: For EnableCubePersistence.PRIMARY mode, add tests verifying the weak
//       ref cache actually works.
//       Also add tests for negative cache, i.e. Cubes unparsable
//       (not parseable at all or at chosen CubeFamily)

describe('cubeStore', () => {
  // TODO: Update payload field ID. Make tests actually check payload.
  const validBinaryCube = Buffer.from([
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
      const content = paddedBuffer("Ego sum cubus recens sculputus.", CubeFieldLength[CubeFieldType.FROZEN_RAWCONTENT]);
      const cube = Cube.Frozen({
        fields: new CubeField(CubeFieldType.FROZEN_RAWCONTENT, content),
      });
      const key = await cube.getKey();
      await cubeStore.addCube(cube);
      expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);

      const restored: Cube = await cubeStore.getCube(key);
      expect(restored).toBeInstanceOf(Cube);
      expect(restored.fields.getFirst(CubeFieldType.FROZEN_RAWCONTENT).
        value).toEqual(content);
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
      const cube = Cube.Frozen({
        fields: CubeField.RawContent(CubeType.FROZEN, "Cubus difficultatis insufficientis"),
        requiredDifficulty: 0,
      });
      expect(await cubeStore.addCube(cube)).toBeUndefined();
      expect(await cubeStore.getNumberOfStoredCubes()).toEqual(0);
    }, 3000);
  });

  describe('tests without hashcash', () => {
    // These tests run at a reduced challenge difficulty setting of zero to
    // make sure our tests don't spend forever calculating hashcash.
    // So should all other Cube-sculpting tests in other units.

    describe.each([
      { enableCubePersistence: EnableCubePersitence.OFF, },
      { enableCubePersistence: EnableCubePersitence.BACKUP, },
      { enableCubePersistence: EnableCubePersitence.PRIMARY, },
    ])('tests run for all three persistence levels', (testOptions) => {
      describe('core level', () => {
        const cubeStoreOptions: CubeStoreOptions = {
          requiredDifficulty: reducedDifficulty,
          enableCubeRetentionPolicy: false,
          cubeDbName: 'cubes.test',
          cubeDbVersion: 1,
          notifyDbName: 'notifications.test',
          notifyDbVersion: 1,
          ...testOptions,
        };
        beforeAll(async () => {
          cubeStore = new CubeStore(cubeStoreOptions);
          await cubeStore.readyPromise;
        });
        beforeEach(async () => {
          for await (const key of cubeStore.getKeyRange({ limit: Infinity })) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
        });
        afterEach(async () => {
          for await (const key of cubeStore.getKeyRange({ limit: Infinity })) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
        }, 360000);
        afterAll(async () => {
          await cubeStore.shutdown();
        });

        describe('adding and retrieving Cubes', () => {
          it('should add 2 Cubes and get them back [testing getAllCubeInfos()]', async () => {
            const first: Cube = Cube.Frozen({
              fields: CubeField.RawContent(
                CubeType.FROZEN, "Cubus probationis primus"),
              requiredDifficulty: reducedDifficulty,
            });
            const second: Cube = Cube.Frozen({
              fields: CubeField.RawContent(
                CubeType.FROZEN, "Cubus probationis secundus"),
              requiredDifficulty: reducedDifficulty,
            });
            await cubeStore.addCube(first);
            await cubeStore.addCube(second);
            expect(await cubeStore.getNumberOfStoredCubes()).toBe(2);

            const firstRestored: Cube = await cubeStore.getCube(await first.getKey());
            const secondRestored: Cube = await cubeStore.getCube(await second.getKey());
            expect(firstRestored.fields.getFirst(CubeFieldType.FROZEN_RAWCONTENT)
              .valueString).toContain("Cubus probationis primus");
            expect(secondRestored.fields.getFirst(CubeFieldType.FROZEN_RAWCONTENT)
              .valueString).toContain("Cubus probationis secundus");
            // ensure we actually restored two different Cubes
            expect(await firstRestored.getKey()).not.toEqual(await secondRestored.getKey());
          }, 1000);

          it('should add 20 Cubes and get them back [testing getCube() and getNumberOfStoredCubes()]', async () => {
            // create 20 cubes and wait till they are stored
            const cubes: Cube[] = [];
            for (let i = 0; i < 20; i++) {
              const cube = Cube.Frozen({
                fields: CubeField.RawContent(CubeType.FROZEN,
                  `Cubus inutilis numero ${i.toString()} in repositorio tuo residens et spatium tuum consumens`),
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
          }, 10000);

          it('should update the initial MUC with the updated MUC', async () => {
            // Generate a key pair for testing
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);

            // Create original MUC
            const muc = Cube.MUC(publicKey, privateKey, {
              fields: CubeField.RawContent(CubeType.MUC,
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
              fields: CubeField.RawContent(CubeType.MUC,
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

          it('correctly stores and retrieves a binary MUC', async () => {
            // Generate a key pair for testing
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);

            const muc = Cube.MUC(publicKey, privateKey, {
              fields: CubeField.RawContent(CubeType.MUC,
                "Etiam post conversionem in binarium et reversionem, idem cubus usoris mutabilis sum."),
              requiredDifficulty: reducedDifficulty
            });
            const muckey = await muc.getKey();
            expect(muckey).toEqual(publicKey);

            const binarymuc = await muc.getBinaryData();
            expect(binarymuc).toBeDefined();
            const cubeadded = await cubeStore.addCube(binarymuc);
            expect(cubeadded.getKeyIfAvailable()).toEqual(muckey);

            const restoredmuc = cubeStore.getCube(muckey);
            expect(restoredmuc).toBeDefined();
            const restoredpayload = (await restoredmuc)?.fields.getFirst(CubeFieldType.MUC_RAWCONTENT);
            expect(restoredpayload).toBeDefined();
            expect(restoredpayload?.valueString).toContain(
              "Etiam post conversionem in binarium et reversionem, idem cubus usoris mutabilis sum.");
          });

          it('should not parse TLV fields by default', async () => {
            const spammyCube = cciCube.Frozen({  // Cube with 300 TLV fields
              fields: Array.from({ length: 300 }, () => cciField.Payload("!")),
              requiredDifficulty: reducedDifficulty,
            });
            const spammyBinary: Buffer = await spammyCube.getBinaryData();
            const spamKey: Buffer = await spammyCube.getKey();
            expect(spammyCube.fields.all.length).toBeGreaterThan(300);  // lots of spam
            await cubeStore.addCube(spammyBinary);

            const restored: Cube = await cubeStore.getCube(spamKey);
            expect(restored.fields.all.length).toEqual(4);  // spam ignored
          });
        });

        describe('getKeyRange() method', () => {
          it('should return keys within the specified range using gt and lt', async () => {
            expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
            const keys = await populateStore(10);
            expect(await cubeStore.getNumberOfStoredCubes()).toBe(10);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { gt: keys[3], lt: keys[7] };
            const resultKeys = [];

            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(3);
            expect(resultKeys).toContainEqual(keys[4]);
            expect(resultKeys).toContainEqual(keys[5]);
            expect(resultKeys).toContainEqual(keys[6]);
          });

          it('should return keys within the specified range using gte and lte', async () => {
            const keys = await populateStore(10);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { gte: keys[3], lte: keys[7] };
            const resultKeys = [];

            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(5);
            expect(resultKeys).toContainEqual(keys[3]);
            expect(resultKeys).toContainEqual(keys[4]);
            expect(resultKeys).toContainEqual(keys[5]);
            expect(resultKeys).toContainEqual(keys[6]);
            expect(resultKeys).toContainEqual(keys[7]);
          });

          it('should respect the limit option (no filtering)', async () => {
            const keys = await populateStore(10);
            const options: CubeIteratorOptions = { limit: 3 };

            const resultKeys = [];
            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(3);
          });

          it('should respect both filtering and limit at the same time', async () => {
            const keys = await populateStore(10);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { gte: keys[3], lte: keys[7], limit: 2 };
            const resultKeys = [];

            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(2);
            expect(resultKeys).not.toContainEqual(keys[0]);
            expect(resultKeys).not.toContainEqual(keys[1]);
            expect(resultKeys).not.toContainEqual(keys[8]);
            expect(resultKeys).not.toContainEqual(keys[9]);
          });

          it('should wrap around if wraparound is true and limit is not reached', async () => {
            const keys = await populateStore(10);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { gte: keys[7], wraparound: true, limit: 5 };
            const resultKeys = [];

            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(5);
            expect(resultKeys).toContainEqual(keys[7]);
            expect(resultKeys).toContainEqual(keys[8]);
            expect(resultKeys).toContainEqual(keys[9]);
            // Note: while it is required that all keys >= 7 are returned,
            // it is completely undefined which keys < 7 are returned.
            // This is because the storage backends are not required to store
            // Cubes sorted by key, and notably the in-memory Map does not.
          });

          it('should not return the same key twice in wraparound mode', async () => {
            const keys = await populateStore(5);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { gt: keys[3], wraparound: true };
            const resultKeys = [];

            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(5);
            expect(resultKeys).toContainEqual(keys[0]);
            expect(resultKeys).toContainEqual(keys[1]);
            expect(resultKeys).toContainEqual(keys[2]);
            expect(resultKeys).toContainEqual(keys[3]);
            expect(resultKeys).toContainEqual(keys[4]);
          });

          it('should return keys as strings when asString option is true', async () => {
            const keys = await populateStore(5);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { asString: true };
            const resultKeys = [];

            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(5);
            expect(resultKeys).toContainEqual(keys[0].toString('hex'));
            expect(resultKeys).toContainEqual(keys[1].toString('hex'));
            expect(resultKeys).toContainEqual(keys[2].toString('hex'));
            expect(resultKeys).toContainEqual(keys[3].toString('hex'));
            expect(resultKeys).toContainEqual(keys[4].toString('hex'));
          });

          it('should return no keys if the limit is set to 0', async () => {
            const keys = await populateStore(5);
            const options: CubeIteratorOptions = { limit: 0 };
            const resultKeys = [];
            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(0);
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
        });  // edge cases adding Cubes

        describe('edge cases retrieving Cubes', () => {
          it('should return undefined when requesting an unavailable Cube', async () => {
            const mockKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42);
            expect(await cubeStore.getCube(mockKey)).toBeUndefined;
            expect(await cubeStore.getCubeInfo(mockKey)).toBeUndefined;
          });

          it('should return an empty iterable when requesting all entries from an empty CubeStore', async () => {
            expect(await cubeStore.getCubeInfoRange().next()).toBeUndefined;
            expect(await cubeStore.getKeyRange().next()).toBeUndefined;
          });

          if (testOptions.enableCubePersistence !== EnableCubePersitence.OFF) {
            // This can only happen when using persistent storage.
            // It happened in the past when we updated the Cube format and
            // tried to retrieve old Cubes from the database.
            it('should return undefined when trying to retrieve a corrupt Cube', async () => {
              // craft and store a corrupt Cube
              const corruptCube: Buffer = Buffer.alloc(NetConstants.CUBE_SIZE, 137);
              const key: Buffer = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 101);
              // @ts-ignore accessing private member persistence
              await cubeStore.cubePersistence.store(key.toString('hex'), corruptCube);

              // double-check that the Cube is stored in persistent storage
              // @ts-ignore accessing private member persistence
              const stored: Buffer = await cubeStore.cubePersistence.get(key.toString('hex'));
              expect(stored).toEqual(corruptCube);

              // expect CubeStore to just return undefined
              expect(await cubeStore.getCube(key)).toBeUndefined;
              // note: the result of getCubeInfo() in this case is undefined
            });
          }  // end of tests only performed with persistent storage
        });  // edge cases retrieving Cubes

        describe('Notification tests', () => {
          it('should index and retrieve notifications correctly', async () => {
            // choose a notification recipient key
            const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42);

            // create two Cubes notifying this receiver --
            // this tests sculpts the Cubes "manually" while the next one will
            // use the convenience helpers
            const cube1 = new Cube(CubeType.FROZEN_NOTIFY, {
              fields: CubeFields.DefaultPositionals(
                coreCubeFamily.parsers[CubeType.FROZEN_NOTIFY].fieldDef,
                [
                  CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis"),
                  CubeField.Notify(recipientKey),
                ]),
              requiredDifficulty: reducedDifficulty
            });
            await cubeStore.addCube(cube1);

            const cube2 = new Cube(CubeType.FROZEN_NOTIFY, {
              fields: CubeFields.DefaultPositionals(
                coreCubeFamily.parsers[CubeType.FROZEN_NOTIFY].fieldDef,
                [
                  CubeField.Notify(recipientKey),  // mix up input field or a bit for extra fuzzing
                  CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Hic receptor notificationis popularis est"),
                ]),
              requiredDifficulty: reducedDifficulty
            });
            await cubeStore.addCube(cube2);

            let notificationKeys: CubeKey[] = [
              await cube1.getKey(),
              await cube2.getKey(),
            ];

            // Ensure that the notifications have correctly been retrieved
            // by checking that each notification returned has indeed been made
            // and deleting it from our list. This should leave us with an empty list.
            // Note there is no guarantee on the order of the notifications --
            // ensure both notifications are present in the returned CubeInfos
            for await (const notificationInfo of cubeStore.getNotificationCubeInfos(recipientKey)) {
              expect(notificationKeys).toContainEqual(notificationInfo.key);
              notificationKeys = notificationKeys.filter((k) => !k.equals(notificationInfo.key));
            }
            expect(notificationKeys).toHaveLength(0);
          });

          it('should only return notifications for notified addresses', async () => {
            // sculpt a notification Cube --
            // this test will use the convenience helpers while the previous
            // one sculpted them manually
            const recipientKey1 = Buffer.alloc(NetConstants.NOTIFY_SIZE, 84);
            const cube1 = Cube.Frozen({
              fields:                 [
                CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis"),
                CubeField.Notify(recipientKey1),
              ],
              requiredDifficulty: reducedDifficulty,
            })
            await cubeStore.addCube(cube1);

            // sculpt a Cube notifying another receiver
            const recipientKey2 = Buffer.alloc(NetConstants.NOTIFY_SIZE, 1337);
            const cube2 = Cube.Frozen({
              fields: [
                CubeField.Notify(recipientKey2),
                CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis pro alio destinatoria"),
              ],
              requiredDifficulty: reducedDifficulty,
            });
            await cubeStore.addCube(cube2);

            // sculpt a non-notification Cube
            const cube3 = Cube.Frozen({
              fields: CubeField.RawContent(CubeType.FROZEN, "Hic cubus neminem notificationem facit")
            })
            await cubeStore.addCube(cube3);

            // Ensure the correct Cubes are returned upon notification retrieval
            const notificationsForKey1: Cube[] = [];
            for await (const cube of cubeStore.getNotificationCubes(recipientKey1)) {
              notificationsForKey1.push(cube);
            }
            expect(notificationsForKey1).toHaveLength(1);
            expect(await notificationsForKey1[0].getKey()).toEqual(await cube1.getKey());

            const notificationsForKey2: Cube[] = [];
            for await (const cube of cubeStore.getNotificationCubes(recipientKey1)) {
              notificationsForKey2.push(cube);
            }
            expect(notificationsForKey2).toHaveLength(1);
            expect(await notificationsForKey2[0].getKey()).toEqual(await cube1.getKey());
          });
        });  // NOTIFY tests
      });  // core level tests

      describe('tests involving CCI layer', () => {
        const cubeStoreOptions: CubeStoreOptions = {
          family: cciFamily,
          requiredDifficulty: reducedDifficulty,
          enableCubeRetentionPolicy: false,
          cubeDbName: 'cubes.test',
          cubeDbVersion: 1,
          notifyDbName: 'notifications.test',
          notifyDbVersion: 1,
          ...testOptions,
        };
        Object.assign(cubeStoreOptions, testOptions);  // mix in options defined in describe.each
        beforeEach(async () => {
          cubeStore = new CubeStore(cubeStoreOptions);
          await cubeStore.readyPromise;
          for await (const key of cubeStore.getKeyRange({ limit: Infinity })) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
        });
        afterEach(async () => {
          for await (const key of cubeStore.getKeyRange({ limit: Infinity })) await cubeStore.deleteCube(key);
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
          await cubeStore.shutdown();
        });

        it("respects the user's Cube parsing settings", async () => {
          const cube: cciCube = cciCube.Frozen({
            fields: [
              cciField.Application("Applicatio probandi"),
              cciField.MediaType(MediaTypes.TEXT),
              cciField.Username("Usor probandi"),
              cciField.Payload("In hac applicatio probationis, usor probandi creat contentum probandi, ut programma probatorium confirmet omnem testium datam conservatam esse."),
            ], requiredDifficulty: reducedDifficulty
          });
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
