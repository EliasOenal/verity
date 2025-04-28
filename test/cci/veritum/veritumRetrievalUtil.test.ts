import sodium from 'libsodium-wrappers-sumo'

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { testCciOptions } from '../testcci.definitions';
import { VerityField } from '../../../src/cci/cube/verityField';
import { RelationshipType } from '../../../src/cci/cube/relationship';
import { resolveRels, resolveRelsRecursive, ResolveRelsRecursiveResult, ResolveRelsResult } from '../../../src/cci/veritum/veritumRetrievalUtil';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';
import { CubeType } from '../../../src/core/cube/cube.definitions';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

describe('VeritumRetrievalUtil resolveRels() / resolveRelsRecursive() tests', () => {
  let cubeStore: CubeStore;

  let leaf1: cciCube, leaf2: cciCube, leaf3: cciCube;
  let singleMyPost: cciCube, twoMyPosts: cciCube, replyToPlusMyPost: cciCube;
  let unresolvableRel: cciCube, indirectlyUnresolvableRel: cciCube;
  let cubeA: cciCube, cubeB: cciCube, cubeC: cciCube;
  let cycleA: cciCube, cycleB: cciCube, cycleC: cciCube;

  beforeAll(async () => {
    // Wait for any needed crypto initialization.
    await sodium.ready;
    cubeStore = new CubeStore(testCciOptions);
    await cubeStore.readyPromise;

    // --- Create leaf cubes (i.e. having no further references) ---
    leaf1 = cciCube.Create({
      fields: [VerityField.Payload("Hic cubus ab aliis cubis refertur")],
      requiredDifficulty: 0,
    });
    const leaf1Key = await leaf1.getKey();
    await cubeStore.addCube(leaf1);

    leaf2 = cciCube.Create({
      fields: [VerityField.Payload("Hic cubus quoque ab aliis cubis refertur")],
      requiredDifficulty: 0,
    });
    const leaf2Key = await leaf2.getKey();
    await cubeStore.addCube(leaf2);

    leaf3 = cciCube.Create({
      fields: [VerityField.Payload("Alius cubus ab aliis refertur")],
      requiredDifficulty: 0,
    });
    const leaf3Key = await leaf3.getKey();
    await cubeStore.addCube(leaf3);

    // --- Create cubes with relationships (first level) ---
    singleMyPost = cciCube.Create({
      fields: [
        VerityField.Payload("Ecce, dominus meus hunc alium cubum interessantem scripsit"),
        VerityField.RelatesTo(RelationshipType.MYPOST, leaf1Key),
      ],
      requiredDifficulty: 0,
    });

    twoMyPosts = cciCube.Create({
      fields: [
        VerityField.Payload("Dominus meus sapiens plures alios cubos interessantes scripsit"),
        VerityField.RelatesTo(RelationshipType.MYPOST, leaf1Key),
        VerityField.RelatesTo(RelationshipType.MYPOST, leaf2Key),
      ],
      requiredDifficulty: 0,
    });

    replyToPlusMyPost = cciCube.Create({
      fields: [
        VerityField.Payload("Tam sapiens est ut cubis alienis respondeat"),
        VerityField.RelatesTo(RelationshipType.REPLY_TO, leaf3Key),
        VerityField.RelatesTo(RelationshipType.MYPOST, leaf1Key),
        VerityField.RelatesTo(RelationshipType.MYPOST, leaf2Key),
      ],
      requiredDifficulty: 0,
    });

    // Sculpt a Cube with an unresolvable relationship.
    unresolvableRel = cciCube.Create({
      fields: [
        VerityField.Payload("Mysterium manebit quid significem"),
        VerityField.RelatesTo(RelationshipType.REPLY_TO,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337)),
    ]});
    const unresolvableRelKey = await unresolvableRel.getKey();
    await cubeStore.addCube(unresolvableRel);

    // Sculpt a Cube with an indirectly unresolvable relationship
    indirectlyUnresolvableRel = cciCube.Create({
      fields: [
        VerityField.Payload("Haec catena cuborum fracta est"),
        VerityField.RelatesTo(RelationshipType.REPLY_TO, unresolvableRelKey),
    ]});

    // --- Create a chain: cubeA -> cubeB -> cubeC (with cubeC being a leaf cube) ---
    cubeC = cciCube.Create({
      fields: [VerityField.Payload("Cube C")],
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(cubeC);
    const cubeCKey = await cubeC.getKey();

    cubeB = cciCube.Create({
      fields: [
        VerityField.Payload("Cube B"),
        VerityField.RelatesTo(RelationshipType.REPLY_TO, cubeCKey),
      ],
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(cubeB);
    const cubeBKey = await cubeB.getKey();

    cubeA = cciCube.Create({
      fields: [
        VerityField.Payload("Cube A"),
        VerityField.RelatesTo(RelationshipType.MYPOST, cubeBKey),
      ],
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(cubeA);


    // --- Create a cyclic chain: cycleA -> cycleB -> cycleC -> cycleA ---
    // cycleA has to be a signed type as cyclic rels are impossible
    // with hash-based types
    const keyPairCycleA = sodium.crypto_sign_keypair();
    cycleA = cciCube.Create({
      cubeType: CubeType.PMUC,
      fields: [VerityField.Payload("Cycle A")],
      requiredDifficulty: 0,
      publicKey: Buffer.from(keyPairCycleA.publicKey),
      privateKey: Buffer.from(keyPairCycleA.privateKey),
    });
    const cycleAKey = cycleA.getKeyIfAvailable();  // signed types always know their key
    // defer publishing of cyclyA until after we complete the cyclic chain

    cycleB = cciCube.Create({
      fields: [
        VerityField.Payload("Cycle B"),
        VerityField.RelatesTo(RelationshipType.REPLY_TO, cycleAKey), // cycle
      ],
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(cycleB);
    const cycleBKey = await cycleB.getKey();

    cycleC = cciCube.Create({
      fields: [
        VerityField.Payload("Cycle C"),
        VerityField.RelatesTo(RelationshipType.REPLY_TO, cycleBKey), // cycle
      ],
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(cycleC);
    const cycleCKey = await cycleC.getKey();

    // Close the cycle: cycleA -> cycleB -> cycleC -> cycleA
    cycleA.insertFieldBeforeBackPositionals(VerityField.RelatesTo(RelationshipType.REPLY_TO, cycleCKey));
    await cubeStore.addCube(cycleA);

  });


  describe('resolveRefs()', () => {
    describe('resolves a single MYPOST reference', () => {
      let res: ResolveRelsResult;

      beforeAll(() => {
        res = resolveRels(
          singleMyPost,
          cubeStore.getCube.bind(cubeStore)
        );

        // check initial status flags --
        // note we have to check them here as retrieval is reeeeeeeally fast
        // and might complete once we run the test blocks, even before awaiting done.
        expect(res.isDone).toBe(false);
        expect(res.allResolved).toBe(false);
        expect(res.resolutionFailure).toBe(false);
      });

      describe('test without awaiting', () => {
        it('refers the input Cube', () => {
          expect(res.main).toBe(singleMyPost);
        });

        it('contains a retrieval promise for the referred Cube', () => {
          expect(Array.isArray(res[RelationshipType.MYPOST])).toBe(true);
          expect(res[RelationshipType.MYPOST].length).toBe(1);
          expect(res[RelationshipType.MYPOST][0]).toBeInstanceOf(Promise);
        });

        it('contains a collective done promise', () => {
          expect(res.done).toBeInstanceOf(Promise);
        });
      });

      describe('test after awaiting', () => {
        it('has retrieved the referred Cube', async () => {
          const retrieved = await res[RelationshipType.MYPOST][0];
          expect(retrieved).toBeInstanceOf(cciCube);
          expect(retrieved.getFirstField(FieldType.PAYLOAD).valueString).toBe("Hic cubus ab aliis cubis refertur");
          expect(retrieved.equals(leaf1)).toBe(true);
        });

        it("sets its status flags correctly", () => {
          expect(res.isDone).toBe(true);
          expect(res.allResolved).toBe(true);
          expect(res.resolutionFailure).toBe(false);
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
          expect(Array.isArray(res[RelationshipType.MYPOST])).toBe(true);
          expect(res[RelationshipType.MYPOST].length).toBe(2);
          expect(res[RelationshipType.MYPOST][0]).toBeInstanceOf(Promise);
          expect(res[RelationshipType.MYPOST][1]).toBeInstanceOf(Promise);
        });

        it('contains a collective done promise', () => {
          expect(res.done).toBeInstanceOf(Promise);
        });
      });

      describe('test after awaiting', () => {
        it('has retrieved the referred Cubes', async () => {
          const retrieved1 = await res[RelationshipType.MYPOST][0];
          expect(retrieved1).toBeInstanceOf(cciCube);
          expect(retrieved1.equals(leaf1)).toBe(true);

          const retrieved2 = await res[RelationshipType.MYPOST][1];
          expect(retrieved2).toBeInstanceOf(cciCube);
          expect(retrieved2.equals(leaf2)).toBe(true);
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
          expect(Array.isArray(res[RelationshipType.REPLY_TO])).toBe(true);
          expect(res[RelationshipType.REPLY_TO].length).toBe(1);
          expect(res[RelationshipType.REPLY_TO][0]).toBeInstanceOf(Promise);
        });

        it('contains two retrieval promises for the referred MYPOST Cubes', () => {
          expect(Array.isArray(res[RelationshipType.MYPOST])).toBe(true);
          expect(res[RelationshipType.MYPOST].length).toBe(2);
          expect(res[RelationshipType.MYPOST][0]).toBeInstanceOf(Promise);
          expect(res[RelationshipType.MYPOST][1]).toBeInstanceOf(Promise);
        });

        it('contains a collective done promise', () => {
          expect(res.done).toBeInstanceOf(Promise);
        });
      });

      describe('test after awaiting', () => {
        it('has retrieved the Cube referred to as REPLY_TO', async () => {
          const retrieved = await res[RelationshipType.REPLY_TO][0];
          expect(retrieved).toBeInstanceOf(cciCube);
          expect(retrieved.equals(leaf3)).toBe(true);
        });

        it('has retrieved the Cubes referred to as MYPOST', async () => {
          const retrieved1 = await res[RelationshipType.MYPOST][0];
          expect(retrieved1).toBeInstanceOf(cciCube);
          expect(retrieved1.equals(leaf1)).toBe(true);

          const retrieved2 = await res[RelationshipType.MYPOST][1];
          expect(retrieved2).toBeInstanceOf(cciCube);
          expect(retrieved2.equals(leaf2)).toBe(true);
        });
      });
    });

    describe('limiting relationship types', () => {
      it('returns an empty result when the only relationship type is excluded', () => {
        const res = resolveRels(
          singleMyPost,
          cubeStore.getCube.bind(cubeStore),
          {
            relTypes: [RelationshipType.REPLY_TO],
          }
        );

        expect(res.main).toBe(singleMyPost);
        expect(res.done).toBeInstanceOf(Promise);
        expect(Object.keys(res).filter(key => Number.parseInt(key))).toHaveLength(0);
      });

      it('only includes the specified relationship types', () => {
        const res = resolveRels(
          replyToPlusMyPost,
          cubeStore.getCube.bind(cubeStore),
          {
            relTypes: [RelationshipType.REPLY_TO],
          }
        );

        expect(res.main).toBe(replyToPlusMyPost);
        expect(res.done).toBeInstanceOf(Promise);

        expect(Object.keys(res).filter(key => Number.parseInt(key))).toHaveLength(1);
        expect(res[RelationshipType.REPLY_TO].length).toBe(1);
      });

      it('is neutral if all relationship type present are in the filter list', () => {
        const res = resolveRels(
          replyToPlusMyPost,
          cubeStore.getCube.bind(cubeStore),
          {
            relTypes: [RelationshipType.REPLY_TO, RelationshipType.MYPOST],
          }
        );

        expect(res.main).toBe(replyToPlusMyPost);
        expect(res.done).toBeInstanceOf(Promise);

        expect(Object.keys(res).filter(key => Number.parseInt(key))).toHaveLength(2);
        expect(res[RelationshipType.REPLY_TO].length).toBe(1);
        expect(res[RelationshipType.MYPOST].length).toBe(2);
      });
    });  // limiting relationship types

    describe('edge cases', () => {
      describe('no main Veritable supplied', () => {
        it('returns an empty result', () => {
          const res = resolveRels(
            undefined,
            cubeStore.getCube.bind(cubeStore)
          );

          expect(res.main).toBeUndefined();
          expect(res.done).toBeInstanceOf(Promise);
          expect(res.isDone).toBe(true);
          expect(res.allResolved).toBe(false);
          expect(res.resolutionFailure).toBe(true);
        });
      });

      describe('trying to resolve an unavailable relationship', () => {
        let res: ResolveRelsResult;

        beforeAll(async () => {
          res = resolveRels(
            unresolvableRel,
            cubeStore.getCube.bind(cubeStore),
          );
          await res.done;
        });

        it('refers the input Cube', () => {
          expect(res.main).toBe(unresolvableRel);
        });

        it('resolves the unresolvable REPLY_TO rel to undefined', async () => {
          expect(res[RelationshipType.REPLY_TO]).toHaveLength(1);
          expect(res[RelationshipType.REPLY_TO][0]).toBeInstanceOf(Promise);
          expect(await res[RelationshipType.REPLY_TO][0]).toBeUndefined();
        });

        it('sets its status flags correctly', () => {
          expect(res.isDone).toBe(true);
          expect(res.allResolved).toBe(false);
          expect(res.resolutionFailure).toBe(true);
        });

        it('contains a retrieval promise for the referred Cube resolved to undefined', async () => {
          expect(Array.isArray(res[RelationshipType.REPLY_TO])).toBe(true);
          expect(res[RelationshipType.REPLY_TO].length).toBe(1);
          expect(res[RelationshipType.REPLY_TO][0]).toBeInstanceOf(Promise);
          await expect(res[RelationshipType.REPLY_TO][0]).resolves.toBeUndefined();
        });
      });  // unresolvable relationship
    });  // edge cases
  });




  describe('resolveRelsRecursive()', () => {
    describe('leaf cube (no relationships)', () => {
      let recursiveRes: ResolveRelsRecursiveResult;

      beforeAll(async () => {
        recursiveRes = resolveRelsRecursive(leaf1, cubeStore.getCube.bind(cubeStore));

        // check initial status flags --
        // note we have to check them here as retrieval is reeeeeeeally fast
        // and might complete once we run the test blocks, even before awaiting done.
        expect(recursiveRes.isDone).toBe(false);
        expect(recursiveRes.allResolved).toBe(false);
        expect(recursiveRes.resolutionFailure).toBe(false);
        expect(recursiveRes.exclusionApplied).toBe(false);
        expect(recursiveRes.depthLimitReached).toBe(false);
      });

      it('returns a result with main equal to the input cube', () => {
        expect(recursiveRes.main).toBe(leaf1);
      });

      it('has no relationship properties', () => {
        // By our type definition, relationship properties are those with numeric keys
        expect(Object.keys(recursiveRes).filter(key => Number.parseInt(key)))
          .toHaveLength(0);
      });

      it('resolves the overall done promise', async () => {
        await expect(recursiveRes.done).resolves.toBeUndefined();
      });

      it('sets its status flags correctly once done', async () => {
        await recursiveRes.done;
        expect(recursiveRes.isDone).toBe(true);
        expect(recursiveRes.allResolved).toBe(true);
        expect(recursiveRes.resolutionFailure).toBe(false);
        expect(recursiveRes.exclusionApplied).toBe(false);
        expect(recursiveRes.depthLimitReached).toBe(false);
      });
    });



    describe('cube with a single MYPOST reference', () => {
      let recursiveRes: ResolveRelsRecursiveResult;

      beforeAll(async () => {
        recursiveRes = resolveRelsRecursive(singleMyPost, cubeStore.getCube.bind(cubeStore));
        expect(recursiveRes.isDone).toBe(false);
        await recursiveRes.done;
      });

      it("sets isDone to true once it's not done yet", () => {
        expect(recursiveRes.isDone).toBe(true);
      });

      it('refers back to the original cube as main', () => {
        expect(recursiveRes.main).toBe(singleMyPost);
      });

      it('contains a MYPOST property that is an array of one promise', () => {
        expect(Array.isArray(recursiveRes[RelationshipType.MYPOST])).toBe(true);
        expect(recursiveRes[RelationshipType.MYPOST].length).toBe(1);
        expect(recursiveRes[RelationshipType.MYPOST][0]).toBeInstanceOf(Promise);
      });

      it('retrieves the referred cube', async () => {
        const resolvedMypost = await recursiveRes[RelationshipType.MYPOST][0];
        expect(resolvedMypost.main).toBeInstanceOf(cciCube);
        expect(resolvedMypost.main.equals(leaf1)).toBe(true);

        // Since the referred Cube is a leaf, it should not have relationship properties
        expect(Object.keys(resolvedMypost).filter(key => Number.parseInt(key)))
          .toHaveLength(0);
        await expect(resolvedMypost.done).resolves.toBeUndefined();
      });

      it('has no other relationship properties other than MYPOST', () => {
        expect(Object.keys(recursiveRes).filter(key => Number.parseInt(key)))
          .toEqual([RelationshipType.MYPOST.toString()]);
      });

      it('sets its status flags correctly once done', async () => {
        await recursiveRes.done;
        expect(recursiveRes.isDone).toBe(true);
        expect(recursiveRes.allResolved).toBe(true);
        expect(recursiveRes.resolutionFailure).toBe(false);
        expect(recursiveRes.exclusionApplied).toBe(false);
        expect(recursiveRes.depthLimitReached).toBe(false);
      });
    });



    describe('multi-level recursion', () => {
      let recursiveRes: ResolveRelsRecursiveResult;

      beforeAll(async () => {
        recursiveRes = resolveRelsRecursive(cubeA, cubeStore.getCube.bind(cubeStore));
        // Wait until the whole tree is resolved.
        await recursiveRes.done;
      });

      it('has main equal to the starting cube (cubeA)', () => {
        expect(recursiveRes.main).toBe(cubeA);
      });

      it('resolves the first step of the relationship chain (MYPOST rel from cubeA to cubeB)', async () => {
        expect(recursiveRes[RelationshipType.MYPOST].length).toBe(1);
        const resB = await recursiveRes[RelationshipType.MYPOST][0];
        expect(resB.main.equals(cubeB)).toBe(true);
      });

      it('resolves the second step of the relationship chain (REPLY_TO rel from cubeB to cubeC)', async () => {
        const nestedResB = await recursiveRes[RelationshipType.MYPOST][0];
        expect(nestedResB[RelationshipType.REPLY_TO].length).toBe(1);
        const nestedResC = await nestedResB[RelationshipType.REPLY_TO][0];
        expect(nestedResC.main.equals(cubeC)).toBe(true);

        // Cube C is a leaf cube; it should not have any relationship properties
        expect(Object.keys(nestedResC).filter(key => Number.parseInt(key)))
          .toHaveLength(0);
        await expect(nestedResC.done).resolves.toBeUndefined();
      });

      it('ensures the overall done promise resolves only after all nested levels complete', async () => {
        await expect(recursiveRes.done).resolves.toBeUndefined();
      });

      it('sets its status flags correctly once done', async () => {
        await recursiveRes.done;
        expect(recursiveRes.isDone).toBe(true);
        expect(recursiveRes.allResolved).toBe(true);
        expect(recursiveRes.resolutionFailure).toBe(false);
        expect(recursiveRes.exclusionApplied).toBe(false);
        expect(recursiveRes.depthLimitReached).toBe(false);
      });
    });



    describe('cube with multiple relationships', () => {
      let recursiveRes: ResolveRelsRecursiveResult;

      beforeAll(async () => {
        recursiveRes = resolveRelsRecursive(twoMyPosts, cubeStore.getCube.bind(cubeStore));
        await recursiveRes.done;
      });

      it('has two MYPOST relationships', () => {
        expect(recursiveRes[RelationshipType.MYPOST]).toHaveLength(2);
      });

      it('correctly resolves the MYPOST relationships', async () => {
        const nested1 = await recursiveRes[RelationshipType.MYPOST][0];
        const nested2 = await recursiveRes[RelationshipType.MYPOST][1];

        expect(nested1.main.equals(leaf1)).toBe(true);
        expect(nested2.main.equals(leaf2)).toBe(true);
      });

      it('sets its status flags correctly once done', async () => {
        await recursiveRes.done;
        expect(recursiveRes.isDone).toBe(true);
        expect(recursiveRes.allResolved).toBe(true);
        expect(recursiveRes.resolutionFailure).toBe(false);
        expect(recursiveRes.exclusionApplied).toBe(false);
        expect(recursiveRes.depthLimitReached).toBe(false);
      });
    });

    describe('cube with mixed relationship types', () => {
      let recursiveRes: ResolveRelsRecursiveResult;

      beforeAll(async () => {
        recursiveRes = resolveRelsRecursive(replyToPlusMyPost, cubeStore.getCube.bind(cubeStore));
        await recursiveRes.done;
      });

      it('returns a main cube equal to the input cube', () => {
        expect(recursiveRes.main).toBe(replyToPlusMyPost);
      });

      it('resolves the REPLY_TO relationship', async () => {
        expect(recursiveRes[RelationshipType.REPLY_TO]).toHaveLength(1);

        const replyRes = await recursiveRes[RelationshipType.REPLY_TO][0];
        expect(replyRes.main.equals(leaf3)).toBe(true);
      });

      it('resolves the two MYPOST relationships', async () => {
        expect(recursiveRes[RelationshipType.MYPOST]).toHaveLength(2);

        const res1 = await recursiveRes[RelationshipType.MYPOST][0];
        const res2 = await recursiveRes[RelationshipType.MYPOST][1];

        expect(res1.main.equals(leaf1)).toBe(true);
        expect(res2.main.equals(leaf2)).toBe(true);
      });

      it('sets its status flags correctly once done', async () => {
        await recursiveRes.done;
        expect(recursiveRes.isDone).toBe(true);
        expect(recursiveRes.allResolved).toBe(true);
        expect(recursiveRes.resolutionFailure).toBe(false);
        expect(recursiveRes.exclusionApplied).toBe(false);
        expect(recursiveRes.depthLimitReached).toBe(false);
      });
    });  // cube with mixed relationship types

    describe('recursion depth limiting', () => {
      it('respects a depth limit of 1', async () => {
        const res = resolveRelsRecursive(
          cubeA, cubeStore.getCube.bind(cubeStore),
          { maxRecursion: 1 }
        );
        await res.done;

        expect(res[RelationshipType.MYPOST].length).toBe(1);

        const nestedResB = await res[RelationshipType.MYPOST][0];
        expect(nestedResB.main.equals(cubeB)).toBe(true);

        // Since maxRecursion was 1, cubeB should not recurse further.
        expect(Object.keys(nestedResB).filter(key => Number.parseInt(key)))
          .toHaveLength(0);

        // should set its status flags correctly
        expect(res.isDone).toBe(true);
        expect(res.allResolved).toBe(false);
        expect(res.resolutionFailure).toBe(false);
        expect(res.exclusionApplied).toBe(false);
        expect(res.depthLimitReached).toBe(true);
      });

      it('fully resolves a 2-level tree when using a depth limit of 2', async () => {
        const res = resolveRelsRecursive(
          cubeA, cubeStore.getCube.bind(cubeStore),
          { maxRecursion: 2 });

        await res.done;

        expect(res[RelationshipType.MYPOST].length).toBe(1);

        const nestedResB = await res[RelationshipType.MYPOST][0];
        expect(nestedResB.main.equals(cubeB)).toBe(true);

        expect(nestedResB[RelationshipType.REPLY_TO].length).toBe(1);

        const nestedResC = await nestedResB[RelationshipType.REPLY_TO][0];
        expect(nestedResC.main.equals(cubeC)).toBe(true);

        // Cube C is a leaf, so further recursion should not happen
        expect(Object.keys(nestedResC).filter(key => Number.parseInt(key)))
          .toHaveLength(0);

        // should set its status flags correctly
        expect(res.isDone).toBe(true);
        expect(res.allResolved).toBe(true);
        expect(res.resolutionFailure).toBe(false);
        expect(res.exclusionApplied).toBe(false);
        expect(res.depthLimitReached).toBe(true);  // note it was not exceeded, but is was reached
      });
    });  // recursion depth limiting


    describe('recursion exclusion set (e.g. for already-visited cubes)', () => {
      it('does not revisit cubes already seen in exclude set', async () => {
        const excludeSet = new Set<string>();
        const stopKey = await cubeB.getKeyString();
        excludeSet.add(stopKey);

        const res = resolveRelsRecursive(
          cubeA, cubeStore.getCube.bind(cubeStore),
          { excludeVeritable: excludeSet });
        await res.done;

        // Cube A's relationship to Cube B should have resolved as normal
        expect(res[RelationshipType.MYPOST].length).toBe(1);
        const resB = await res[RelationshipType.MYPOST][0];
        expect(resB.main.equals(cubeB)).toBe(true);

        // Since cubeB is excluded, it should contain no resolved relationships.
        expect(Object.keys(resB).filter(key => Number.parseInt(key)))
          .toHaveLength(0);

        // should set its status flags correctly
        expect(res.isDone).toBe(true);
        expect(res.allResolved).toBe(false);
        expect(res.resolutionFailure).toBe(false);
        expect(res.exclusionApplied).toBe(true);
        expect(res.depthLimitReached).toBe(false);
      });

      it('correctly adds newly encountered cubes to exclude set and prevents revisits', async () => {
        const excludeSet = new Set<string>();

        const res = resolveRelsRecursive(
          cubeA, cubeStore.getCube.bind(cubeStore),
          { excludeVeritable: excludeSet });
        await res.done;

        expect(res[RelationshipType.MYPOST].length).toBe(1);

        const nestedResB = await res[RelationshipType.MYPOST][0];
        expect(nestedResB.main.equals(cubeB)).toBe(true);

        // Ensure cubeB's key is now tracked in the exclude set.
        const cubeBKey = await cubeB.getKeyString();
        expect(excludeSet.has(cubeBKey)).toBe(true);

        // should set its status flags correctly
        expect(res.isDone).toBe(true);
        expect(res.allResolved).toBe(true);  // still true, the exclusion was tracked but nothing was actually skipped
        expect(res.resolutionFailure).toBe(false);
        expect(res.exclusionApplied).toBe(false);  // still false, B was marked for exclusion, but as it was never revisited anyway it was not skipped
        expect(res.depthLimitReached).toBe(false);
      });

      it('avoids infinite recursion caused by cyclic relationships', async () => {
        const res = resolveRelsRecursive(
          cycleA, cubeStore.getCube.bind(cubeStore));
        await res.done;

        // A's relationship to C should be resolved
        expect(res[RelationshipType.REPLY_TO].length).toBe(1);
        const resC = await res[RelationshipType.REPLY_TO][0];
        expect(resC.main.equals(cycleC)).toBe(true);

        // C's relationship to B should be resolved
        expect(resC[RelationshipType.REPLY_TO].length).toBe(1);
        const resB = await resC[RelationshipType.REPLY_TO][0];
        expect(resB.main.equals(cycleB)).toBe(true);

        // B's cyclic relationship to A should still be resolved,
        // but recursion should stop there
        expect(resB[RelationshipType.REPLY_TO].length).toBe(1);
        const resA = await resB[RelationshipType.REPLY_TO][0];
        expect(resA.main.equals(cycleA)).toBe(true);

        // resA should not feature any resolved relationships, as recursion
        // has be broken due to the cyclic relationship
        expect(Object.keys(resA).filter(key => Number.parseInt(key)))
          .toHaveLength(0);

        // should set its status flags correctly
        expect(res.isDone).toBe(true);
        expect(res.allResolved).toBe(false);
        expect(res.resolutionFailure).toBe(false);
        expect(res.exclusionApplied).toBe(true);
        expect(res.depthLimitReached).toBe(false);
      });
    });  // recursion exclusion set

    describe('limiting relationship types', () => {
      describe('first level resolutions', () => {
        it('returns an empty result when the only relationship type is excluded', () => {
          const res = resolveRelsRecursive(
            singleMyPost,
            cubeStore.getCube.bind(cubeStore),
            {
              relTypes: [RelationshipType.REPLY_TO],
            }
          );

          expect(res.main).toBe(singleMyPost);
          expect(res.done).toBeInstanceOf(Promise);
          expect(Object.keys(res).filter(key => Number.parseInt(key))).toHaveLength(0);
        });

        it('only includes the specified relationship types', () => {
          const res = resolveRelsRecursive(
            replyToPlusMyPost,
            cubeStore.getCube.bind(cubeStore),
            {
              relTypes: [RelationshipType.REPLY_TO],
            }
          );

          expect(res.main).toBe(replyToPlusMyPost);
          expect(res.done).toBeInstanceOf(Promise);

          expect(Object.keys(res).filter(key => Number.parseInt(key))).toHaveLength(1);
          expect(res[RelationshipType.REPLY_TO].length).toBe(1);
        });

        it('is neutral if all relationship type present are in the filter list', () => {
          const res = resolveRelsRecursive(
            replyToPlusMyPost,
            cubeStore.getCube.bind(cubeStore),
            {
              relTypes: [RelationshipType.REPLY_TO, RelationshipType.MYPOST],
            }
          );

          expect(res.main).toBe(replyToPlusMyPost);
          expect(res.done).toBeInstanceOf(Promise);

          expect(Object.keys(res).filter(key => Number.parseInt(key))).toHaveLength(2);
          expect(res[RelationshipType.REPLY_TO].length).toBe(1);
          expect(res[RelationshipType.MYPOST].length).toBe(2);
        });
      });  // first level resolutions

      describe('recursive resolutions', () => {
        it('stops the recursion when the only relationship type is excluded', async () => {
          const res = resolveRelsRecursive(
            cubeA, cubeStore.getCube.bind(cubeStore),
            { relTypes: [RelationshipType.MYPOST] }
          );
          await res.done;

          // Expect the rel from cubeA to cubeB to be resolved as it is a MYPOST rel
          expect(res[RelationshipType.MYPOST].length).toBe(1);
          const resB = await res[RelationshipType.MYPOST][0];
          expect(resB.main.equals(cubeB)).toBe(true);

          // Expect the rel from cubeB to cubeC to not be resolved as it is a REPLY_TO rel.
          // The resolved B should not have any further relationship entries.
          expect(resB[RelationshipType.REPLY_TO]).toBeUndefined();
          expect(Object.keys(resB).filter(key => Number.parseInt(key)))
            .toHaveLength(0);

          // should set its status flags correctly
          expect(res.isDone).toBe(true);
          expect(res.allResolved).toBe(true);
          expect(res.resolutionFailure).toBe(false);
          expect(res.exclusionApplied).toBe(false);
          expect(res.depthLimitReached).toBe(false);
        });
      });  // recursive resolutions
    });  // limiting relationship types

    describe('edge cases', () => {
      describe('no main Veritable supplied', () => {
        it('returns an empty result', () => {
          const res = resolveRelsRecursive(
            undefined,
            cubeStore.getCube.bind(cubeStore)
          );
          expect(res.main).toBeUndefined();
          expect(res.done).toBeInstanceOf(Promise);
          expect(res.isDone).toBe(true);
          expect(res.allResolved).toBe(false);
          expect(res.resolutionFailure).toBe(true);
          expect(res.exclusionApplied).toBe(false);
          expect(res.depthLimitReached).toBe(false);
        });
      });

      describe('trying to resolve an unavailable relationship', () => {
        let res: ResolveRelsRecursiveResult;

        beforeAll(async () => {
          res = resolveRelsRecursive(
            unresolvableRel,
            cubeStore.getCube.bind(cubeStore),
          );
          await res.done;
        });

        it('refers the input Cube', () => {
          expect(res.main).toBe(unresolvableRel);
        });

        it('produces an empty result object for the unresolvable REPLY_TO rel', async () => {
          expect(res[RelationshipType.REPLY_TO]).toHaveLength(1);
          expect(res[RelationshipType.REPLY_TO][0]).toBeInstanceOf(Promise);
          const emptySubRes: ResolveRelsRecursiveResult =
            await res[RelationshipType.REPLY_TO][0];

          expect(emptySubRes.main).toBeUndefined();
          expect(emptySubRes.isDone).toBe(true);
          expect(emptySubRes.allResolved).toBe(false);
          expect(emptySubRes.depthLimitReached).toBe(false);
          expect(emptySubRes.exclusionApplied).toBe(false);
          expect(emptySubRes.resolutionFailure).toBe(true);
        });

        it('sets its status flags correctly', () => {
          expect(res.isDone).toBe(true);
          expect(res.allResolved).toBe(false);
          expect(res.depthLimitReached).toBe(false);
          expect(res.exclusionApplied).toBe(false);
          expect(res.resolutionFailure).toBe(true);
        });
      });


      describe('trying to resolve an indirectly unavailable relationship', () => {
        let res: ResolveRelsRecursiveResult;

        beforeAll(async () => {
          res = resolveRelsRecursive(
            indirectlyUnresolvableRel,
            cubeStore.getCube.bind(cubeStore),
          );
          await res.done;
        });

        it('refers the input Cube', () => {
          expect(res.main).toBe(indirectlyUnresolvableRel);
        });

        it('resolves the first reference level', async () => {
          expect(res[RelationshipType.REPLY_TO]).toHaveLength(1);
          expect(res[RelationshipType.REPLY_TO][0]).toBeInstanceOf(Promise);
          const resolvedSubRes: ResolveRelsRecursiveResult =
            await res[RelationshipType.REPLY_TO][0];

          expect(resolvedSubRes.main.equals(unresolvableRel)).toBe(true);
        });

        it('produces an empty result object for the unresolvable sub-relationship', async () => {
          const lvl1: ResolveRelsRecursiveResult =
            await res[RelationshipType.REPLY_TO][0];
          const lvl2: ResolveRelsRecursiveResult =
            await lvl1[RelationshipType.REPLY_TO][0];

          // The unresolvable relationship should be empty
          expect(lvl2.main).toBeUndefined();
        });

        it('sets its status flags correctly', () => {
          expect(res.isDone).toBe(true);
          expect(res.allResolved).toBe(false);
          expect(res.depthLimitReached).toBe(false);
          expect(res.exclusionApplied).toBe(false);
          expect(res.resolutionFailure).toBe(true);
        });
      });  // indirectly unresolvable relationship
    });  // edge cases
  });  // resolveRelsRecursive()

});
