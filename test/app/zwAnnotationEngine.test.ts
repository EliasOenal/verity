import { CubeKey } from "../../src/core/cube/cube.definitions";
import { Cube } from "../../src/core/cube/cube";
import { CubeField } from "../../src/core/cube/cubeField";
import { CubeInfo } from "../../src/core/cube/cubeInfo";
import { CubeStore } from "../../src/core/cube/cubeStore";

import { MediaTypes } from "../../src/cci/cube/cciCube.definitions";
import { cciCube, cciFamily } from "../../src/cci/cube/cciCube";
import { cciField} from "../../src/cci/cube/cciField";
import { cciRelationshipType, cciRelationship } from "../../src/cci/cube/cciRelationship";
import { Identity, IdentityOptions } from "../../src/cci/identity/identity";

import { SubscriptionRequirement, ZwAnnotationEngine } from "../../src/app/zw/model/zwAnnotationEngine";
import { makePost } from "../../src/app/zw/model/zwUtil"

import sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('ZwAnnotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: ZwAnnotationEngine;
  const reducedDifficulty = 0;
  const idTestOptions: IdentityOptions = {
    minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
    requiredDifficulty: reducedDifficulty,
    argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
    argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
  }

  beforeAll(async () => {
    await sodium.ready;
  });
  beforeEach(async () => {
    cubeStore = new CubeStore({
      inMemory: true,
      enableCubeCache: false,
      requiredDifficulty: 0,
      enableCubeRetentionPolicy: false,
      family: cciFamily,
    });
    await cubeStore.readyPromise;
  })

  describe('basic config', () => {
    beforeEach(async () => {
      annotationEngine = await ZwAnnotationEngine.ZwConstruct(
        cubeStore,
        SubscriptionRequirement.none,
        [],     // no subscriptions as they don't play a role for this group of tests
        true,   // auto-learn MUCs cause why not (not actually used)
        true);  // allow anonymous posts cause all posts in this group of tests are anonymous
    });

    afterEach(() => {
      annotationEngine.shutdown();
    });

    describe('reverse relationships', () => {
      it('correctly creates a reverse relationship', async () => {
        const referee: Cube = await makePost("I am the base post", undefined, undefined, reducedDifficulty);
        const referrer = await makePost("I am a reply", await referee.getKey(), undefined, reducedDifficulty);
        await cubeStore.addCube(referrer);

        const reverserels = annotationEngine.getReverseRelationships(await referee.getKey());
        expect(reverserels.length).toEqual(1);
        expect(reverserels[0].type).toEqual(cciRelationshipType.REPLY_TO);
        expect(reverserels[0].remoteKey.toString('hex')).toEqual((await referrer.getKey()).toString('hex'));
      });

      it('will not honor more than one REPLY_TO', async () => {
        const referee: Cube = await makePost("I am the base post", undefined, undefined, reducedDifficulty);
        const spurious_referee: Cube = await makePost("Huh? I got nothing to do with this", undefined, undefined, reducedDifficulty)

        // referrer can't be built with makePost because it's deliberately invalid

        const referrer: cciCube = cciCube.Frozen({
          fields: [
            cciField.Application("ZW"),
            cciField.MediaType(MediaTypes.TEXT),
            cciField.Payload("I will reply to everybody at one and NO ONE CAN STOP ME AHAHAHAHAHAHAHAHAHAHAHA!!!!!!!!1111"),
            cciField.RelatesTo(
              new cciRelationship(cciRelationshipType.REPLY_TO, await referee.getKey())),
          ],
          family: cciFamily, requiredDifficulty: reducedDifficulty});
        referrer.getBinaryData();  // finalize Cube & compile fields
        await cubeStore.addCube(referrer);

        const reverserels = annotationEngine.getReverseRelationships(await referee.getKey());
        // expect reverse relationship referrer ← referee to be annotated as the
        // first REPLY_TO will be honored
        expect(reverserels.length).toEqual(1);
        expect(reverserels[0].type).toEqual(cciRelationshipType.REPLY_TO);
        expect(reverserels[0].remoteKey.toString('hex')).toEqual((await referrer.getKey()).toString('hex'));

        // expect spurious referee not to be annotated as a spurious REPLY_TO
        // will be ignored
        const spuriousreverserefs = annotationEngine.getReverseRelationships(await spurious_referee.getKey());
        expect(spuriousreverserefs.length).toEqual(0);
      }, 5000);
    });

    describe('basic displayability', () => {
      it('should mark a single root cube as displayable', async () => {
        const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, undefined, reducedDifficulty);

        const callback = vi.fn();
        annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

        await cubeStore.addCube(root);

        // we need to yield control as ZwAnnotationEngine.emitIfCubeDisplayable()
        // is async and will therefore be scheduled rather than called immediately
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(callback.mock.calls.length).toBe(1);
        expect(callback.mock.calls).toEqual([
          [await root.getKeyString()],
        ]);
      }, 5000);

      it('should mark a cube and a reply received in sync as displayable', async () => {
        const root: Cube = await makePost("Ich bin ein Huhn, bok bok!", undefined, undefined, reducedDifficulty);
        const leaf: Cube = await makePost("Hab viel zu tun, bok bok!", await root.getKey(), undefined, reducedDifficulty);

        const callback = vi.fn();
        annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

        await cubeStore.addCube(root);
        await cubeStore.addCube(leaf);

        // we need to yield control as ZwAnnotationEngine.emitIfCubeDisplayable()
        // is async and will therefore be scheduled rather than called immediately
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(callback.mock.calls.length).toBe(2);
        expect(callback.mock.calls).toEqual([
          [await root.getKeyString()],
          [await leaf.getKeyString()]
        ]);
      }, 5000);

      it('should not mark replies as displayable when the original post is unavailable', async () => {
        const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, undefined, reducedDifficulty);
        const leaf: Cube = await makePost("steht draußen am Balkon", await root.getKey(), undefined, reducedDifficulty);

        const callback = vi.fn();
        annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

        await cubeStore.addCube(leaf);

        // we need to yield control as ZwAnnotationEngine.emitIfCubeDisplayable()
        // is async and will therefore be scheduled rather than called immediately
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(callback).not.toHaveBeenCalled();
      }, 5000);

      it('should mark replies as displayable only once all preceding posts has been received', async () => {
        const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, undefined, reducedDifficulty);
        const intermediate: Cube = await makePost("steht draußen am Balkon", await root.getKey(), undefined, reducedDifficulty);
        const leaf: Cube = await makePost("hollari, hollari, hollaroooo", await intermediate.getKey(), undefined, reducedDifficulty);

        const callback = vi.fn();
        annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

        // add in reverse order:
        await cubeStore.addCube(leaf);
        await cubeStore.addCube(intermediate);
        await cubeStore.addCube(root);

        // we need to yield control as ZwAnnotationEngine.emitIfCubeDisplayable()
        // is async and will therefore be scheduled rather than called immediately
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(callback.mock.calls).toEqual([
          [await root.getKeyString()],
          [await intermediate.getKeyString()],
          [await leaf.getKeyString()]
        ]);
      }, 5000);
    });  // basic displayability
  });  // basic config

  describe('Identity-dependent displayability', () => {
    beforeEach(async () => {
      annotationEngine = await ZwAnnotationEngine.ZwConstruct(
        cubeStore,
        SubscriptionRequirement.none,
        [],     // no subscriptions as they don't play a role for this group of tests
        true,   // auto-learn MUCs
        false);  // do not anonymous posts
    });

    it('does not mark posts displayable if their Identity is missing', async () => {
      const callback = vi.fn();
      annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

      const post: Cube = await makePost(
        "Nomen meum secretum est", undefined, undefined, reducedDifficulty);
      await cubeStore.addCube(post);

      // we need to yield control as ZwAnnotationEngine.emitIfCubeDisplayable()
      // is async and will therefore be scheduled rather than called immediately
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(callback).not.toHaveBeenCalled();
    });

    it('marks a post displayable if it is received after its Identity', async () => {
      const callback = vi.fn();
      annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Usor probationis";
      const post: Cube = await makePost(
        "Nomen meum secretum est", undefined, id, reducedDifficulty);
      await id.store();
      await cubeStore.addCube(post);

      // we need to yield control as ZwAnnotationEngine.emitIfCubeDisplayable()
      // is async and will therefore be scheduled rather than called immediately
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(callback.mock.calls).toEqual([
        [await post.getKeyString()],
      ]);
    });

    it('marks a post displayable if it is received before its Identity', async () => {
      const callback = vi.fn();
      annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Usor probationis";
      const post: Cube = await makePost(
        "Nomen meum secretum est", undefined, id, reducedDifficulty);
      await cubeStore.addCube(post);
      await new Promise(resolve => setTimeout(resolve, 100));  // Identity is only learned a little later
      expect(callback).not.toHaveBeenCalled();

      await id.store();  // this makes ZwAnnotationEngine learn the Identity
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
      expect(callback.mock.calls).toEqual([
        [await post.getKeyString()],
      ]);
    });

    it('marks a post displayable even if it is received while we still hold an older version of the Identity', async () => {
      const callback = vi.fn();
      annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      await id.store();  // this makes ZwAnnotationEngine learn the Identity
      id.name = "Usor probationis";
      const post: Cube = await makePost(
        "Nomen meum non nosti, sed aliquando cognosces",
        undefined, id, reducedDifficulty);
      await cubeStore.addCube(post);
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
      expect(callback).not.toHaveBeenCalled();
      // note id has not been stored yet, so ZwAnnotationEngine still has the
      // old version of id without the post

      await new Promise(resolve => setTimeout(resolve, 100));  // id update only learned a little later
      await id.store();
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
      expect(callback.mock.calls).toEqual([
        [await post.getKeyString()],
      ]);
    });

    // TODO fix failing test
    it.skip("marks a reply displayable even if we receive the root post's identity late", async() => {
      const callback = vi.fn();
      annotationEngine.on('cubeDisplayable', (key) => callback(key.toString('hex')));

      const rootId: Identity = await Identity.Create(
        cubeStore, "usor incitans", "clavis secreta", idTestOptions);
      const replyId: Identity = await Identity.Create(
        cubeStore, "usor respondens", "aliud clavis", idTestOptions);

      const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, rootId, reducedDifficulty);
      const reply: Cube = await makePost("steht draußen am Balkon", await root.getKey(), replyId, reducedDifficulty);
      await replyId.store();
      await cubeStore.addCube(root);
      await cubeStore.addCube(reply);
      await new Promise(resolve => setTimeout(resolve, 100));  // root ID only learned a little later
      expect(callback).not.toHaveBeenCalled();

      await rootId.store();  // this makes ZwAnnotationEngine learn the root Identity
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
      expect(callback.mock.calls).toEqual([
        [await root.getKeyString()],
        [await reply.getKeyString()],
      ]);
    });

    // TODO change: This is what currently happens, but it would be rather desirable
    // to show threads including replies of our subscribed authors, even if those
    // threads contain anonymous posts.
    it.todo("does not mark a reply to an anonymous post displayable");
  });  // Identity-dependent displayability

  describe('cube ownership', () => {
    beforeEach(async () => {
      annotationEngine = await ZwAnnotationEngine.ZwConstruct(
        cubeStore,
        SubscriptionRequirement.none,
        [],     // no subscriptions as they don't play a role for this group of tests
        true,   // auto-learn MUCs
        false);  // do not allow anonymous posts
    });

    it('should remember Identity MUCs', async () => {
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Probator Annotationem";
      await id.store();
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
      expect(annotationEngine.identityMucs.size).toEqual(1);
      const restored: Identity = await Identity.Construct(cubeStore,
        annotationEngine.identityMucs.get(id.publicKey.toString('hex'))?.getCube(cciFamily) as cciCube);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Annotationem");
    });

    // Skipped as we currently don't do any meaningful validation on MUCs.
    // Since we dropped the requirement for Identity MUCs to have a USERNAME
    // field and also dropped the requirement for them to have a specific
    // APPLICATION field, there's not much left we can validate.
    it.skip('should not remember non-Identity MUCs', async () => {
      const keys: KeyPair = sodium.crypto_sign_keypair();
      const muc: Cube = Cube.MUC(
        Buffer.from(keys.publicKey),
        Buffer.from(keys.privateKey),
        {
          fields: cciField.Payload("hoc non est identitatis"),
          family: cciFamily, requiredDifficulty: reducedDifficulty
        });
      await cubeStore.addCube(muc);
      expect(annotationEngine.identityMucs.size).toEqual(0);
    });

    it('should identify the author of a post directly referred to from a MUC', async () => {
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Probator Attributionis Auctoris";
      const post: Cube = await makePost("Habeo res importantes dicere", undefined, id, reducedDifficulty);
      await cubeStore.addCube(post);
      const postKey = await post.getKey();
      expect(postKey).toBeDefined;
      await id.store();
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

      const restoredAuthor: Identity = await annotationEngine.cubeAuthor(postKey);
      expect(restoredAuthor).toBeInstanceOf(Identity);
      expect(restoredAuthor.name).
        toEqual("Probator Attributionis Auctoris");
    });

    // This test is a bit lengthy and convoluted as I was chasing a Heisenbug
    // involving the MUC's key suddenly becoming undefined.
    // It's a pretty thorough test, though, so let's keep it.
    it('should identify the author multiple times while other stuff takes place', async () => {
      // create and store identity
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Probator Attributionis Auctoris";
      expect(id.muc).toBeInstanceOf(Cube);
      const preliminaryMuc: Cube = await id.store();
      expect(preliminaryMuc).toEqual(id.muc);
      expect(id.muc).toBeInstanceOf(Cube);
      const idKey = id.muc.getKeyIfAvailable();
      expect(idKey).toBeInstanceOf(Buffer);
      const preliminaryIdHash = id.muc.getHashIfAvailable();
      expect(preliminaryIdHash).toBeInstanceOf(Buffer);
      expect(preliminaryIdHash.equals(await (await cubeStore.getCube(idKey))?.getHash()!)).toBeTruthy();

      // add post and re-store Identity
      const postKey: CubeKey = (await cubeStore.addCube(await makePost(
          "I got important stuff to say", undefined, id, reducedDifficulty)
        )).getKeyIfAvailable();
      expect(postKey).toBeInstanceOf(Buffer);
      const firstMuc: Cube = await id.store();

      // re-storing the Identity changes it's hash but keeps it's key
      expect(id.muc).toBeInstanceOf(Cube);
      expect(firstMuc).toEqual(id.muc);
      expect((await firstMuc.getHash()).equals(await id.muc.getHash())).toBeTruthy();
      const secondIdKey = id.muc.getKeyIfAvailable();
      expect(secondIdKey).toBeInstanceOf(Buffer);
      expect(idKey.equals(secondIdKey)).toBeTruthy();
      const firstIdHash = id.muc.getHashIfAvailable();
      expect(firstIdHash).toBeInstanceOf(Buffer);
      expect(preliminaryIdHash.equals(firstIdHash)).toBeFalsy();
      expect(preliminaryIdHash.equals(await (await cubeStore.getCube(idKey))?.getHash()!)).toBeFalsy();
      expect(firstIdHash.equals(await (await cubeStore.getCube(idKey))?.getHash()!)).toBeTruthy();

      // make sure the new post is referenced directly in the MUC
      let mucRelToPost: any = undefined;
      for (const rel of id.muc.fields.getRelationships(cciRelationshipType.MYPOST)) {
        if (rel.remoteKey.equals(postKey)) mucRelToPost = rel;
      }
      expect(mucRelToPost).toBeInstanceOf(cciRelationship);

      // Wait for the annotationEngine to take note of the MUC change.
      // This is event driven, so it may take a short while.
      // In production use this is not an issue as inter-node Cube sync time
      // will be orders of magnitude longer anyway.
      for (let i = 0; i < 30; i++) {
        const mucInAnnotationEngine: CubeInfo = annotationEngine.identityMucs.get(idKey.toString('hex'))!;
        if(mucInAnnotationEngine.getCube()!.getHashIfAvailable().equals(firstIdHash)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const mucInAnnotationEngine: CubeInfo = annotationEngine.identityMucs.get(idKey.toString('hex'))!;
      expect(mucInAnnotationEngine).toBeInstanceOf(CubeInfo);
      expect(mucInAnnotationEngine.key).toBeInstanceOf(Buffer);
      expect(mucInAnnotationEngine.key.equals(idKey)).toBeTruthy();
      expect(mucInAnnotationEngine.getCube()!.getKeyIfAvailable()).toEqual(idKey);

      {  // check 1
      const restoredAuthor: Identity = await annotationEngine.cubeAuthor(postKey);
      expect(restoredAuthor).toBeDefined();
      expect(restoredAuthor.muc).toBeInstanceOf(Cube);
      expect(restoredAuthor.muc.getKeyIfAvailable()).toBeInstanceOf(Buffer);
      expect(restoredAuthor.muc.getKeyIfAvailable().equals(id.muc.getKeyIfAvailable())).toBeTruthy();
      expect(restoredAuthor.muc.getHashIfAvailable()).toBeInstanceOf(Buffer);
      expect(restoredAuthor.muc.getHashIfAvailable().equals(firstIdHash)).toBeTruthy();
      expect(restoredAuthor).toBeInstanceOf(Identity);
      expect(restoredAuthor.name).
        toEqual("Probator Attributionis Auctoris");
      }

      // do some other unrelated stuff...
      await new Promise(resolve => setTimeout(resolve, 250));
      // learn a new unrelated post
      await cubeStore.addCube(await makePost("Lalelu", undefined, undefined, reducedDifficulty));
      await new Promise(resolve => setTimeout(resolve, 250));
      // learn a new unrelated MUC
      const unrelatedKeys: KeyPair = sodium.crypto_sign_keypair();
      await cubeStore.addCube(Cube.MUC(
        Buffer.from(unrelatedKeys.publicKey),
        Buffer.from(unrelatedKeys.privateKey),
        {
          fields: cciField.Payload("I am some other application's MUC"),
          family: cciFamily,
          requiredDifficulty: reducedDifficulty
        }));
      await new Promise(resolve => setTimeout(resolve, 250));

      {  // check 2
        const restoredAuthor: Identity = await annotationEngine.cubeAuthor(postKey);
        expect(restoredAuthor.muc).toBeInstanceOf(Cube);
        expect(restoredAuthor.muc.getKeyIfAvailable()).toBeInstanceOf(Buffer);
        expect(restoredAuthor.muc.getKeyIfAvailable().equals(id.muc.getKeyIfAvailable())).toBeTruthy();
        expect(restoredAuthor.muc.getHashIfAvailable()).toBeInstanceOf(Buffer);
        expect(restoredAuthor.muc.getHashIfAvailable().equals(firstIdHash)).toBeTruthy();
          expect(restoredAuthor).toBeInstanceOf(Identity);
        expect(restoredAuthor.name).
          toEqual("Probator Attributionis Auctoris");
      }

      // do some marginally related stuff...
      await new Promise(resolve => setTimeout(resolve, 250));
      // our user makes a new post
      await cubeStore.addCube(await makePost("verba mea magna sunt", undefined, id, reducedDifficulty));
      await id.store();
      const idHashAfterOneNewPost = id.muc.getHashIfAvailable();
      await new Promise(resolve => setTimeout(resolve, 250));

      {  // check 3
        const restoredAuthor: Identity = await annotationEngine.cubeAuthor(postKey);
        expect(restoredAuthor.muc).toBeInstanceOf(Cube);
        expect(restoredAuthor.muc.getKeyIfAvailable()).toBeInstanceOf(Buffer);
        expect(restoredAuthor.muc.getKeyIfAvailable().equals(idKey)).toBeTruthy();
        expect(restoredAuthor.muc.getHashIfAvailable()).toBeInstanceOf(Buffer);
        expect(restoredAuthor.muc.getHashIfAvailable().equals(idHashAfterOneNewPost)).toBeTruthy();
        expect(restoredAuthor.muc.getHashIfAvailable().equals(firstIdHash)).toBeFalsy();
        expect(restoredAuthor).toBeInstanceOf(Identity);
        expect(restoredAuthor.name).
          toEqual("Probator Attributionis Auctoris");
      }

      // wait to make sure a new MUC version will be at least a second newer
      // than the old one, otherwise it will fail the CubeContest
      await new Promise(resolve => setTimeout(resolve, 1000));

      // do something that actually makes a difference...
      await new Promise(resolve => setTimeout(resolve, 250));
      // our user changes it's name
      id.name = "Probator Attributionis Auctoris et Persona Gravissima in Generali";
      await id.store();
      await new Promise(resolve => setTimeout(resolve, 250));
      const idHashAfterNameChange = id.muc.getHashIfAvailable();

      {  // check 4
        const restoredAuthor: Identity = await annotationEngine.cubeAuthor(postKey);
        expect(restoredAuthor.muc).toBeInstanceOf(Cube);
        expect(restoredAuthor.muc.getKeyIfAvailable()).toBeInstanceOf(Buffer);
        expect(restoredAuthor.muc.getKeyIfAvailable().equals(idKey)).toBeTruthy();
        expect(restoredAuthor.muc.getHashIfAvailable()).toBeInstanceOf(Buffer);
        expect(restoredAuthor.muc.getHashIfAvailable().equals(idHashAfterNameChange)).toBeTruthy();
        expect(restoredAuthor.muc.getHashIfAvailable().equals(firstIdHash)).toBeFalsy();
        expect(restoredAuthor).toBeInstanceOf(Identity);
        expect(restoredAuthor.name).
          toEqual("Probator Attributionis Auctoris et Persona Gravissima in Generali");
      }
    }, 5000);

    it('should identify the author of a post after the key was converted to a string', async () => {
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Probator Attributionis Auctoris";
      const post: Cube = await makePost("I got important stuff to say", undefined, id, reducedDifficulty);
      await cubeStore.addCube(post);
      const postKey = (await post.getKey()).toString('hex');
      expect(postKey).toBeDefined;
      await id.store();
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

      const restoredAuthor: Identity = await annotationEngine.cubeAuthor(Buffer.from(postKey, 'hex'));
      expect(restoredAuthor).toBeInstanceOf(Identity);
      expect(restoredAuthor.name).
        toEqual("Probator Attributionis Auctoris");
    });

    it('should identify the author of a post indirectly referred to through other posts', async () => {
      const TESTPOSTCOUNT = 100;  // 100 keys are more than guaranteed not to fit in the MUC
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Probator Attributionis Auctoris";
      const posts: CubeKey[] = [];

      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const post: Cube = await makePost("I got important stuff to say", undefined, id, reducedDifficulty);
        posts.push(await post.getKey());
        await cubeStore.addCube(post);
      }
      await id.store();
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

      for (let i=0; i<TESTPOSTCOUNT; i++) {
        expect((await annotationEngine.cubeAuthor(posts[i])).name).
          toEqual("Probator Attributionis Auctoris");
      }
    }, 20000);
  });  // cube ownership
});
