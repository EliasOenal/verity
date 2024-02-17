import { NetConstants } from "../../src/core/networking/networkDefinitions";
import { CubeKey } from "../../src/core/cube/cubeDefinitions";
import { CubeStore } from "../../src/core/cube/cubeStore";
import { Cube } from "../../src/core/cube/cube";
import { Settings } from '../../src/core/settings';

import { Identity, IdentityPersistance } from "../../src/app/identity";
import { makePost } from "../../src/app/zwCubes";
import {
  ZwFieldType,
  ZwFields,
  ZwRelationship,
  ZwRelationshipType,
} from "../../src/app/zwFields";

import sodium from "libsodium-wrappers";

describe("Identity2", () => {
  let cubeStore: CubeStore;
  const reduced_difficulty = 0;

  beforeAll(async () => {
    Settings.CUBE_RETENTION_POLICY = false;
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore({
      enableCubePersistance: false,
      requiredDifficulty: 0, // require no hashcash for faster testing
    });
  });

  it("correctly handles subsequent changes", async () => {
    const id = new Identity(cubeStore, undefined, undefined, true, 1); // reduce min time between MUCs to one second for this test
    id.name = "Probator Identitatum";
    const firstMuc: Cube = await id.store(reduced_difficulty);
    const firstMucHash: Buffer = firstMuc.getHashIfAvailable();
    expect(firstMuc).toBeInstanceOf(Cube);
    expect(firstMucHash).toBeInstanceOf(Buffer);
    expect(id.name).toEqual("Probator Identitatum");
    expect(id.profilepic).toBeUndefined();
    expect(id.keyBackupCube).toBeUndefined();

    id.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xda);
    id.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
    const secondMuc: Cube = await id.store(reduced_difficulty);
    const secondMucHash: Buffer = secondMuc.getHashIfAvailable();
    expect(secondMuc).toBeInstanceOf(Cube);
    expect(secondMucHash).toBeInstanceOf(Buffer);
    expect(secondMucHash.equals(firstMucHash)).toBeFalsy();
    expect(id.name).toEqual("Probator Identitatum");
    expect(id.profilepic).toBeInstanceOf(Buffer);
    expect(id.keyBackupCube).toBeInstanceOf(Buffer);

    id.name = "Probator Identitatum Repetitus";
    const thirdMuc: Cube = await id.store(reduced_difficulty);
    const thirdMucHash: Buffer = thirdMuc.getHashIfAvailable();
    expect(thirdMuc).toBeInstanceOf(Cube);
    expect(thirdMucHash).toBeInstanceOf(Buffer);
    expect(thirdMucHash.equals(firstMucHash)).toBeFalsy();
    expect(thirdMucHash.equals(secondMucHash)).toBeFalsy();
    expect(id.name).toEqual("Probator Identitatum Repetitus");
    expect(id.profilepic).toBeInstanceOf(Buffer);
    expect(id.keyBackupCube).toBeInstanceOf(Buffer);
  }, 30000);

  describe("MUC storage", () => {
    it("combines makeMUC requests spaced less than 5 seconds apart", async () => {
      const id: Identity = new Identity(cubeStore);
      // Creating a new Identity does build a MUC, although it will never be compiler
      // nor added to the CubeStore.
      // The five second minimum delay till regeneration still applies.
      const firstMuc = id.muc;
      const firstMucDate = firstMuc.getDate();

      id.name = "Probator Distantiae Temporis";
      // store() now requests generation of a new, second MUC.
      // This will not happen, though, as the first MUC is less than five seconds old.
      // Instead, the operation will be rescheduled five seconds from now.
      id.store(reduced_difficulty); // note there's no "await"

      id.name = "Probator Minimae Distantiae Temporis";
      const thirdMuc: Cube = await id.store(reduced_difficulty); // with await this time
      expect(thirdMuc).toEqual(id.muc);
      expect(thirdMuc.getHashIfAvailable()).toEqual(
        id.muc.getHashIfAvailable()
      );
      const thirdMucDate = thirdMuc.getDate();

      // First (=preliminary) MUC and actual content-bearing MUC should not be equal
      expect(firstMuc).not.toEqual(thirdMuc);

      // MUCs should be spaced at least 5 seconds apart, indicating minimum
      // distance has been observed.
      // They should be spaced less than 10 seconds apart, indicating the two store()
      // opeations have been combined into one.
      const mucTimeDistance = thirdMucDate - firstMucDate;
      expect(mucTimeDistance).toBeGreaterThanOrEqual(5);
      expect(mucTimeDistance).toBeLessThanOrEqual(10);
    }, 20000);
  });
});
