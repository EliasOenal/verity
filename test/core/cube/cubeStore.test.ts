import { Settings } from '../../../src/core/settings';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

import { CubeFieldLength, CubeFieldType, CubeKey, CubeType, NotificationKey } from '../../../src/core/cube/coreCube.definitions';
import { CubeIteratorOptions } from '../../../src/core/cube/cubeRetrieval.definitions';
import { CoreCube, coreCubeFamily } from '../../../src/core/cube/coreCube';
import { CubeStore, CubeStoreOptions } from '../../../src/core/cube/cubeStore';
import { Sublevels } from '../../../src/core/cube/levelBackend';
import { CubeField } from '../../../src/core/cube/cubeField';

import { VerityField } from '../../../src/cci/cube/verityField';
import { Cube, cciFamily } from '../../../src/cci/cube/cube';
import { VerityFields } from '../../../src/cci/cube/verityFields';

import { paddedBuffer } from '../../../src/core/cube/cubeUtil';
import { MediaTypes, FieldType } from '../../../src/cci/cube/cube.definitions';
import { CubeFields } from '../../../src/core/cube/cubeFields';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { asNotificationKey, keyVariants } from '../../../src';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';

// declarations
let cubeStore: CubeStore;
const reducedDifficulty = 0;

// helper functions
async function populateStore(num: number, notify?: NotificationKey): Promise<CubeKey[]> {
  const keys: CubeKey[] = [];
  const cubeType = notify ? CubeType.PIC_NOTIFY : CubeType.PIC;
  for (let i = 0; i < num; i++) {
    const cube = CoreCube.Create({
      cubeType,
      fields: CubeField.RawContent(cubeType, `Cubus numero ${i}`),
      requiredDifficulty: reducedDifficulty
    })
    keys.push(await cube.getKey());
    await cubeStore.addCube(cube);
  }
  return keys;
}

