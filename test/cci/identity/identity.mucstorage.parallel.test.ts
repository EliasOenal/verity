import { cciCube } from "../../../src/cci/cube/cciCube";
import { IdentityOptions, Identity } from "../../../src/cci/identity/identity";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import sodium from "libsodium-wrappers-sumo";

describe("Identity (separate MUC storage test suite for long-running tests)", () => {
  const reducedDifficulty = 0; // no hash cash for testing
  const idTestOptions: IdentityOptions = {
    minMucRebuildDelay: 1, // allow updating Identity MUCs every second
    requiredDifficulty: reducedDifficulty,
    argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
    argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
  };
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore({
      inMemoryLevelDB: true,
      requiredDifficulty: 0, // require no hashcash for faster testing
    });
  });

  describe("MUC storage", () => {
    // This is a particularly long-running test because it makes
    // three consecutive MUC changes, which must each be spaced at least one
    // second apart as our minimal time resolution is one full second.
    // Threfore, it by definition takes at least three seconds.
    it("correctly handles subsequent changes", async () => {
      const id: Identity = await Identity.Create(
        cubeStore,
        "usor probationis",
        "clavis probationis",
        idTestOptions
      );
      id.name = "Probator Identitatum";
      const firstMuc: cciCube = await id.store();
      const firstMucHash: Buffer = firstMuc.getHashIfAvailable();
      expect(firstMuc).toBeInstanceOf(cciCube);
      expect(firstMucHash).toBeInstanceOf(Buffer);
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeUndefined();
      expect(id.keyBackupCube).toBeUndefined();

      id.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xda);
      id.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
      const secondMuc: cciCube = await id.store();
      const secondMucHash: Buffer = secondMuc.getHashIfAvailable();
      expect(secondMuc).toBeInstanceOf(cciCube);
      expect(secondMucHash).toBeInstanceOf(Buffer);
      expect(secondMucHash.equals(firstMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeInstanceOf(Buffer);
      expect(id.keyBackupCube).toBeInstanceOf(Buffer);

      id.name = "Probator Identitatum Repetitus";
      const thirdMuc: cciCube = await id.store();
      const thirdMucHash: Buffer = thirdMuc.getHashIfAvailable();
      expect(thirdMuc).toBeInstanceOf(cciCube);
      expect(thirdMucHash).toBeInstanceOf(Buffer);
      expect(thirdMucHash.equals(firstMucHash)).toBeFalsy();
      expect(thirdMucHash.equals(secondMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum Repetitus");
      expect(id.profilepic).toBeInstanceOf(Buffer);
      expect(id.keyBackupCube).toBeInstanceOf(Buffer);
    }, 5000);

    // This is a particularly long-running test because it uses the
    // actual default minimum MUC spacing of 5 seconds, and therefore by
    // definition takes at least 5 seconds.
    it("combines makeMUC requests spaced less than 5 seconds apart", async () => {
      const id: Identity = await Identity.Create(
        cubeStore,
        "usor probationis",
        "clavis probationis",
        { minMucRebuildDelay: 5, requiredDifficulty: reducedDifficulty }
      );
      // Creating a new Identity does build a MUC, although it will never be compiler
      // nor added to the CubeStore.
      // The five second minimum delay till regeneration still applies.
      const firstMuc = id.muc;
      const firstMucDate = firstMuc.getDate();

      id.name = "Probator Distantiae Temporis";
      // store() now requests generation of a new, second MUC.
      // This will not happen, though, as the first MUC is less than five seconds old.
      // Instead, the operation will be rescheduled five seconds from now.
      id.store(); // note there's no "await"

      id.name = "Probator Minimae Distantiae Temporis";
      const thirdMuc: cciCube = await id.store(); // with await this time
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
    }, 10000);
  });
});
