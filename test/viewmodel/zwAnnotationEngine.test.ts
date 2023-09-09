import { Cube, CubeKey } from "../../src/model/cube";
import { CubeField, CubeFields, CubeRelationship, CubeRelationshipType } from "../../src/model/cubeFields";
import { CubeStore } from "../../src/model/cubeStore";
import { AnnotationEngine } from "../../src/viewmodel/annotationEngine";
import { Identity } from "../../src/viewmodel/identity";
import { ZwAnnotationEngine } from "../../src/viewmodel/zwAnnotationEngine";
import { makePost } from "../../src/viewmodel/zwCubes"

import sodium, { KeyPair } from 'libsodium-wrappers'

describe('ZwAnnotationEngine', () => {
  let cubeStore: CubeStore;
  let annotationEngine: ZwAnnotationEngine;

  beforeEach(async () => {
    await sodium.ready;
    cubeStore = new CubeStore(false);
    annotationEngine = new ZwAnnotationEngine(cubeStore);
  }, 1000);

  describe('displayability', () => {
    it('should mark a single root cube as displayable', async () => {
      const root: Cube = await makePost("Mein kleiner grüner Kaktus");

      const callback = jest.fn();
      annotationEngine.on('cubeDisplayable', (hash) => callback(hash)) // list cubes

      await cubeStore.addCube(root);

      expect(callback.mock.calls).toEqual([
        [await root.getKey()],
      ]);
    }, 5000);

    it('should mark a cube and a reply received in sync as displayable', async () => {
      const root: Cube = await makePost("Mein kleiner grüner Kaktus");
      const leaf: Cube = await makePost("steht draußen am Balkon", await root.getKey());

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
      const root: Cube = await makePost("Mein kleiner grüner Kaktus");
      const leaf: Cube = await makePost("steht draußen am Balkon", await root.getKey());

      const callback = jest.fn();
      annotationEngine.on('cubeDisplayable', (hash) => callback(hash));

      await cubeStore.addCube(leaf);
      expect(callback).not.toHaveBeenCalled();
    }, 5000);

    it('should mark replies as displayable only once all preceding posts has been received', async () => {
      const root: Cube = await makePost("Mein kleiner grüner Kaktus");
      const intermediate: Cube = await makePost("steht draußen am Balkon", await root.getKey());
      const leaf: Cube = await makePost("hollari, hollari, hollaroooo", await intermediate.getKey());

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
  });  // displayability

  describe('cube ownership', () => {
    it('should remember Identity MUCs', async () => {
      const id: Identity = new Identity(cubeStore);
      id.name = "Probator Annotationem";
      await id.store();

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
        CubeField.Payload("hoc non est identitatis")
      );
      await cubeStore.addCube(muc);
      expect(annotationEngine.identityMucs.size).toEqual(0);
    });

    it('should identify the author of a post directly referred to from a MUC', async () => {
      const id: Identity = new Identity(cubeStore);
      id.name = "Probator Attributionis Auctoris";
      const post: Cube = await makePost("I got important stuff to say", undefined, id);
      await cubeStore.addCube(post);
      const postKey = await post.getKey();
      expect(postKey).toBeDefined;
      await id.store();

      const restoredAuthor: Identity = annotationEngine.cubeAuthor(postKey);
      expect(restoredAuthor).toBeInstanceOf(Identity);
      expect(restoredAuthor.name).
        toEqual("Probator Attributionis Auctoris");
    });

    // You'll probably want to skip this test or precalculate the hashcash or something...
    // this is a superb waste of CPU time.
    // But hey, at least we get a feel for how expensive spam will be :D
    it('should identify the author of a post indirectly referred to through other posts', async () => {
      const TESTPOSTCOUNT = 40;  // 40 keys are more than guaranteed not to fit in the MUC
      const id: Identity = new Identity(cubeStore);
      id.name = "Probator Attributionis Auctoris";
      const posts: CubeKey[] = [];

      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const post: Cube = await makePost("I got important stuff to say", undefined, id);
        posts.push(await post.getKey());
        await cubeStore.addCube(post);
      }
      await id.store();

      for (let i=0; i<TESTPOSTCOUNT; i++) {
        expect(annotationEngine.cubeAuthor(posts[i]).name).
          toEqual("Probator Attributionis Auctoris");
      }
    });
  });


});