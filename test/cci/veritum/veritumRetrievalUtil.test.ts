import sodium from 'libsodium-wrappers-sumo'

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { testCciOptions } from '../testcci.definitions';
import { VerityField } from '../../../src/cci/cube/verityField';
import { RelationshipType } from '../../../src/cci/cube/relationship';
import { resolveRels, ResolveRelsResult } from '../../../src/cci/veritum/veritumRetrievalUtil';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';

describe('VeritumRetrievalUtil', () => {
  describe('resolveRefs()', () => {
    let cubeStore: CubeStore = new CubeStore(testCciOptions);

    let singleMyPost: cciCube;
    let twoMyPosts: cciCube;
    let replyToPlusMyPost: cciCube;

    let root1: cciCube;
    let root2: cciCube;
    let root3: cciCube;

    beforeAll(async () => {
      await sodium.ready;
      await cubeStore.readyPromise;

      // sculpt test cubes:
      // let's start with the "root" Cubes, i.e. those not referring to any further Cubes
      root1 = cciCube.Create({
        fields: VerityField.Payload("Hic cubus ab aliis cubis refertur"),
        requiredDifficulty: 0,
      });
      const referred1Key = await root1.getKey();
      await cubeStore.addCube(root1);

      root2 = cciCube.Create({
        fields: VerityField.Payload("Hic cubus quoque ab aliis cubis refertur"),
        requiredDifficulty: 0,
      });
      const referred2Key = await root2.getKey();
      await cubeStore.addCube(root2);

      root3 = cciCube.Create({
        fields: VerityField.Payload("Alius cubus ab aliis refertur"),
        requiredDifficulty: 0,
      });
      const referred3Key = await root3.getKey();
      await cubeStore.addCube(root3);

      // let's continue with single level referrals
      singleMyPost = cciCube.Create({
        fields: [
          VerityField.Payload("Ecce, dominus meus hunc alium cubum interessantem scripsit"),
          VerityField.RelatesTo(RelationshipType.MYPOST, referred1Key),
        ],
        requiredDifficulty: 0,
      });

      twoMyPosts = cciCube.Create({
        fields: [
          VerityField.Payload("Dominus meus sapiens plures alios cubos interessantes scripsit"),
          VerityField.RelatesTo(RelationshipType.MYPOST, referred1Key),
          VerityField.RelatesTo(RelationshipType.MYPOST, referred2Key),
        ],
        requiredDifficulty: 0,
      });

      replyToPlusMyPost = cciCube.Create({
        fields: [
          VerityField.Payload("Tam sapiens est ut cubis alienis respondeat"),
          VerityField.RelatesTo(RelationshipType.REPLY_TO, referred3Key),
          VerityField.RelatesTo(RelationshipType.MYPOST, referred1Key),
          VerityField.RelatesTo(RelationshipType.MYPOST, referred2Key),
        ],
        requiredDifficulty: 0,
      })
    });


    describe('non-recursive', () => {
      describe('resolves a single MYPOST reference', () => {
        let res: ResolveRelsResult;

        beforeAll(() => {
          res = resolveRels(
            singleMyPost,
            cubeStore.getCube.bind(cubeStore)
          );
        });

        describe('test without awaiting', () => {
          it('refers the input Cube', () => {
            expect(res.main).toBe(singleMyPost);
          });

          it('contains a retrieval promise for the referred Cube', () => {
            expect(Array.isArray(res.MYPOST)).toBe(true);
            expect(res.MYPOST.length).toBe(1);
            expect(res.MYPOST[0]).toBeInstanceOf(Promise);
          });

          it('contains a collective done promise', () => {
            expect(res.done).toBeInstanceOf(Promise);
          });
        });

        describe('test after awaiting', () => {
          it('has retrieved the referred Cube', async () => {
            const retrieved = await res.MYPOST[0];
            expect(retrieved).toBeInstanceOf(cciCube);
            expect(retrieved.getFirstField(FieldType.PAYLOAD).valueString).toBe("Hic cubus ab aliis cubis refertur");
            expect(retrieved.equals(root1)).toBe(true);
          });
        });
      });

      describe('resolves two MYPOST references', () => {
        it.todo("write tests");
      });

      describe('resolves a single REPLY_TO reference as well as two MYPOST references', () => {
        it.todo("write tests");
      });
    });

    describe('recursive', () => {
      it.todo("implement");
      it.todo("write tests");
    });
  });
});
