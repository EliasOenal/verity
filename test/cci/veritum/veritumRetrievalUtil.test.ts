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
      const root1Key = await root1.getKey();
      await cubeStore.addCube(root1);

      root2 = cciCube.Create({
        fields: VerityField.Payload("Hic cubus quoque ab aliis cubis refertur"),
        requiredDifficulty: 0,
      });
      const root2Key = await root2.getKey();
      await cubeStore.addCube(root2);

      root3 = cciCube.Create({
        fields: VerityField.Payload("Alius cubus ab aliis refertur"),
        requiredDifficulty: 0,
      });
      const root3Key = await root3.getKey();
      await cubeStore.addCube(root3);

      // let's continue with single level referrals
      singleMyPost = cciCube.Create({
        fields: [
          VerityField.Payload("Ecce, dominus meus hunc alium cubum interessantem scripsit"),
          VerityField.RelatesTo(RelationshipType.MYPOST, root1Key),
        ],
        requiredDifficulty: 0,
      });

      twoMyPosts = cciCube.Create({
        fields: [
          VerityField.Payload("Dominus meus sapiens plures alios cubos interessantes scripsit"),
          VerityField.RelatesTo(RelationshipType.MYPOST, root1Key),
          VerityField.RelatesTo(RelationshipType.MYPOST, root2Key),
        ],
        requiredDifficulty: 0,
      });

      replyToPlusMyPost = cciCube.Create({
        fields: [
          VerityField.Payload("Tam sapiens est ut cubis alienis respondeat"),
          VerityField.RelatesTo(RelationshipType.REPLY_TO, root3Key),
          VerityField.RelatesTo(RelationshipType.MYPOST, root1Key),
          VerityField.RelatesTo(RelationshipType.MYPOST, root2Key),
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
        let res: ResolveRelsResult;

        beforeAll(() => {
          res = resolveRels(
            twoMyPosts,
            cubeStore.getCube.bind(cubeStore)
          );
        });

        describe('test without awaiting', () => {
          it('refers the input Cube', () => {
            expect(res.main).toBe(twoMyPosts);
          });

          it('contains two retrieval promises for the referred Cubes', () => {
            expect(Array.isArray(res.MYPOST)).toBe(true);
            expect(res.MYPOST.length).toBe(2);
            expect(res.MYPOST[0]).toBeInstanceOf(Promise);
            expect(res.MYPOST[1]).toBeInstanceOf(Promise);
          });

          it('contains a collective done promise', () => {
            expect(res.done).toBeInstanceOf(Promise);
          });
        });

        describe('test after awaiting', () => {
          it('has retrieved the referred Cubes', async () => {
            const retrieved1 = await res.MYPOST[0];
            expect(retrieved1).toBeInstanceOf(cciCube);
            expect(retrieved1.equals(root1)).toBe(true);

            const retrieved2 = await res.MYPOST[1];
            expect(retrieved2).toBeInstanceOf(cciCube);
            expect(retrieved2.equals(root2)).toBe(true);
          });
        });
      });

      describe('resolves a single REPLY_TO reference as well as two MYPOST references', () => {
        let res: ResolveRelsResult;

        beforeAll(() => {
          res = resolveRels(
            replyToPlusMyPost,
            cubeStore.getCube.bind(cubeStore)
          );
        });

        describe('test without awaiting', () => {
          it('refers the input Cube', () => {
            expect(res.main).toBe(replyToPlusMyPost);
          });

          it('contains a retrieval promise for the referred REPLY_TO Cube', () => {
            expect(Array.isArray(res.REPLY_TO)).toBe(true);
            expect(res.REPLY_TO.length).toBe(1);
            expect(res.REPLY_TO[0]).toBeInstanceOf(Promise);
          });

          it('contains two retrieval promises for the referred MYPOST Cubes', () => {
            expect(Array.isArray(res.MYPOST)).toBe(true);
            expect(res.MYPOST.length).toBe(2);
            expect(res.MYPOST[0]).toBeInstanceOf(Promise);
            expect(res.MYPOST[1]).toBeInstanceOf(Promise);
          });

          it('contains a collective done promise', () => {
            expect(res.done).toBeInstanceOf(Promise);
          });
        });

        describe('test after awaiting', () => {
          it('has retrieved the Cube referred to as REPLY_TO', async () => {
            const retrieved = await res.REPLY_TO[0];
            expect(retrieved).toBeInstanceOf(cciCube);
            expect(retrieved.equals(root3)).toBe(true);
          });

          it('has retrieved the Cubes referred to as MYPOST', async () => {
            const retrieved1 = await res.MYPOST[0];
            expect(retrieved1).toBeInstanceOf(cciCube);
            expect(retrieved1.equals(root1)).toBe(true);

            const retrieved2 = await res.MYPOST[1];
            expect(retrieved2).toBeInstanceOf(cciCube);
            expect(retrieved2.equals(root2)).toBe(true);
          });
        });
      });
    });

    describe('recursive', () => {
      it.todo("implement");
      it.todo("write tests");
    });
  });
});
