import { NetConstants } from '../../src/core/networking/networkDefinitions';
import { CubeKey } from '../../src/core/cube/cubeDefinitions';
import { CubeStore } from '../../src/core/cube/cubeStore';
import { Cube } from '../../src/core/cube/cube'

import { AvatarScheme, Identity, IdentityOptions, IdentityPersistance } from '../../src/cci/identity'
import { makePost } from '../../src/app/zwCubes';
import { cciFieldParsers, cciFieldType, cciFields, cciRelationship, cciRelationshipType } from '../../src/cci/cciFields';

import sodium from 'libsodium-wrappers-sumo'
import { cciCube } from '../../src/cci/cciCube';

// maybe TODO: Some tests here use "ZW" stuff from the microblogging app
// which breaks the current layering.

describe('Identity', () => {
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

  describe('MUC storage basics', () => {
    it('should create an Identity, then store and retrieve it to and from a MUC object', async() => {
      const original: Identity = Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      original.name = "Probator Identitatum";
      const muc = await original.makeMUC(undefined, reducedDifficulty);
      expect(muc).toBeInstanceOf(cciCube);
      const mucadded = await cubeStore.addCube(muc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      const restoredmuc: cciCube = cubeStore.getCube(await muc.getKey()) as cciCube;
      expect(restoredmuc).toBeInstanceOf(cciCube);
      const restored = new Identity(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
    }, 10000);

    it('should store and retrieve an Identity to and from a MUC object', async () => {
      const original: Identity = Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
      original.avatarSeed = {
        scheme: AvatarScheme.MULTIAVATAR,
        seed: Buffer.from("0102030405", 'hex'),
      }

      const post = await makePost("Habeo res importantes dicere",
        undefined, original, reducedDifficulty);
      const postkey = await post.getKey();
      await cubeStore.addCube(post);
      expect(postkey).toBeInstanceOf(Buffer);
      expect(original.posts.length).toEqual(1);
      expect((cubeStore.getCube(original.posts[0]) as Cube).fields.getFirst(cciFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");

      // compile ID into MUC
      const muc: cciCube = await original.makeMUC(undefined, reducedDifficulty);
      expect(muc).toBeInstanceOf(cciCube);

      // double check everything's in there
      expect(muc.fields.getFirstRelationship(cciRelationshipType.PROFILEPIC).remoteKey).
        toEqual(original.profilepic);
      expect(muc.fields.getFirstRelationship(cciRelationshipType.KEY_BACKUP_CUBE).remoteKey).
        toEqual(original.keyBackupCube);
      expect(muc.fields.getFirstRelationship(cciRelationshipType.MYPOST).remoteKey).
        toEqual(postkey);

      // Store the MUC
      const mucadded = await cubeStore.addCube(muc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      // Restore the Identity from the stored MUC
      const restoredmuc: cciCube = cubeStore.getCube(await muc.getKey()) as cciCube;
      expect(restoredmuc).toBeInstanceOf(cciCube);
      const restored = new Identity(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.avatarSeed.scheme).toEqual(AvatarScheme.MULTIAVATAR);
      expect(restored.avatarSeed.seed.toString('hex')).toEqual("0102030405");
      expect(restored.keyBackupCube[0]).toEqual(0x13);
      expect(restored.posts.length).toEqual(1);
      expect((cubeStore.getCube(restored.posts[0]) as Cube).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");
    }, 10000);

    it('should store and retrieve an Identity to and from a binary MUC', async () => {
      const original: Identity = Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      original.avatarSeed = {
        scheme: AvatarScheme.MULTIAVATAR,
        seed: Buffer.from("0102030405", 'hex'),
      }
      original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
      await cubeStore.addCube(await makePost("Habeo res importantes dicere", undefined, original, reducedDifficulty));

      // compile ID into binary MUC
      const muc = await original.makeMUC(undefined, reducedDifficulty);
      expect(muc).toBeInstanceOf(cciCube);
      const muckey = await muc.getKey();
      expect(muckey).toBeInstanceOf(Buffer);
      expect(muckey).toEqual(original.publicKey);
      const binarymuc = await muc.getBinaryData();
      expect(binarymuc).toBeInstanceOf(Buffer);
      const mucadded = await cubeStore.addCube(binarymuc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      // restore Identity from stored MUC
      const restoredmuc: Cube = cubeStore.getCube(await muc.getKey(), cciFieldParsers) as Cube;  // TODO deuglify
      expect(restoredmuc).toBeInstanceOf(Cube);
      const restored = new Identity(cubeStore, restoredmuc as cciCube);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.avatarSeed.scheme).toEqual(AvatarScheme.MULTIAVATAR);
      expect(restored.avatarSeed.seed.toString('hex')).toEqual("0102030405");
      expect(restored.keyBackupCube[0]).toEqual(0x13);
      expect(restored.posts.length).toEqual(1);
      expect((cubeStore.getCube(restored.posts[0]) as Cube).fields.getFirst(cciFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");
    }, 10000);

    it('correctly handles subsequent changes', async () => {
      const id: Identity = Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      id.name = "Probator Identitatum";
      const firstMuc: cciCube = await id.store(undefined, reducedDifficulty);
      const firstMucHash: Buffer = firstMuc.getHashIfAvailable();
      expect(firstMuc).toBeInstanceOf(cciCube);
      expect(firstMucHash).toBeInstanceOf(Buffer);
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeUndefined();
      expect(id.keyBackupCube).toBeUndefined();

      id.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      id.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
      const secondMuc: cciCube = await id.store(undefined, reducedDifficulty)
      const secondMucHash: Buffer = secondMuc.getHashIfAvailable();
      expect(secondMuc).toBeInstanceOf(cciCube);
      expect(secondMucHash).toBeInstanceOf(Buffer);
      expect(secondMucHash.equals(firstMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeInstanceOf(Buffer);
      expect(id.keyBackupCube).toBeInstanceOf(Buffer);

      id.name = "Probator Identitatum Repetitus";
      const thirdMuc: cciCube = await id.store(undefined, reducedDifficulty)
      const thirdMucHash: Buffer = thirdMuc.getHashIfAvailable();
      expect(thirdMuc).toBeInstanceOf(cciCube);
      expect(thirdMucHash).toBeInstanceOf(Buffer);
      expect(thirdMucHash.equals(firstMucHash)).toBeFalsy();
      expect(thirdMucHash.equals(secondMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum Repetitus");
      expect(id.profilepic).toBeInstanceOf(Buffer);
      expect(id.keyBackupCube).toBeInstanceOf(Buffer);
    }, 30000);

    it('restores its post list recursively and sorted by creation time descending', async () => {
      const TESTPOSTCOUNT = 100;  // 100 keys are more than guaranteed not to fit in the MUC
      const original: Identity = Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      original.name = "Probator memoriae tabellae";
      const idkey = original.publicKey;

      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const post: cciCube = await makePost("I got " + (i+1).toString() + " important things to say", undefined, original, reducedDifficulty);
        // manually save post to ID rather then through makePost because we will
        // manipulate the date below, and that changes the key
        original.forgetMyPost(await post.getKey());
        post.setDate(1694284300 + i);  // now you know when this test was written!
        original.rememberMyPost(await post.getKey());
        await cubeStore.addCube(post);
      }
      expect(original.posts.length).toEqual(TESTPOSTCOUNT);

      await original.store(undefined, reducedDifficulty)
      const muc: cciCube = original.muc;
      await cubeStore.addCube(muc);

      const restored = new Identity(cubeStore, cubeStore.getCube(idkey) as cciCube)
      expect(restored.posts.length).toEqual(TESTPOSTCOUNT);
      let newerPost: cciCube = cubeStore.getCube(restored.posts[0]) as cciCube;
      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const restoredPost: cciCube = cubeStore.getCube(restored.posts[i]) as cciCube;
        const postText: string = restoredPost.fields.getFirst(cciFieldType.PAYLOAD).value.toString('utf-8');
        expect(postText).toEqual("I got " + (TESTPOSTCOUNT-i).toString() + " important things to say");
        expect(restoredPost!.getDate()).toBeLessThanOrEqual(newerPost!.getDate());
        newerPost = restoredPost;
      }
    }, 10000);

    it('combines makeMUC requests spaced less than 5 seconds apart', async () => {
      const id: Identity = Identity.Create(
        cubeStore, "usor probationis", "clavis probationis",
        {minMucRebuildDelay: 5, requiredDifficulty: reducedDifficulty});
      // Creating a new Identity does build a MUC, although it will never be compiler
      // nor added to the CubeStore.
      // The five second minimum delay till regeneration still applies.
      const firstMuc = id.muc;
      const firstMucDate = firstMuc.getDate();

      id.name = "Probator Distantiae Temporis";
      // store() now requests generation of a new, second MUC.
      // This will not happen, though, as the first MUC is less than five seconds old.
      // Instead, the operation will be rescheduled five seconds from now.
      id.store(undefined, reducedDifficulty);  // note there's no "await"

      id.name = "Probator Minimae Distantiae Temporis";
      const thirdMuc: cciCube = await id.store(undefined, reducedDifficulty);  // with await this time
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

    it.only('still works even if I update my Identity really really often', async() => {
      const idTestOptions = {
        persistance: undefined,
        minMucRebuildDelay: 0,
        parsers: cciFieldParsers,
        requiredDifficulty: 1,
      }
      const id: Identity = Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      for (let i = 0; i < 100; i++) {
        // saving stuff
        id.name = "Probator condendi repetitionis " + i;
        id.avatarSeed =  {
          scheme: AvatarScheme.MULTIAVATAR,
          seed: Buffer.from("00000000" + i.toString(16).padStart(2, "0"), 'hex'),
        }
        const muc: cciCube = await id.makeMUC();
        muc.setDate(i);
        await muc.getBinaryData();
        const key = await muc.getKey();
        // @ts-ignore testing private method
        expect(() => muc.validateCube()).not.toThrow();
        await cubeStore.addCube(muc);

        // reading it back
        const restoredMuc = cubeStore.getCube(key, cciFieldParsers, cciCube) as cciCube;
        expect(restoredMuc).toBeInstanceOf(Cube);
        const restored: Identity = new Identity(cubeStore, restoredMuc, idTestOptions);
        expect(restored.name).toEqual("Probator condendi repetitionis " + i);
        const restoredSeed = restored.avatarSeed.seed.toString('hex');
        expect(parseInt(restoredSeed, 16)).toEqual(i);
      }
    }, 200000);
  });

  describe('subscription recommendations', ()  => {
    it('correctly identifies authors as subscribed or not subscribed', async () => {
      const subject: Identity = Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor novarum interessantiarum";

      // Create 10 subscribed and 10 non-subscribed authors
      const TESTSUBCOUNT = 10;
      const subscribed: CubeKey[] = [];
      const nonsubscribed: CubeKey[] = [];

      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = Identity.Create(
          cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        other.name = "Figurarius subscriptus numerus " + i;
        other.muc.setDate(0);  // skip waiting period for the test
        other.store(undefined, reducedDifficulty);
        subscribed.push(other.key);
        subject.addSubscriptionRecommendation(other.key);
        expect(subject.subscriptionRecommendations[i].equals(other.key)).toBeTruthy();
      }
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = Identity.Create(
          cubeStore, "non implicatus "+i, "secretum"+i, idTestOptions);
        other.name = "Persona non implicata " + i;
        other.muc.setDate(0);  // skip waiting period for the test
        other.store(undefined, reducedDifficulty);
        nonsubscribed.push(other.key);
      }

      // verify subscription status
      for (let i=0; i<TESTSUBCOUNT; i++) {
        expect(subject.isSubscribed(subscribed[i])).toBeTruthy();
        expect(subject.isSubscribed(nonsubscribed[i])).toBeFalsy();
      }
    });

    // TODO reduce this test's load, probably caused by lots of key derivations
    it('correctly saves and restores recommended subscriptions to and from extension MUCs', async () => {
      // Create a subject and subscribe 100 other authors
      const TESTSUBCOUNT = 100;
      const subject: Identity = Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor novarum interessantiarum";
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = Identity.Create(
          cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        other.name = "Figurarius " + i + "-tus";
        other.muc.setDate(0);  // skip waiting period for the test
        other.store(undefined, reducedDifficulty);
        subject.addSubscriptionRecommendation(other.key);
        expect(subject.subscriptionRecommendations[i].equals(other.key)).toBeTruthy();
      }
      subject.muc.setDate(0);  // hack, just for the test let's not wait 5s for the MUC update
      const muc: cciCube = await subject.store(undefined, reducedDifficulty);

      // Master MUC stored in CubeStore?
      const recovered_muc: cciCube = cubeStore.getCube(subject.key) as cciCube;
      expect(recovered_muc).toBeInstanceOf(cciCube);

      // First subscription recommendation index saved in MUC?
      const fields: cciFields = recovered_muc.fields as cciFields;
      expect(fields).toBeInstanceOf(cciFields);
      const rel: cciRelationship = fields.getFirstRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX);
      expect(rel.remoteKey).toBeInstanceOf(Buffer);
      expect(rel.remoteKey.equals(
        subject.subscriptionRecommendationIndices[0].getKeyIfAvailable())).
          toBeTruthy();
      // First subscription recommendation index saved in CubeStore?
      const firstIndexCube: cciCube = cubeStore.getCube(rel.remoteKey) as cciCube;
      expect(firstIndexCube).toBeInstanceOf(cciCube);
      // First subscription recommendation index contains for subscription recommendation?
      expect(firstIndexCube.fields).toBeInstanceOf(cciFields);
      expect(firstIndexCube.fields.count()).toBeGreaterThan(1);
      expect(firstIndexCube.fields.getFirstRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION).remoteKey.equals(
          subject.subscriptionRecommendations[0])).toBeTruthy();

      // Second subscription recommendation index referred from first one?
      const secondIndexRel: cciRelationship =
      firstIndexCube.fields.getFirstRelationship(
          cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX);
      expect(secondIndexRel).toBeInstanceOf(cciRelationship);
      const secondIndexCube: cciCube = cubeStore.getCube(secondIndexRel.remoteKey) as cciCube;
      expect(secondIndexCube).toBeInstanceOf(cciCube);

      // let's put it all together:
      // all subscription recommendations correctly restored?
      const restored: Identity = new Identity(cubeStore, muc);
      expect(restored.subscriptionRecommendations.length).toEqual(TESTSUBCOUNT);
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const othermuc = cubeStore.getCube(restored.subscriptionRecommendations[i]) as cciCube;
        expect(othermuc).toBeInstanceOf(cciCube);
        const restoredother: Identity = new Identity(cubeStore, othermuc);
        expect(restoredother.name).toEqual("Figurarius " + i + "-tus");
      }
    }, 30000);

    it('preserves extension MUC keys and does not update unchanged MUCs when adding subscriptions', async () => {
      // Create a subject. First subscribe 40 authors, then add one more.
      const TESTSUBCOUNT = 40;
      const subject: Identity = Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor consuentus novarum interessantiarum";
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = Identity.Create(
          cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        other.name = "Figurarius " + i + "-tus";
        other.muc.setDate(0);  // skip waiting period for the test
        other.store(undefined, reducedDifficulty);
        subject.addSubscriptionRecommendation(other.key);
        expect(subject.subscriptionRecommendations[i].equals(other.key)).toBeTruthy();
      }
      subject.muc.setDate(0);  // hack, just for the test let's not wait 5s for the MUC update
      const muc: cciCube = await subject.store(undefined, reducedDifficulty);

      // Good, 40 added. Now let's have a look at the extension MUCs.
      const firstExtensionMuc: cciCube = subject.subscriptionRecommendationIndices[0];
      const firstExtensionMucKey: CubeKey = firstExtensionMuc.getKeyIfAvailable();
      expect(firstExtensionMucKey).toBeInstanceOf(Buffer);
      const firstExtensionMucHash: Buffer = firstExtensionMuc.getHashIfAvailable();
      expect(firstExtensionMucHash).toBeInstanceOf(Buffer);

      const secondExtensionMuc: cciCube = subject.subscriptionRecommendationIndices[1];
      const secondExtensionMucKey: CubeKey = secondExtensionMuc.getKeyIfAvailable();
      expect(secondExtensionMucKey).toBeInstanceOf(Buffer);
      const secondExtensionMucHash: Buffer = secondExtensionMuc.getHashIfAvailable();
      expect(secondExtensionMucHash).toBeInstanceOf(Buffer);

      // Now add one more subscription
      const plusone: Identity = Identity.Create(
        cubeStore, "adiectus", "secretum", idTestOptions);
      plusone.name = "Figurarius adiectus"
      plusone.muc.setDate(0);  // accelerate test
      plusone.store(undefined, reducedDifficulty);
      subject.addSubscriptionRecommendation(plusone.key);
      subject.muc.setDate(0);  // accelarate test
      await subject.store();

      // Extension MUC keys should not have changed.
      // First extension MUC hash should not have changed either,
      // but the second one's must have.
      const firstExtensionMucAfterChange: cciCube = subject.subscriptionRecommendationIndices[0];
      const firstExtensionMucKeyAfterChange: CubeKey = firstExtensionMucAfterChange.getKeyIfAvailable();
      expect(firstExtensionMucKeyAfterChange).toBeInstanceOf(Buffer);
      const firstExtensionMucHashAfterChange: Buffer = firstExtensionMucAfterChange.getHashIfAvailable();
      expect(firstExtensionMucHashAfterChange).toBeInstanceOf(Buffer);
      expect(firstExtensionMucKeyAfterChange.equals(firstExtensionMucKey)).toBeTruthy();
      // expect(firstExtensionMucHashAfterChange.equals(firstExtensionMucHash)).toBeTruthy();  // TODO fix -- the first extension should not have been re-sculpted since it's subscription content has not changed and it's relationship to the changed second extension MUC has not changed either (as MUC keys don't change)

      const secondExtensionMucAfterChange: cciCube = subject.subscriptionRecommendationIndices[1];
      const secondExtensionMucKeyAfterChange: CubeKey = secondExtensionMucAfterChange.getKeyIfAvailable();
      expect(secondExtensionMucKeyAfterChange).toBeInstanceOf(Buffer);
      const secondExtensionMucHashAfterChange: Buffer = secondExtensionMucAfterChange.getHashIfAvailable();
      expect(secondExtensionMucHashAfterChange).toBeInstanceOf(Buffer);
      expect(secondExtensionMucKeyAfterChange.equals(secondExtensionMucKey)).toBeTruthy();
      expect(secondExtensionMucHashAfterChange.equals(secondExtensionMucHash)).toBeFalsy();
    });
  });

  describe('local persistant storage', () => {
    let persistance: IdentityPersistance;
    let idTestOptions: IdentityOptions;

    beforeEach(async () => {
      // Open the DB and make sure it's empty
      persistance = await IdentityPersistance.create("testidentity");
      await persistance.deleteAll();
      const ids: Array<Identity> = await persistance.retrieve(cubeStore);
      expect(ids).toBeDefined();
      expect(ids.length).toEqual(0);
      idTestOptions = {
        minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
        requiredDifficulty: reducedDifficulty,
        persistance: persistance,
      }
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
        const id: Identity = Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        idkey = id.key;
        expect(id.name).toBeUndefined();
        id.name = "Probator Identitatum";
        id.avatarSeed = {
          scheme: AvatarScheme.MULTIAVATAR,
          seed: Buffer.from("0102030405", 'hex'),
        }

        const storePromise: Promise<Cube> = id.store(undefined, reducedDifficulty);
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
        expect(restoredId.avatarSeed.scheme).toEqual(AvatarScheme.MULTIAVATAR);
        expect(restoredId.avatarSeed.seed.toString('hex')).toEqual("0102030405");
      }
    }, 10000000);
  });  // local persistant storage tests

  // TODO: add tests for auto-generated avatar stability
  // TODO: add tests for key derivation stability
});
