import { Cube, CubeKey } from "../../src/core/cube";
import { CubeField, CubeFields, CubeRelationship, CubeRelationshipType } from "../../src/core/cubeFields";
import { CubeInfo } from "../../src/core/cubeInfo";
import { CubeStore } from "../../src/core/cubeStore";
import { AnnotationEngine } from "../../src/core/annotationEngine";
import { Identity } from "../../src/app/identity";
import { ZwAnnotationEngine } from "../../src/app/zwAnnotationEngine";
import { makePost } from "../../src/app/zwCubes"

import sodium, { KeyPair } from 'libsodium-wrappers'
import { MediaTypes, ZwField, ZwFields, ZwRelationship, ZwRelationshipType, zwFieldDefinition } from "../../src/app/zwFields";
import { FieldParser } from "../../src/core/fieldParser";

describe('ZwAnnotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: ZwAnnotationEngine;
  let reduced_difficulty = 0;

  describe('default config', () => {
    beforeEach(async () => {
      await sodium.ready;
      cubeStore = new CubeStore(false, reduced_difficulty);
      await cubeStore.readyPromise;
      annotationEngine = new ZwAnnotationEngine(cubeStore);
    }, 3000);

    describe('reverse relationships', () => {
      it('correctly creates a reverse relationship', async () => {
        const referee: Cube = await makePost("I am the base post", undefined, undefined, reduced_difficulty);
        const referrer = await makePost("I am a reply", await referee.getKey(), undefined, reduced_difficulty);
        await cubeStore.addCube(referrer);

        const reverserels = annotationEngine.getReverseRelationships(await referee.getKey());
        expect(reverserels.length).toEqual(1);
        expect(reverserels[0].type).toEqual(ZwRelationshipType.REPLY_TO);
        expect(reverserels[0].remoteKey.toString('hex')).toEqual((await referrer.getKey()).toString('hex'));
      });

      it('will not honor more than one REPLY_TO', async () => {
        const referee: Cube = await makePost("I am the base post", undefined, undefined, reduced_difficulty);
        const spurious_referee: Cube = await makePost("Huh? I got nothing to do with this", undefined, undefined, reduced_difficulty)

        // referrer can't be build with makePost because it's deliberately invalid
        const zwFields: ZwFields = new ZwFields(ZwField.Application());
        zwFields.appendField(ZwField.MediaType(MediaTypes.TEXT));
        zwFields.appendField(ZwField.Payload("I will reply to everybody at one and NO ONE CAN STOP ME AHAHAHAHAHAHAHAHAHAHAHA!!!!!!!!1111"));
        zwFields.appendField(ZwField.RelatesTo(
          new ZwRelationship(ZwRelationshipType.REPLY_TO, await referee.getKey())
        ));
        zwFields.appendField(ZwField.RelatesTo(
          new ZwRelationship(ZwRelationshipType.REPLY_TO, await spurious_referee.getKey())
        ));
        const zwData: Buffer = new FieldParser(zwFieldDefinition).compileFields(zwFields);
        const referrer: Cube = new Cube(undefined, reduced_difficulty);
        referrer.setFields(CubeField.Payload(zwData));
        referrer.getBinaryData();  // finalize Cube & compile fields
        await cubeStore.addCube(referrer);

        const reverserels = annotationEngine.getReverseRelationships(await referee.getKey());
        // expect reverse relationship referrer ← referee to be annotated as the
        // first REPLY_TO will be honored
        expect(reverserels.length).toEqual(1);
        expect(reverserels[0].type).toEqual(ZwRelationshipType.REPLY_TO);
        expect(reverserels[0].remoteKey.toString('hex')).toEqual((await referrer.getKey()).toString('hex'));

        // expect spurious referee not to be annotated as a spurious REPLY_TO
        // will be ignored
        const spuriousreverserefs = annotationEngine.getReverseRelationships(await spurious_referee.getKey());
        expect(spuriousreverserefs.length).toEqual(0);
      }, 5000);
    });

    describe('basic displayability', () => {
      it('should mark a single root cube as displayable', async () => {
        const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, undefined, reduced_difficulty);

        const callback = jest.fn();
        annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

        await cubeStore.addCube(root);

        expect(callback.mock.calls).toEqual([
          [await root.getKey()],
        ]);
      }, 5000);

      it('should mark a cube and a reply received in sync as displayable', async () => {
        const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, undefined, reduced_difficulty);
        const leaf: Cube = await makePost("steht draußen am Balkon", await root.getKey(), undefined, reduced_difficulty);

        const callback = jest.fn();
        annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

        await cubeStore.addCube(root);
        await cubeStore.addCube(leaf);

        expect(callback.mock.calls).toEqual([
          [await root.getKey()],
          [await leaf.getKey()]
        ]);
      }, 5000);

      it('should not mark replies as displayable when the original post is unavailable', async () => {
        const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, undefined, reduced_difficulty);
        const leaf: Cube = await makePost("steht draußen am Balkon", await root.getKey(), undefined, reduced_difficulty);

        const callback = jest.fn();
        annotationEngine.on('cubeDisplayable', (hash) => callback(hash));

        await cubeStore.addCube(leaf);
        expect(callback).not.toHaveBeenCalled();
      }, 5000);

      it('should mark replies as displayable only once all preceding posts has been received', async () => {
        const root: Cube = await makePost("Mein kleiner grüner Kaktus", undefined, undefined, reduced_difficulty);
        const intermediate: Cube = await makePost("steht draußen am Balkon", await root.getKey(), undefined, reduced_difficulty);
        const leaf: Cube = await makePost("hollari, hollari, hollaroooo", await intermediate.getKey(), undefined, reduced_difficulty);

        const callback = jest.fn();
        annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

        // add in reverse order:
        await cubeStore.addCube(leaf);
        await cubeStore.addCube(intermediate);
        await cubeStore.addCube(root);

        expect(callback.mock.calls).toEqual([
          [await root.getKey()],
          [await intermediate.getKey()],
          [await leaf.getKey()]
        ]);
      }, 5000);
    });  // basic displayability

    describe('MUC-based displayability', () => {
      it('correctly marks a post displayable if it is received after its MUC', () => {
        // TODO implement
      });

      it('correctly marks a post displayable if it is received before its MUC', () => {
        // TODO implement
      });

      it('correctly marks a post displayable if it is received while we still hold an older version of the MUC', () => {
        // TODO implement
      });
    });

    describe('cube ownership', () => {
      it('should remember Identity MUCs', async () => {
        const id: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests
        id.name = "Probator Annotationem";
        await id.store(reduced_difficulty);

        expect(annotationEngine.identityMucs.size).toEqual(1);
        const restored: Identity = new Identity(cubeStore,
          annotationEngine.identityMucs.get(id.publicKey.toString('hex'))?.getCube());
        expect(restored).toBeInstanceOf(Identity);
        expect(restored.name).toEqual("Probator Annotationem");
      });

      it('should not remember non-Identity MUCs', async () => {
        const keys: KeyPair = sodium.crypto_sign_keypair();
        const muc: Cube = Cube.MUC(
          Buffer.from(keys.publicKey),
          Buffer.from(keys.privateKey),
          CubeField.Payload("hoc non est identitatis"),
          reduced_difficulty
        );
        await cubeStore.addCube(muc);
        expect(annotationEngine.identityMucs.size).toEqual(0);
      });

      it('should identify the author of a post directly referred to from a MUC', async () => {
        const id: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests
        id.name = "Probator Attributionis Auctoris";
        const post: Cube = await makePost("I got important stuff to say", undefined, id, reduced_difficulty);
        await cubeStore.addCube(post);
        const postKey = await post.getKey();
        expect(postKey).toBeDefined;
        await id.store(reduced_difficulty);

        const restoredAuthor: Identity = annotationEngine.cubeAuthor(postKey);
        expect(restoredAuthor).toBeInstanceOf(Identity);
        expect(restoredAuthor.name).
          toEqual("Probator Attributionis Auctoris");
      });

      // This test is a bit lengthy and convoluted as I was chasing a Heisenbug
      // involving the MUC's key suddenly becoming undefined.
      // SKIPPED due to execution time (min time between MUC updates)
      it('should identify the author multiple times while other stuff takes place', async () => {
        // create and store identity
        const id: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduce min time between MUCs to one second for this test
        id.name = "Probator Attributionis Auctoris";
        expect(id.muc).toBeInstanceOf(Cube);
        const preliminaryMuc: Cube = await id.store(reduced_difficulty);
        expect(preliminaryMuc).toEqual(id.muc);
        expect(id.muc).toBeInstanceOf(Cube);
        const idKey = id.muc.getKeyIfAvailable();
        expect(idKey).toBeInstanceOf(Buffer);
        const preliminaryIdHash = id.muc.getHashIfAvailable();
        expect(preliminaryIdHash).toBeInstanceOf(Buffer);
        expect(preliminaryIdHash.equals(await cubeStore.getCube(idKey)?.getHash()!)).toBeTruthy();

        // add post and re-store Identity
        const postKey: CubeKey = (await cubeStore.addCube(await makePost("I got important stuff to say", undefined, id, reduced_difficulty))).getKeyIfAvailable();
        expect(postKey).toBeInstanceOf(Buffer);
        const firstMuc: Cube = await id.store(reduced_difficulty);

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
        expect(preliminaryIdHash.equals(await cubeStore.getCube(idKey)?.getHash()!)).toBeFalsy();
        expect(firstIdHash.equals(await cubeStore.getCube(idKey)?.getHash()!)).toBeTruthy();

        // make sure the new post is referenced directly in the MUC
        let mucRelToPost: any = undefined;
        for (const rel of ZwFields.get(id.muc).getRelationships(ZwRelationshipType.MYPOST)) {
          if (rel.remoteKey.equals(postKey)) mucRelToPost = rel;
        }
        expect(mucRelToPost).toBeInstanceOf(ZwRelationship);

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
        const restoredAuthor: Identity = annotationEngine.cubeAuthor(postKey);
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
        await cubeStore.addCube(await makePost("Lalelu", undefined, undefined, reduced_difficulty));
        await new Promise(resolve => setTimeout(resolve, 250));
        // learn a new unrelated MUC
        const unrelatedKeys: KeyPair = sodium.crypto_sign_keypair();
        await cubeStore.addCube(Cube.MUC(Buffer.from(unrelatedKeys.publicKey), Buffer.from(unrelatedKeys.privateKey), CubeField.Payload("I am some other application's MUC"), reduced_difficulty));
        await new Promise(resolve => setTimeout(resolve, 250));

        {  // check 2
          const restoredAuthor: Identity = annotationEngine.cubeAuthor(postKey);
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
        await cubeStore.addCube(await makePost("verba mea magna sunt", undefined, id, reduced_difficulty));
        await id.store(reduced_difficulty);
        const idHashAfterOneNewPost = id.muc.getHashIfAvailable();
        await new Promise(resolve => setTimeout(resolve, 250));

        {  // check 3
          const restoredAuthor: Identity = annotationEngine.cubeAuthor(postKey);
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
        await id.store(reduced_difficulty);
        await new Promise(resolve => setTimeout(resolve, 250));
        const idHashAfterNameChange = id.muc.getHashIfAvailable();

        {  // check 4
          const restoredAuthor: Identity = annotationEngine.cubeAuthor(postKey);
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
      }, 30000);

      it('should identify the author of a post after the key was converted to a string', async () => {
        const id: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests
        id.name = "Probator Attributionis Auctoris";
        const post: Cube = await makePost("I got important stuff to say", undefined, id, reduced_difficulty);
        await cubeStore.addCube(post);
        const postKey = (await post.getKey()).toString('hex');
        expect(postKey).toBeDefined;
        await id.store(reduced_difficulty);

        const restoredAuthor: Identity = annotationEngine.cubeAuthor(Buffer.from(postKey, 'hex'));
        expect(restoredAuthor).toBeInstanceOf(Identity);
        expect(restoredAuthor.name).
          toEqual("Probator Attributionis Auctoris");
      });

      it('should identify the author of a post indirectly referred to through other posts', async () => {
        const TESTPOSTCOUNT = 100;  // 100 keys are more than guaranteed not to fit in the MUC
        const id: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests
        id.name = "Probator Attributionis Auctoris";
        const posts: CubeKey[] = [];

        for (let i=0; i<TESTPOSTCOUNT; i++) {
          const post: Cube = await makePost("I got important stuff to say", undefined, id, reduced_difficulty);
          posts.push(await post.getKey());
          await cubeStore.addCube(post);
        }
        await id.store(reduced_difficulty);

        for (let i=0; i<TESTPOSTCOUNT; i++) {
          expect(annotationEngine.cubeAuthor(posts[i]).name).
            toEqual("Probator Attributionis Auctoris");
        }
      });
    });  // cube ownership
  }); // default config
});