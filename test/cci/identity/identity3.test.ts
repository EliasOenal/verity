import { CubeStore } from '../../../src/core/cube/cubeStore';
import { Identity, IdentityOptions } from '../../../src/cci/identity/identity'
import { cciFields, cciRelationship, cciRelationshipType } from '../../../src/cci/cube/cciFields';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { Settings } from '../../../src/core/settings';
import sodium from "libsodium-wrappers-sumo";

Settings.CUBE_RETENTION_POLICY = false;

describe('Identity3', () => {
  const reducedDifficulty = 0;  // no hash cash for testing
  const idTestOptions: IdentityOptions = {
    minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
    requiredDifficulty: reducedDifficulty,
  }
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore({
      enableCubePersistance: false,
      requiredDifficulty: 0,  // require no hashcash for faster testing
    });
  });

  describe("subscription recommendations", () => {
    // TODO reduce this test's load, probably caused by lots of key derivations
    it("correctly saves and restores recommended subscriptions to and from extension MUCs", async () => {
      // Create a subject and subscribe 100 other authors
      const TESTSUBCOUNT = 100;
      const subject: Identity = Identity.Create(
        cubeStore,
        "subscriptor",
        "clavis mea",
        idTestOptions
      );
      subject.name = "Subscriptor novarum interessantiarum";
      for (let i = 0; i < TESTSUBCOUNT; i++) {
        const other: Identity = Identity.Create(
          cubeStore,
          "figurarius" + i,
          "clavis" + i,
          idTestOptions
        );
        other.name = "Figurarius " + i + "-tus";
        other.muc.setDate(0); // skip waiting period for the test
        other.store(undefined, reducedDifficulty);
        subject.addSubscriptionRecommendation(other.key);
        expect(
          subject.subscriptionRecommendations[i].equals(other.key)
        ).toBeTruthy();
      }
      subject.muc.setDate(0); // hack, just for the test let's not wait 5s for the MUC update
      const muc: cciCube = await subject.store(undefined, reducedDifficulty);

      // Master MUC stored in CubeStore?
      const recovered_muc: cciCube = cubeStore.getCube(subject.key) as cciCube;
      expect(recovered_muc).toBeInstanceOf(cciCube);

      // First subscription recommendation index saved in MUC?
      const fields: cciFields = recovered_muc.fields as cciFields;
      expect(fields).toBeInstanceOf(cciFields);
      const rel: cciRelationship = fields.getFirstRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX
      );
      expect(rel.remoteKey).toBeInstanceOf(Buffer);
      expect(
        rel.remoteKey.equals(
          subject.subscriptionRecommendationIndices[0].getKeyIfAvailable()
        )
      ).toBeTruthy();
      // First subscription recommendation index saved in CubeStore?
      const firstIndexCube: cciCube = cubeStore.getCube(
        rel.remoteKey
      ) as cciCube;
      expect(firstIndexCube).toBeInstanceOf(cciCube);
      // First subscription recommendation index contains for subscription recommendation?
      expect(firstIndexCube.fields).toBeInstanceOf(cciFields);
      expect(firstIndexCube.fields.count()).toBeGreaterThan(1);
      expect(
        firstIndexCube.fields
          .getFirstRelationship(cciRelationshipType.SUBSCRIPTION_RECOMMENDATION)
          .remoteKey.equals(subject.subscriptionRecommendations[0])
      ).toBeTruthy();

      // Second subscription recommendation index referred from first one?
      const secondIndexRel: cciRelationship =
        firstIndexCube.fields.getFirstRelationship(
          cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX
        );
      expect(secondIndexRel).toBeInstanceOf(cciRelationship);
      const secondIndexCube: cciCube = cubeStore.getCube(
        secondIndexRel.remoteKey
      ) as cciCube;
      expect(secondIndexCube).toBeInstanceOf(cciCube);

      // let's put it all together:
      // all subscription recommendations correctly restored?
      const restored: Identity = new Identity(cubeStore, muc);
      expect(restored.subscriptionRecommendations.length).toEqual(TESTSUBCOUNT);
      for (let i = 0; i < TESTSUBCOUNT; i++) {
        const othermuc = cubeStore.getCube(
          restored.subscriptionRecommendations[i]
        ) as cciCube;
        expect(othermuc).toBeInstanceOf(cciCube);
        const restoredother: Identity = new Identity(cubeStore, othermuc);
        expect(restoredother.name).toEqual("Figurarius " + i + "-tus");
      }
    }, 30000);
  });
});