// TODO: Add tests involving Cube deletion
// TODO: Add tests checking Tree of Wisdom state (partilarly in combination with deletion)

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

  let publicKey: Buffer;
  let privateKey: Buffer;

  beforeAll(async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    publicKey = Buffer.from(keyPair.publicKey);
    privateKey = Buffer.from(keyPair.privateKey);
  })
  describe('tests at full difficulty', () => {
    // If these tests actually calculate hashcash, let's keep them to an absolute
    // minimum if we can.
    beforeEach(async () => {
      cubeStore = new CubeStore({
        inMemory: true,
        requiredDifficulty: Settings.REQUIRED_DIFFICULTY,
        enableCubeRetentionPolicy: false,
      });

      await cubeStore.readyPromise;
    });

    it('should add a freshly sculpted cube at full difficulty', async () => {
      expect(await cubeStore.getNumberOfStoredCubes()).toEqual(0);
      const content = paddedBuffer("Ego sum cubus recens sculputus.", CubeFieldLength[CubeFieldType.FROZEN_RAWCONTENT]!);
      const cube = CoreCube.Frozen({
        fields: new CubeField(CubeFieldType.FROZEN_RAWCONTENT, content),
      });
      const key = await cube.getKey();
      await cubeStore.addCube(cube);
      expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);

      const restored: CoreCube = await cubeStore.getCube(key);
      expect(restored).toBeInstanceOf(CoreCube);
      expect(restored.getFirstField(CubeFieldType.FROZEN_RAWCONTENT).
        value).toEqual(content);
    });

    it('should add a cube from binary data', async () => {
      const cube: CoreCube = await cubeStore.addCube(validBinaryCube);
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
      const buffer = Buffer.alloc(32) as CubeKey;
      expect(await cubeStore.getCube(buffer)).toBeUndefined();
    }, 3000);

    it('should not add cubes with insufficient difficulty', async () => {
      const cube = CoreCube.Frozen({
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
      { inMemoryLevelDB: true, cubeCacheEnabled: true, },
      { inMemoryLevelDB: true, cubeCacheEnabled: false, },
      { inMemoryLevelDB: false, cubeCacheEnabled: true, },
      { inMemoryLevelDB: false, cubeCacheEnabled: false, },
    ])('tests run multiple times with different CubeStore configurations', (testOptions) => {
      describe(`core level tests with ${testOptions.inMemoryLevelDB? 'in-memory DB' : 'persistent DB'} and ${testOptions.cubeCacheEnabled? 'CubeCache enabled' : 'no Cube cache'}`, () => {
        const cubeStoreOptions: CubeStoreOptions = {
          requiredDifficulty: reducedDifficulty,
          enableCubeRetentionPolicy: false,
          dbName: 'cubes.test',
          dbVersion: 1,
          ...testOptions,
        };
        beforeAll(async () => {
          cubeStore = new CubeStore(cubeStoreOptions);
          await cubeStore.readyPromise;
        });
        beforeEach(async () => {
          await cubeStore.wipeAll();
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
        });
        afterEach(async () => {
          await cubeStore.wipeAll();
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
        }, 5000);
        afterAll(async () => {
          await cubeStore.shutdown();
        });

        describe('adding and retrieving Cubes', () => {
          it('should add 2 Cubes and get them back [testing getAllCubeInfos()]', async () => {
            const first: CoreCube = CoreCube.Frozen({
              fields: CubeField.RawContent(
                CubeType.FROZEN, "Cubus probationis primus"),
              requiredDifficulty: reducedDifficulty,
            });
            const second: CoreCube = CoreCube.Frozen({
              fields: CubeField.RawContent(
                CubeType.FROZEN, "Cubus probationis secundus"),
              requiredDifficulty: reducedDifficulty,
            });
            await cubeStore.addCube(first);
            await cubeStore.addCube(second);
            expect(await cubeStore.getNumberOfStoredCubes()).toBe(2);

            const firstRestored: CoreCube = await cubeStore.getCube(await first.getKey());
            const secondRestored: CoreCube = await cubeStore.getCube(await second.getKey());
            expect(firstRestored.getFirstField(CubeFieldType.FROZEN_RAWCONTENT)
              .valueString).toContain("Cubus probationis primus");
            expect(secondRestored.getFirstField(CubeFieldType.FROZEN_RAWCONTENT)
              .valueString).toContain("Cubus probationis secundus");
            // ensure we actually restored two different Cubes
            expect(await firstRestored.getKey()).not.toEqual(await secondRestored.getKey());
          }, 1000);

          it('should add 20 Cubes and get them back [testing getCube() and getNumberOfStoredCubes()]', async () => {
            // create 20 cubes and wait till they are stored
            const cubes: CoreCube[] = [];
            for (let i = 0; i < 20; i++) {
              const cube = CoreCube.Frozen({
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
              const restoredCube: CoreCube = await cubeStore.getCube(key);
              expect(restoredCube).toBeInstanceOf(CoreCube);
              const binaryData = await cube.getBinaryData();
              expect(await (restoredCube.getBinaryData())).toEqual(binaryData);
            };
            const cubesStored: number = await cubeStore.getNumberOfStoredCubes();
            expect(cubesStored).toEqual(20);
          }, 5000);

          it('should update the initial MUC with a newer MUC of the same key', async () => {
            // Generate a key pair for testing
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);

            // Create original MUC
            const muc = CoreCube.MUC(publicKey, privateKey, {
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
            const muc2 = CoreCube.MUC(publicKey, privateKey, {
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
            const retrievedMuc = await cubeStore.getCube(key);
            expect(retrievedMuc).toBeInstanceOf(CoreCube);
            expect(retrievedMuc.getDate()).toEqual(1695340001);
          }, 5000);

          it('should update the initial MUC with a newer version updated in-place', async () => {
            // Generate a key pair for testing
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);

            // Create MUC
            const muc = CoreCube.MUC(publicKey, privateKey, {
              fields: CubeField.RawContent(CubeType.MUC,
                "Sum cubus usoris mutabilis, signatus a domino meo."),
              requiredDifficulty: reducedDifficulty
            });
            muc.setDate(1695340000);
            const key = await muc.getKey();
            let info = await muc.getCubeInfo();
            expect(muc.getDate()).toEqual(1695340000);
            expect(info.date).toEqual(1695340000);
            await cubeStore.addCube(muc);
            expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);
            expect((await cubeStore.getCube(key)).getDate()).toEqual(1695340000);
            expect((await cubeStore.getCubeInfo(key)).date).toEqual(1695340000);

            // update MUC
            muc.getFirstField(CubeFieldType.MUC_RAWCONTENT).value =
              paddedBuffer(
                "Actualizatus sum a domino meo, sed clavis mea semper eadem est.",
                CubeFieldLength[CubeFieldType.MUC_RAWCONTENT]!);
            // Make sure date is ever so slightly newer
            muc.setDate(1695340001);
            await muc.compile();
            info = await muc.getCubeInfo();
            const keyCompare = await muc.getKey();
            expect(keyCompare.equals(key)).toBe(true);
            expect(muc.getDate()).toEqual(1695340001);
            expect(info.date).toEqual(1695340001);
            await cubeStore.addCube(muc);
            expect(await cubeStore.getNumberOfStoredCubes()).toEqual(1);  // still 1, MUC just updated

            // Verify that the first MUC has been updated with the second MUC
            const retrievedMuc = await cubeStore.getCube(key);
            expect(retrievedMuc).toBeInstanceOf(CoreCube);
            expect(retrievedMuc.getDate()).toEqual(1695340001);
          }, 5000);

          it('correctly stores and retrieves a binary MUC', async () => {
            // Generate a key pair for testing
            await sodium.ready;
            const keyPair = sodium.crypto_sign_keypair();
            const publicKey: Buffer = Buffer.from(keyPair.publicKey);
            const privateKey: Buffer = Buffer.from(keyPair.privateKey);

            const muc = CoreCube.MUC(publicKey, privateKey, {
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
            const restoredpayload = (await restoredmuc)?.getFirstField(CubeFieldType.MUC_RAWCONTENT);
            expect(restoredpayload).toBeDefined();
            expect(restoredpayload?.valueString).toContain(
              "Etiam post conversionem in binarium et reversionem, idem cubus usoris mutabilis sum.");
          });

          it('should not parse TLV fields by default', async () => {
            const spammyCube = Cube.Frozen({  // Cube with 300 TLV fields
              fields: Array.from({ length: 300 }, () => VerityField.Payload("!")),
              requiredDifficulty: reducedDifficulty,
            });
            const spammyBinary: Buffer = await spammyCube.getBinaryData();
            const spamKey: CubeKey = await spammyCube.getKey();
            expect(spammyCube.fieldCount).toBeGreaterThan(300);  // lots of spam
            await cubeStore.addCube(spammyBinary);

            const restored: CoreCube = await cubeStore.getCube(spamKey);
            expect(restored.fieldCount).toEqual(4);  // spam ignored
          });
        });

        describe('addCube() special features', () => {
          describe('PMUC_UPDATE_COUNT auto-increment', () => {
            describe('auto-increment tests', () => {
              it('should set the count to 1 if no previous version exists', async () => {
                const cube = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: CubeField.RawContent(CubeType.PMUC,
                    "Pudibundus sum. Certus sum me primum fore, sed alium id mihi dicere volo."
                  ),
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(cube);

                expect(cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);

                const restored = await cubeStore.getCube(cube.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);
              });

              it('should also auto-increment a zero count to one on a notification PMUC', async () => {
                const notificationKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42) as NotificationKey;
                const cube = CoreCube.Create({
                  cubeType: CubeType.PMUC_NOTIFY,
                  fields: [
                    CubeField.RawContent(CubeType.PMUC_NOTIFY,
                      "Pudibundus sum. Certus sum me primum fore, sed alium id mihi dicere volo."
                    ),
                    CubeField.Notify(notificationKey),
                  ],
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                expect(cube.cubeType).toEqual(CubeType.PMUC_NOTIFY);
                await cubeStore.addCube(cube);

                expect(cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);

                const restored = await cubeStore.getCube(cube.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);
              });

              it('should increment the count if a previous version exists', async () => {
                const previous = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: [
                    CubeField.RawContent(CubeType.PMUC, "Ego prior adfui."),
                    CubeField.PmucUpdateCount(1337),
                  ],
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(previous);

                const cube = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: CubeField.RawContent(CubeType.PMUC,
                    "Vita mea ab aliis determinatur. Ab alio meum locum indicante dependeo."
                  ),
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(cube);

                expect(cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1338);

                const restored = await cubeStore.getCube(cube.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1338);
              });

              it('should recompile the Cube if necessary', async () => {
                const cube = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: CubeField.RawContent(CubeType.PMUC,
                    "Pudibundus sum. Certus sum me primum fore, sed alium id mihi dicere volo."
                  ),
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cube.compile();
                await cubeStore.addCube(cube);

                expect(cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);

                const restored = await cubeStore.getCube(cube.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);
              });

              it('should start the count at 1 if the previous version does not have a counter', async () => {
                // The previous version in this case is a plain MUC;
                // thus it does not have a PMUC_UPDATE_COUNT field.
                const previous = CoreCube.Create({
                  cubeType: CubeType.MUC,
                  fields: CubeField.RawContent(CubeType.MUC, "Cubus sine numero"),
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(previous);

                const cube = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: CubeField.RawContent(CubeType.PMUC,
                    "Hic simplex cubus usoris mutabilis renovabitur ut fiat cubus usoris mutabilis persistens."
                  ),
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(cube);

                expect(cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);

                const restored = await cubeStore.getCube(cube.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1);
              });
            });  // auto-increment tests

            describe('negative feature tests', () => {
              it('should do nothing if a manual update count is set (Cube accepted case)', async () => {
                const cube = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: [
                    CubeField.RawContent(CubeType.PMUC, "Ne auderis numerum mihi attribuere!"),
                    CubeField.PmucUpdateCount(4711),
                  ],
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(cube);

                expect(cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(4711);

                const restored = await cubeStore.getCube(cube.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(4711);
              });

              it('should do nothing if a manual update count is set (Cube refused case)', async () => {
                const newer = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: [
                    CubeField.RawContent(CubeType.PMUC, "Haec est versio recentior."),
                    CubeField.PmucUpdateCount(1337),
                  ],
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(newer);

                const candidate = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: [
                    CubeField.RawContent(CubeType.PMUC, "Haec est versio vetustior."),
                    CubeField.PmucUpdateCount(42),
                  ],
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                await cubeStore.addCube(candidate);

                expect(candidate.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(42);

                const restored = await cubeStore.getCube(candidate.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(1337);
              });

              it('should by default not auto-increment on Cubes supplied as binary (e.g. arriving over the wire)', async () => {
                const cube = CoreCube.Create({
                  cubeType: CubeType.PMUC,
                  fields: CubeField.RawContent(CubeType.PMUC,
                    "Nullius numeri sum et id te non pertinet."
                  ),
                  publicKey, privateKey,
                  requiredDifficulty: 0,
                });
                const bin = await cube.getBinaryData();
                await cubeStore.addCube(bin);

                expect(cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(0);

                const restored = await cubeStore.getCube(cube.getKeyIfAvailable());
                expect(restored.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT).value
                  .readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toEqual(0);
              });

              // Feature not implemented yet
              it.todo('should not auto-increment if there are no changes compared to the last version');
            });
          });
        });

        describe('getKeyRange() method', () => {
          it('should return keys within the specified range using gt and lt', async () => {
            expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
            const keys = await populateStore(10);
            expect(await cubeStore.getNumberOfStoredCubes()).toBe(10);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { gt: keys[3], lt: keys[7] };
            const resultKeys: CubeKey[] = [];

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
            const resultKeys: CubeKey[] = [];

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

            const resultKeys: CubeKey[] = [];
            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(3);
          });

          it('should respect both filtering and limit at the same time', async () => {
            const keys = await populateStore(10);
            keys.sort(Buffer.compare);

            const options: CubeIteratorOptions = { gte: keys[3], lte: keys[7], limit: 2 };
            const resultKeys: CubeKey[] = [];

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
            const resultKeys: CubeKey[] = [];

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
            const resultKeys: CubeKey[] = [];

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
            const resultKeys: CubeKey[] = [];

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
            const resultKeys: CubeKey[] = [];
            for await (const key of cubeStore.getKeyRange(options)) {
              resultKeys.push(key);
            }
            expect(resultKeys).toHaveLength(0);
          });

          it('supports filtering on the notification DBs with full database keys', async () => {
            // create five notifications to the same key
            const n = 5;
            const notificationKey = asNotificationKey(
              Buffer.alloc(NetConstants.NOTIFY_SIZE, 0x1337));
            const notifications: CoreCube[] = [];
            for (let i = 0; i < n; i++) {
              const notification = CoreCube.Create({
                cubeType: CubeType.PIC_NOTIFY,
                fields: [
                  CubeField.Notify(notificationKey),
                  CubeField.Date(148302000 + 1),  // fixed dates, thus fixed keys for ease of debugging
                  CubeField.RawContent(CubeType.PIC_NOTIFY, `Notification numero ${i}`),
                ],
                requiredDifficulty: reducedDifficulty
              });
              notifications.push(notification);
              await cubeStore.addCube(notification);
            }

            const keyStrings: string[] = notifications
              .map((n) => n.getKeyStringIfAvailable())
              .sort();
            expect(keyStrings).toHaveLength(n);

            // perform tests:
            // - all keys
            const dbKeyStrings: string [] = await ArrayFromAsync(cubeStore.getKeyRange({
              sublevel: Sublevels.INDEX_DIFF,
              getRawSublevelKeys: true,
              asString: true,
            }));

            // check that the raw DB keys actually represent the correct Cube keys
            expect(dbKeyStrings
              .map(k => k.substring(k.length-NetConstants.CUBE_KEY_SIZE*2))
              .sort())
              .toEqual(keyStrings);

            // - range inclusive to exclusive with two matching keys: [1, 3)
            expect(await ArrayFromAsync(cubeStore.getKeyRange({
              sublevel: Sublevels.INDEX_DIFF,
              gte: keyVariants(dbKeyStrings[1]).binaryKey as CubeKey,
              lt: keyVariants(dbKeyStrings[3]).binaryKey as CubeKey,
              getRawSublevelKeys: true,
              asString: true,
            }))).toEqual([
              dbKeyStrings[1],
              dbKeyStrings[2],
            ]);

            // - range inclusive to exclusive with a single matching key: (3, 4]
            expect(await ArrayFromAsync(cubeStore.getKeyRange({
              sublevel: Sublevels.INDEX_DIFF,
              gte: keyVariants(dbKeyStrings[3]).binaryKey as CubeKey,
              lt: keyVariants(dbKeyStrings[4]).binaryKey as CubeKey,
              getRawSublevelKeys: true,
              asString: true,
            }))).toEqual([
              dbKeyStrings[3],
            ]);

            // - empty range exclusive to exclusive: (3, 4)
            expect(await ArrayFromAsync(cubeStore.getKeyRange({
              sublevel: Sublevels.INDEX_DIFF,
              gt: keyVariants(dbKeyStrings[3]).binaryKey as CubeKey,
              lt: keyVariants(dbKeyStrings[4]).binaryKey as CubeKey,
              getRawSublevelKeys: true,
              asString: true,
            }))).toEqual([ ]);
          });  // supports filtering on the notification DBs with full database keys

          it.todo('supports filtering on the notification DBs with just Cube keys');
        });  // getKeyRange()

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
          it('should return undefined when the requesting a Cube or CubeInfo with a falsy key', async () => {
            expect(await cubeStore.getCube(undefined!)).toBeUndefined;
            expect(await cubeStore.getCubeInfo(undefined!)).toBeUndefined;
            expect(await cubeStore.getCube('')).toBeUndefined;
            expect(await cubeStore.getCubeInfo('')).toBeUndefined;
            expect(await cubeStore.getCube(Buffer.alloc(0) as CubeKey)).toBeUndefined;
            expect(await cubeStore.getCubeInfo(Buffer.alloc(0) as CubeKey)).toBeUndefined;
          });

          it('should return undefined when requesting an unavailable Cube', async () => {
            const mockKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42) as CubeKey;
            expect(await cubeStore.getCube(mockKey)).toBeUndefined;
            expect(await cubeStore.getCubeInfo(mockKey)).toBeUndefined;
          });

          it('should return an empty iterable when requesting all entries from an empty CubeStore', async () => {
            expect(await cubeStore.getCubeInfoRange().next()).toBeUndefined;
            expect(await cubeStore.getKeyRange().next()).toBeUndefined;
          });

          if (testOptions.inMemoryLevelDB !== true) {
            // This can only happen when using persistent storage.
            // It happened in the past when we updated the Cube format and
            // tried to retrieve old Cubes from the database.
            it('should return undefined when trying to retrieve a corrupt Cube', async () => {
              // craft and store a corrupt Cube
              const corruptCube: Buffer = Buffer.alloc(NetConstants.CUBE_SIZE, 137);
              const key = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 101) as CubeKey;
              // @ts-ignore accessing private member persistence
              await cubeStore.leveldb.store(Sublevels.CUBES, key.toString('hex'), corruptCube);

              // double-check that the Cube is stored in persistent storage
              // @ts-ignore accessing private member persistence
              const stored: Buffer = await cubeStore.leveldb.get(Sublevels.CUBES, key.toString('hex'));
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
            const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42) as NotificationKey;

            // create two Cubes notifying this receiver --
            // this tests sculpts the Cubes "manually" while the next one will
            // use the convenience helpers
            const cube1 = new CoreCube(CubeType.FROZEN_NOTIFY, {
              fields: CubeFields.DefaultPositionals(
                coreCubeFamily.parsers[CubeType.FROZEN_NOTIFY].fieldDef,
                [
                  CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis"),
                  CubeField.Notify(recipientKey),
                ]),
              requiredDifficulty: reducedDifficulty
            });
            await cubeStore.addCube(cube1);

            const cube2 = new CoreCube(CubeType.FROZEN_NOTIFY, {
              fields: CubeFields.DefaultPositionals(
                coreCubeFamily.parsers[CubeType.FROZEN_NOTIFY].fieldDef,
                [
                  CubeField.Notify(recipientKey),  // mix up input field order for extra fuzzing
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
            // by checking that each notification returned actually represents
            // one of the Cubes we sculpted before; and then deleting it from
            // the our list. This should leave us with an empty list, ensuring
            // that no spurious notifications have been returned.
            // Note there is no guarantee on the order of the notifications.
            for await (const notificationInfo of cubeStore.getNotificationCubeInfos(recipientKey)) {
              expect(notificationKeys).toContainEqual(notificationInfo.key);
              notificationKeys = notificationKeys.filter((k) => !k.equals(notificationInfo.key));
            }
            expect(notificationKeys).toHaveLength(0);
          });

          it('should emit notificationAdded events', async () => {
            // prepare event handler
            const notifyKeysEmitted: CubeKey[] = [];
            const notifyCubesEmitted: CoreCube[] = [];
            const handler = (key: CubeKey, cube: CoreCube) => {
              notifyKeysEmitted.push(key);
              notifyCubesEmitted.push(cube)
            }
            cubeStore.on("notificationAdded", handler);

            // sculpt a notification Cube --
            // this test will use the convenience helpers while the previous
            // one sculpted them manually
            const recipientKey1 = Buffer.alloc(NetConstants.NOTIFY_SIZE, 84) as NotificationKey;
            const cube1 = CoreCube.Frozen({
              fields: [
                CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis"),
                CubeField.Notify(recipientKey1),
              ],
              requiredDifficulty: reducedDifficulty,
            })
            await cubeStore.addCube(cube1);

            // check that the notification was emitted
            expect(notifyKeysEmitted.length).toBe(1);
            expect(notifyKeysEmitted[0].equals(recipientKey1)).toBe(true);
            expect(notifyCubesEmitted.length).toBe(1);
            expect(notifyCubesEmitted[0].equals(cube1)).toBe(true);

            // clean up event handler
            cubeStore.removeListener("notificationAdded", handler);
          });

          it('should only return notifications for notified addresses', async () => {
            // sculpt a notification Cube --
            // this test will use the convenience helpers while the previous
            // one sculpted them manually
            const recipientKey1 = Buffer.alloc(NetConstants.NOTIFY_SIZE, 84) as NotificationKey;
            const cube1 = CoreCube.Frozen({
              fields: [
                CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis"),
                CubeField.Notify(recipientKey1),
              ],
              requiredDifficulty: reducedDifficulty,
            })
            await cubeStore.addCube(cube1);

            // sculpt a Cube notifying another receiver
            const recipientKey2 = Buffer.alloc(NetConstants.NOTIFY_SIZE, 1337) as NotificationKey;
            const cube2 = CoreCube.Frozen({
              fields: [
                CubeField.Notify(recipientKey2),
                CubeField.RawContent(CubeType.FROZEN_NOTIFY, "Cubus notificationis pro alio destinatoria"),
              ],
              requiredDifficulty: reducedDifficulty,
            });
            await cubeStore.addCube(cube2);

            // sculpt a non-notification Cube
            const cube3 = CoreCube.Frozen({
              fields: CubeField.RawContent(CubeType.FROZEN, "Hic cubus neminem notificationem facit")
            })
            await cubeStore.addCube(cube3);

            // Ensure the correct Cubes are returned upon notification retrieval
            const notificationsForKey1: CoreCube[] = [];
            for await (const cube of cubeStore.getNotifications(recipientKey1)) {
              notificationsForKey1.push(cube);
            }
            expect(notificationsForKey1).toHaveLength(1);
            expect(await notificationsForKey1[0].getKey()).toEqual(await cube1.getKey());

            const notificationsForKey2: CoreCube[] = [];
            for await (const cube of cubeStore.getNotifications(recipientKey1)) {
              notificationsForKey2.push(cube);
            }
            expect(notificationsForKey2).toHaveLength(1);
            expect(await notificationsForKey2[0].getKey()).toEqual(await cube1.getKey());
          });

          it("should not add notification for non-notification Cube", async () => {
            const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 50);

            // Cube without a NOTIFY field
            const cube = new CoreCube(CubeType.FROZEN, {
              fields: CubeFields.DefaultPositionals(
                coreCubeFamily.parsers[CubeType.FROZEN].fieldDef,
                [CubeField.RawContent(CubeType.FROZEN, "No notification here")]
              ),
              requiredDifficulty: reducedDifficulty,
            });
            await cubeStore.addCube(cube);

            const notifications: CoreCube[] = [];
            for await (const notification of cubeStore.getNotifications(recipientKey)) {
              notifications.push(notification);
            }

            expect(notifications).toHaveLength(0);
          });

          it("should remove notification when Cube is replaced with a non-notification Cube", async () => {
            const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 60) as NotificationKey;

            // Original notification Cube
            const cube1: CoreCube = CoreCube.Create({
              cubeType: CubeType.PMUC_NOTIFY,
              fields: [
                  CubeField.Notify(recipientKey),
                  CubeField.RawContent(CubeType.PMUC_NOTIFY, "Original notification"),
                  CubeField.PmucUpdateCount(1),
              ],
              publicKey, privateKey,
              requiredDifficulty: reducedDifficulty,
            });
            await cubeStore.addCube(cube1);

            // Replacing with a non-notification Cube
            const cube2: CoreCube = CoreCube.Create({
              cubeType: CubeType.PMUC,
              fields: [
                CubeField.RawContent(CubeType.PMUC, "Replaced with no notification"),
                CubeField.PmucUpdateCount(2),
              ],
              requiredDifficulty: reducedDifficulty,
              publicKey, privateKey
            });
            await cubeStore.addCube(cube2);

            const notifications: CoreCube[] = [];
            for await (const notification of cubeStore.getNotifications(recipientKey)) {
              notifications.push(notification);
            }

            expect(notifications).toHaveLength(0);
          });

          it("should index a notification when a non-notification Cube is replaced by a notification Cube", async () => {
            const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 84) as NotificationKey;

            // Initial non-notification Cube
            const nonNotificationCube = CoreCube.Create({
              cubeType: CubeType.PMUC,
              fields: [
                CubeField.RawContent(CubeType.PMUC, "Initial non-notification Cube"),
                CubeField.PmucUpdateCount(1),
              ],
              requiredDifficulty: reducedDifficulty,
              publicKey, privateKey,
            });

            await cubeStore.addCube(nonNotificationCube);

            // Notification Cube replacing the non-notification Cube
            const notificationCube = CoreCube.Create({
              cubeType: CubeType.PMUC_NOTIFY,
              fields: [
                CubeField.Notify(recipientKey),
                CubeField.RawContent(CubeType.PMUC_NOTIFY, "Replacing with notification Cube"),
                CubeField.PmucUpdateCount(2),
              ],
              requiredDifficulty: reducedDifficulty,
              publicKey, privateKey,
            });

            await cubeStore.addCube(notificationCube);

            // Ensure the notification is indexed correctly
            const notifications: CoreCube[] = [];
            for await (const notification of cubeStore.getNotifications(recipientKey)) {
              notifications.push(notification);
            }

            expect(notifications).toHaveLength(1);
            expect(await notifications[0].getKey()).toEqual(await notificationCube.getKey());
          });

          it("should gracefully ignore invalid notification fields without throwing", async () => {
            const validRecipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42) as NotificationKey; // Valid key size
            const invalidRecipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE - 1, 42); // Invalid key size (too short)

            // Cube with valid notification field
            const validCube = CoreCube.Create({
              cubeType: CubeType.FROZEN_NOTIFY,
              fields: CubeField.Notify(validRecipientKey),
              requiredDifficulty: reducedDifficulty,
            });

            // Cube with invalid notification field
            // Note the standard Create is too smart and will not allow this;
            // that's why we're hand-crafting the Cube.
            const invalidCube = new CoreCube(CubeType.FROZEN_NOTIFY, {
              requiredDifficulty: reducedDifficulty,
              fields: CubeFields.DefaultPositionals(
                coreCubeFamily.parsers[CubeType.FROZEN_NOTIFY].fieldDef,
              ),
            });
            invalidCube.getFirstField(CubeFieldType.NOTIFY).value = invalidRecipientKey;

            // Add both Cubes
            await cubeStore.addCube(validCube);
            await cubeStore.addCube(invalidCube);

            // Ensure only the valid notification is stored
            const notifications: CoreCube[] = [];
            for await (const notification of cubeStore.getNotifications(validRecipientKey)) {
              notifications.push(notification);
            }

            expect(notifications).toHaveLength(1); // Only the valid Cube's notification should exist
            expect(await notifications[0].getKey()).toEqual(await validCube.getKey());

            // Ensure no notifications were stored for the invalid key
            const invalidNotifications: CoreCube[] = [];
            for await (const notification of cubeStore.getNotifications(invalidRecipientKey)) {
              invalidNotifications.push(notification);
            }
            expect(invalidNotifications).toHaveLength(0); // No notification for the invalid key
          });
        });  // notification tests

      });  // core level tests

      describe(`tests involving CCI layer with ${testOptions.inMemoryLevelDB? 'in-memory DB' : 'persistent DB'} and ${testOptions.cubeCacheEnabled? 'CubeCache enabled' : 'no Cube cache'}`, () => {
        const cubeStoreOptions: CubeStoreOptions = {
          family: [cciFamily, coreCubeFamily],
          requiredDifficulty: reducedDifficulty,
          enableCubeRetentionPolicy: false,
          dbName: 'cubes.test',
          dbVersion: 1,
          ...testOptions,
        };
        Object.assign(cubeStoreOptions, testOptions);  // mix in options defined in describe.each
        beforeEach(async () => {
          cubeStore = new CubeStore(cubeStoreOptions);
          await cubeStore.readyPromise;
          await cubeStore.wipeAll();
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
        });
        afterEach(async () => {
          await cubeStore.wipeAll();
          expect(await cubeStore.getNumberOfStoredCubes()).toBe(0);
          expect(await cubeStore.getNumberOfNotificationRecipients()).toBe(0);
          await cubeStore.shutdown();
        });

        it("stores CCI Cubes by default", async () => {
          // prepare a CCI Cube
          const cube: Cube = Cube.Frozen({
            fields: [
              VerityField.Application("Applicatio probandi"),
              VerityField.MediaType(MediaTypes.TEXT),
              VerityField.Username("Usor probandi"),
              VerityField.Payload("In hac applicatio probationis, usor probandi creat contentum probandi, ut programma probatorium confirmet omnem testium datam conservatam esse."),
            ], requiredDifficulty: reducedDifficulty
          });
          // compile it to binary -- it's CCI family is now no longer visible
          // as family is a purely local, parsing-related attribute
          const binaryCube: Buffer = await cube.getBinaryData();
          const key: CubeKey = await cube.getKey();
          // add compiled binary Cube to the store
          const added = await cubeStore.addCube(binaryCube);
          expect(added).toBeTruthy();

          // restore Cube from store --
          // expect it to restore as CCI Cube as that's our default setting
          const restored: Cube = await cubeStore.getCube(key) as Cube;
          expect(restored).toBeTruthy();
          expect(restored).toBeInstanceOf(Cube);
          expect(restored.fields).toBeInstanceOf(VerityFields);
          expect(restored.getFirstField(FieldType.APPLICATION).value.toString())
            .toEqual("Applicatio probandi");
          expect(restored.getFirstField(FieldType.MEDIA_TYPE).value.length).toEqual(1);
          expect(restored.getFirstField(FieldType.MEDIA_TYPE).value[0]).toEqual(
            MediaTypes.TEXT);
          expect(restored.getFirstField(FieldType.USERNAME).value.toString())
            .toEqual("Usor probandi");
          expect(restored.getFirstField(FieldType.PAYLOAD).value.toString()).toEqual(
            "In hac applicatio probationis, usor probandi creat contentum probandi, ut programma probatorium confirmet omnem testium datam conservatam esse.");
        });

        it('can still store non-CCI Cubes as core Cubes', async () => {
          // prepare a non-CCI Cube
          const cube: CoreCube = CoreCube.Frozen({ requiredDifficulty: reducedDifficulty });
          const rawContentField = cube.getFirstField(CubeFieldType.FROZEN_RAWCONTENT);
          // fill the raw content field with something that's definitely
          // not CCI-parseable (and notably does not start with 0x00 so the
          // CCI parser doesn't just stop)
          rawContentField.value = Buffer.alloc(rawContentField.length, 0x3F);
          // compile to binary and add to store
          const binaryCube: Buffer = await cube.getBinaryData();
          await cubeStore.addCube(binaryCube);

          // restore Cube from store
          const restored: CoreCube = await cubeStore.getCube(await cube.getKey());
          const restoredContent = restored.getFirstField(CubeFieldType.FROZEN_RAWCONTENT);
          expect(restoredContent.type).toEqual(rawContentField.type);
          expect(restoredContent.value).toEqual(rawContentField.value);
        });
      });
    });
  });
});

