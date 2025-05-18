import { cciCube, cciFamily } from "../../../src/cci/cube/cciCube";
import { Identity } from "../../../src/cci/identity/identity";
import { CubeStore } from "../../../src/core/cube/cubeStore";

import { requiredDifficulty } from "../testcci.definitions";

import sodium from "libsodium-wrappers-sumo";
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe("Identity (separate MUC storage test suite for long-running tests)", () => {
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore({
      inMemory: true,
      enableCubeCache: false,
      requiredDifficulty: 0, // require no hashcash for faster testing
      family: cciFamily,
    });
  });

  describe("MUC storage", () => {
    // This is a particularly long-running test because it uses the
    // actual default minimum MUC spacing of 5 seconds, and therefore by
    // definition takes at least 5 seconds.
    it("combines makeMUC requests spaced less than 5 seconds apart", async () => {
      const id: Identity = await Identity.Create(
        cubeStore,
        "usor probationis",
        "clavis probationis",
        { minMucRebuildDelay: 5, requiredDifficulty }
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
