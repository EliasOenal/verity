import { Identity, IdentityPersistance } from '../../src/app/identity'
import { Cube, CubeKey } from '../../src/core/cube'
import { NetConstants } from '../../src/core/networkDefinitions';

import sodium from 'libsodium-wrappers'
import { CubeStore } from '../../src/core/cubeStore';
import { makePost } from '../../src/app/zwCubes';
import { ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType } from '../../src/app/zwFields';
import { logger } from '../../src/core/logger';

describe('Identity', () => {
  let cubeStore: CubeStore;
  const reduced_difficulty = 0;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore(false, reduced_difficulty);  // require no hashcash for faster testing
  });

  describe('MUC storage', () => {
    it('should store and retrieve a minimal Identity to and from a MUC object', async() => {
      const original: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests
      original.name = "Probator Identitatum";
      const muc = await original.makeMUC(reduced_difficulty);
      expect(muc).toBeInstanceOf(Cube);
      const mucadded = await cubeStore.addCube(muc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      const restoredmuc = cubeStore.getCube(await muc.getKey());
      expect(restoredmuc).toBeInstanceOf(Cube);
      const restored = new Identity(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
    }, 10000);

    it('should store and retrieve an Identity to and from a MUC object', async () => {
      const original: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);

      const postkey = (await cubeStore.addCube(await makePost("I got important stuff to say", undefined, original, reduced_difficulty))).getKeyIfAvailable();
      expect(postkey).toBeInstanceOf(Buffer);
      expect(original.posts.length).toEqual(1);
      expect(ZwFields.get(cubeStore.getCube(original.posts[0]) as Cube).getFirstField(ZwFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("I got important stuff to say");

      // compile ID into MUC
      const muc = await original.makeMUC(reduced_difficulty);
      expect(muc).toBeInstanceOf(Cube);

      // double check everything's in there
      expect(ZwFields.get(muc).getFirstRelationship(ZwRelationshipType.PROFILEPIC).remoteKey).
        toEqual(original.profilepic);
      expect(ZwFields.get(muc).getFirstRelationship(ZwRelationshipType.KEY_BACKUP_CUBE).remoteKey).
        toEqual(original.keyBackupCube);
      expect(ZwFields.get(muc).getFirstRelationship(ZwRelationshipType.MYPOST).remoteKey).
        toEqual(postkey);

      // Store the MUC
      const mucadded = await cubeStore.addCube(muc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      // Restore the Identity from the stored MUC
      const restoredmuc = cubeStore.getCube(await muc.getKey());
      expect(restoredmuc).toBeInstanceOf(Cube);
      const restored = new Identity(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.keyBackupCube[0]).toEqual(0x13);
      expect(restored.posts.length).toEqual(1);
      expect(ZwFields.get(cubeStore.getCube(restored.posts[0]) as Cube).getFirstField(ZwFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("I got important stuff to say");
    }, 10000);

    it('should store and retrieve an Identity to and from a binary MUC', async () => {
      const original: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
      await cubeStore.addCube(await makePost("I got important stuff to say", undefined, original, reduced_difficulty));

      // compile ID into binary MUC
      const muc = await original.makeMUC(reduced_difficulty);
      expect(muc).toBeInstanceOf(Cube);
      const muckey = await muc.getKey();
      expect(muckey).toBeInstanceOf(Buffer);
      expect(muckey).toEqual(original.publicKey);
      const binarymuc = await muc.getBinaryData();
      expect(binarymuc).toBeInstanceOf(Buffer);
      const mucadded = await cubeStore.addCube(binarymuc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      // restore Identity from stored MUC
      const restoredmuc = cubeStore.getCube(await muc.getKey());
      expect(restoredmuc).toBeInstanceOf(Cube);
      const restored = new Identity(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.keyBackupCube[0]).toEqual(0x13);
      expect(restored.posts.length).toEqual(1);
      expect(ZwFields.get(cubeStore.getCube(restored.posts[0]) as Cube).getFirstField(ZwFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("I got important stuff to say");
    }, 10000);

    it('correctly handles subsequent changes', async () => {
      const id = new Identity(cubeStore, undefined, undefined, true, 1);  // reduce min time between MUCs to one second for this test
      id.name = "Probator Identitatum";
      const firstMuc: Cube = await id.store(reduced_difficulty);
      const firstMucHash: Buffer = firstMuc.getHashIfAvailable();
      expect(firstMuc).toBeInstanceOf(Cube);
      expect(firstMucHash).toBeInstanceOf(Buffer);
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeUndefined();
      expect(id.keyBackupCube).toBeUndefined();

      id.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      id.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
      const secondMuc: Cube = await id.store(reduced_difficulty)
      const secondMucHash: Buffer = secondMuc.getHashIfAvailable();
      expect(secondMuc).toBeInstanceOf(Cube);
      expect(secondMucHash).toBeInstanceOf(Buffer);
      expect(secondMucHash.equals(firstMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeInstanceOf(Buffer);
      expect(id.keyBackupCube).toBeInstanceOf(Buffer);

      id.name = "Probator Identitatum Repetitus";
      const thirdMuc: Cube = await id.store(reduced_difficulty)
      const thirdMucHash: Buffer = thirdMuc.getHashIfAvailable();
      expect(thirdMuc).toBeInstanceOf(Cube);
      expect(thirdMucHash).toBeInstanceOf(Buffer);
      expect(thirdMucHash.equals(firstMucHash)).toBeFalsy();
      expect(thirdMucHash.equals(secondMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum Repetitus");
      expect(id.profilepic).toBeInstanceOf(Buffer);
      expect(id.keyBackupCube).toBeInstanceOf(Buffer);
    }, 30000);

    it('restores its post list recursively and sorted by creation time descending', async () => {
      const TESTPOSTCOUNT = 100;  // 100 keys are more than guaranteed not to fit in the MUC
      const original: Identity = new Identity(cubeStore, undefined, undefined, true, 1);  // reduced minimum MUC rebuild time for faster tests
      original.name = "Probator memoriae tabellae";
      const idkey = original.publicKey;

      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const post: Cube = await makePost("I got " + (i+1).toString() + " important things to say", undefined, original, reduced_difficulty);
        // manually save post to ID rather then through makePost because we will
        // manipulate the date below, and that changes the key
        original.forgetMyPost(await post.getKey());
        post.setDate(1694284300 + i);  // now you know when this test was written!
        original.rememberMyPost(await post.getKey());
        await cubeStore.addCube(post);
      }
      expect(original.posts.length).toEqual(TESTPOSTCOUNT);

      await original.store(reduced_difficulty)
      const muc: Cube = original.muc;
      await cubeStore.addCube(muc);

      const restored = new Identity(cubeStore, cubeStore.getCube(idkey))
      expect(restored.posts.length).toEqual(TESTPOSTCOUNT);
      let newerPost: Cube = cubeStore.getCube(restored.posts[0])!;
      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const restoredPost = cubeStore.getCube(restored.posts[i])!;
        const postText: string = ZwFields.get(restoredPost!).getFirstField(ZwFieldType.PAYLOAD).value.toString('utf-8');
        expect(postText).toEqual("I got " + (TESTPOSTCOUNT-i).toString() + " important things to say");
        expect(restoredPost!.getDate()).toBeLessThanOrEqual(newerPost!.getDate());
        newerPost = restoredPost;
      }
    }, 10000);

    describe('subscription recommendations via extension MUCs', ()  => {
      it.only('correctly saves and restores recommended subscriptions to and from extension MUCs', async () => {
        // Create a subject and subscribe 100 other authors
        const TESTSUBCOUNT = 100;
        const subject: Identity = new Identity(cubeStore);
        subject.name = "Subscriptor novarum interessantiarum";
        for (let i=0; i<TESTSUBCOUNT; i++) {
          const other = new Identity(cubeStore);
          other.name = "Figurarius " + i + "-tus";
          other.muc.setDate(0);  // skip waiting period for the test
          other.store(reduced_difficulty);
          subject.addSubscriptionRecommendation(other.key);
          expect(subject.subscriptionRecommendations[i].equals(other.key)).toBeTruthy();
        }
        subject.muc.setDate(0);  // hack, just for the test let's not wait 5s for the MUC update
        const muc: Cube = await subject.store(reduced_difficulty);

        // Master MUC stored in CubeStore?
        const recovered_muc: Cube = cubeStore.getCube(subject.key);
        expect(recovered_muc).toBeInstanceOf(Cube);

        // First subscription recommendation index saved in MUC?
        const fields = ZwFields.get(recovered_muc);
        expect(fields).toBeInstanceOf(ZwFields);
        const rel: ZwRelationship = fields.getFirstRelationship(
          ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX);
        expect(rel.remoteKey).toBeInstanceOf(Buffer);
        expect(rel.remoteKey.equals(
          subject.subscriptionRecommendationIndices[0].getKeyIfAvailable())).
            toBeTruthy();
        // First subscription recommendation index saved in CubeStore?
        const firstIndexCube: Cube = cubeStore.getCube(rel.remoteKey);
        expect(firstIndexCube).toBeInstanceOf(Cube);
        // First subscription recommendation index contains for subscription recommendation?
        const firstIndexFields = ZwFields.get(firstIndexCube);
        expect(firstIndexFields).toBeInstanceOf(ZwFields);
        expect(firstIndexFields.all().length).toBeGreaterThan(1);
        expect(firstIndexFields.getFirstRelationship(
          ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION).remoteKey.equals(
            subject.subscriptionRecommendations[0])).toBeTruthy();

        // Second subscription recommendation index referred from first one?
        const secondIndexRel: ZwRelationship =
          firstIndexFields.getFirstRelationship(
            ZwRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX);
        expect(secondIndexRel).toBeInstanceOf(ZwRelationship);
        const secondIndexCube: Cube = cubeStore.getCube(secondIndexRel.remoteKey);
        expect(secondIndexCube).toBeInstanceOf(Cube);

        // let's put it all together:
        // all subscription recommendations correctly restored?
        const restored: Identity = new Identity(cubeStore, muc);
        expect(restored.subscriptionRecommendations.length).toEqual(TESTSUBCOUNT);
        for (let i=0; i<TESTSUBCOUNT; i++) {
          const othermuc = cubeStore.getCube(restored.subscriptionRecommendations[i]);
          expect(othermuc).toBeInstanceOf(Cube);
          const restoredother: Identity = new Identity(cubeStore, othermuc);
          expect(restoredother.name).toEqual("Figurarius " + i + "-tus");
        }
      }, 30000);

      it('preserves extension MUC key when adding subscriptions', async () => {
        // TODO implement
      });

      it('does not reinsert unchanged extension MUCs', async () => {
        // TODO implement
      });
    });

    it('combines makeMUC requests spaced less than 5 seconds apart', async () => {
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
      id.store(reduced_difficulty);  // note there's no "await"

      id.name = "Probator Minimae Distantiae Temporis";
      const thirdMuc: Cube = await id.store(reduced_difficulty);  // with await this time
      expect(thirdMuc).toEqual(id.muc);
      expect(thirdMuc.getHashIfAvailable()).toEqual(id.muc.getHashIfAvailable());
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

  describe('local persistant storage', () => {
    let persistance: IdentityPersistance;

    beforeEach(async () => {
      // Open the DB and make sure it's empty
      persistance = await IdentityPersistance.create("testidentity");
      await persistance.deleteAll();
      const ids: Array<Identity> = await persistance.retrieve(cubeStore);
      expect(ids).toBeDefined();
      expect(ids.length).toEqual(0);
    });

    afterEach(async () => {
      // Empty the DB and then close it
      await persistance.deleteAll();
      const ids: Array<Identity> = await persistance.retrieve(cubeStore);
      expect(ids).toBeDefined();
      expect(ids.length).toEqual(0);
      await persistance.close();
    });

    it('should store and retrieve an Identity locally', async () => {
      {  // expect DB to be empty at the beginning
        const ids: Array<Identity> = await persistance.retrieve(cubeStore);
        expect(ids.length).toEqual(0);
      }

      let idkey: CubeKey | undefined = undefined;
      {  // phase 1: create new identity and store it
        const id: Identity = new Identity(cubeStore, undefined, persistance, true, 1);  // reduced minimum MUC rebuild time for faster tests
        idkey = id.key;
        expect(id.name).toBeUndefined();
        id.name = "Probator Identitatum";
        const storePromise: Promise<Cube> = id.store(reduced_difficulty);
        expect(storePromise).toBeInstanceOf(Promise<Cube>);
        await storePromise;
      }
      { // phase 2: retrieve, compare and delete the identity
        const restoredIdsPromise: Promise<Identity[]> = persistance.retrieve(cubeStore);
        expect(restoredIdsPromise).toBeInstanceOf(Promise<Identity[]>);
        const restoredIds: Array<Identity> = await restoredIdsPromise;
        expect(restoredIds.length).toEqual(1);
        const restoredId: Identity = restoredIds[0];
        expect(restoredId.name).toEqual("Probator Identitatum");
        expect(restoredId.key).toEqual(idkey);
      }
    }, 10000);
  });  // local persistant storage tests

});
