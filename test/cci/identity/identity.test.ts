import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { CubeKey } from '../../../src/core/cube/cubeDefinitions';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { Cube } from '../../../src/core/cube/cube'

import { Identity, IdentityOptions } from '../../../src/cci/identity/identity'
import { makePost } from '../../../src/app/zwUtil';
import { cciFieldParsers, cciFields } from '../../../src/cci/cube/cciFields';

import { cciFieldType } from '../../../src/cci/cube/cciField';
import { cciRelationshipType, cciRelationship } from '../../../src/cci/cube/cciRelationship';
import { cciCube, cciFamily } from '../../../src/cci/cube/cciCube';
import { Avatar, AvatarScheme } from '../../../src/cci/identity/avatar';
import { IdentityPersistance } from '../../../src/cci/identity/identityPersistance';

import sodium from 'libsodium-wrappers-sumo'

// maybe TODO: Some tests here use "ZW" stuff from the microblogging app
// which breaks the current layering.

// TODO: add tests for fun stuff like cyclical post references
// (what makes them even funnier is that they currently should fail :D )

describe('Identity', () => {
  const reducedDifficulty = 0;  // no hash cash for testing
  const idTestOptions: IdentityOptions = {
    minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
    requiredDifficulty: reducedDifficulty,
    argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
    argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
  }
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore({
      enableCubePersistance: false,
      requiredDifficulty: 0,  // require no hashcash for faster testing
      enableCubeRetentionPolicy: false,  // TODO: we should make these tests pass with retention policy enabled
    });
  });

  describe('MUC storage basics', () => {
    it('should create an Identity, then store and retrieve it to and from a MUC object', async() => {
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      original.name = "Probator Identitatum";
      const muc = await original.makeMUC(undefined, reducedDifficulty);
      expect(muc).toBeInstanceOf(cciCube);
      const mucadded = await cubeStore.addCube(muc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      const restoredmuc: cciCube = await cubeStore.getCube(await muc.getKey()) as cciCube;
      expect(restoredmuc).toBeInstanceOf(cciCube);
      const restored: Identity = await Identity.Construct(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
    }, 10000);

    it('should store and retrieve an Identity to and from a MUC object', async () => {
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
      original.avatar = new Avatar(
        Buffer.from("0102030405", 'hex'), AvatarScheme.MULTIAVATAR);

      const post = await makePost("Habeo res importantes dicere",
        undefined, original, reducedDifficulty);
      const postkey = await post.getKey();
      await cubeStore.addCube(post);
      expect(postkey).toBeInstanceOf(Buffer);
      expect(original.posts.length).toEqual(1);
      expect((await cubeStore.getCube(original.posts[0]) as Cube).fields.getFirst(cciFieldType.PAYLOAD).value.toString('utf-8')).
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
      const restoredmuc: cciCube = await cubeStore.getCube(await muc.getKey()) as cciCube;
      expect(restoredmuc).toBeInstanceOf(cciCube);
      const restored: Identity = await Identity.Construct(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.avatar.scheme).toEqual(AvatarScheme.MULTIAVATAR);
      expect(restored.avatar.seedString).toEqual("0102030405");
      expect(restored.keyBackupCube[0]).toEqual(0x13);
      expect(restored.posts.length).toEqual(1);
      expect((await cubeStore.getCube(restored.posts[0]) as Cube).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");
    }, 10000);

    it('should store and retrieve an Identity to and from a binary MUC', async () => {
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
      original.avatar = new Avatar("0102030405", AvatarScheme.MULTIAVATAR);
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
      const restoredmuc: Cube = await cubeStore.getCube(await muc.getKey(), cciFamily);
      expect(restoredmuc).toBeInstanceOf(Cube);
      const restored: Identity = await Identity.Construct(
        cubeStore, restoredmuc as cciCube);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.avatar.scheme).toEqual(AvatarScheme.MULTIAVATAR);
      expect(restored.avatar.seedString).toEqual("0102030405");
      expect(restored.keyBackupCube[0]).toEqual(0x13);
      expect(restored.posts.length).toEqual(1);
      expect((await cubeStore.getCube(restored.posts[0]) as Cube).fields.getFirst(cciFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");
    }, 10000);

    it('restores its post list recursively and sorted by creation time descending', async () => {
      const TESTPOSTCOUNT = 100;  // 100 keys are more than guaranteed not to fit in the MUC
      const original: Identity = await Identity.Create(
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

      const restored: Identity = await Identity.Construct(cubeStore, await cubeStore.getCube(idkey) as cciCube)
      expect(restored.posts.length).toEqual(TESTPOSTCOUNT);
      let newerPost: cciCube = await cubeStore.getCube(restored.posts[0]) as cciCube;
      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const restoredPost: cciCube = await cubeStore.getCube(restored.posts[i]) as cciCube;
        const postText: string = restoredPost.fields.getFirst(cciFieldType.PAYLOAD).value.toString('utf-8');
        expect(postText).toEqual("I got " + (TESTPOSTCOUNT-i).toString() + " important things to say");
        expect(restoredPost!.getDate()).toBeLessThanOrEqual(newerPost!.getDate());
        newerPost = restoredPost;
      }
    }, 10000);

    it('still works even if I update my Identity really really often', async() => {
      const idTestOptions = {
        persistance: undefined,
        minMucRebuildDelay: 0,
        parsers: cciFieldParsers,
        requiredDifficulty: 1,
      }
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      for (let i = 0; i < 100; i++) {
        // saving stuff
        id.name = "Probator condendi repetitionis " + i;
        id.avatar = new Avatar(
          "00000000" + i.toString(16).padStart(2, "0"), AvatarScheme.MULTIAVATAR);
        const muc: cciCube = await id.makeMUC();
        muc.setDate(i);
        await muc.getBinaryData();
        const key = await muc.getKey();
        // @ts-ignore testing private method
        expect(() => muc.validateCube()).not.toThrow();
        await cubeStore.addCube(muc);

        // reading it back
        const restoredMuc = await cubeStore.getCube(key, cciFamily) as cciCube;
        expect(restoredMuc).toBeInstanceOf(Cube);
        const restored: Identity = await Identity.Construct(cubeStore, restoredMuc, idTestOptions);
        expect(restored.name).toEqual("Probator condendi repetitionis " + i);
        expect(parseInt(restored.avatar.seedString, 16)).toEqual(i);
      }
    }, 200000);

    it('does not store a default avatar to MUC', async() => {
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      const muc = await id.store();
      expect(muc.fields.getFirst(cciFieldType.AVATAR)).toBeUndefined();
    })
  });

  describe('subscription recommendations', ()  => {
    it('correctly identifies authors as subscribed or not subscribed', async () => {
      const subject: Identity = await Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor novarum interessantiarum";

      // Create 10 subscribed and 10 non-subscribed authors
      const TESTSUBCOUNT = 10;
      const subscribed: CubeKey[] = [];
      const nonsubscribed: CubeKey[] = [];

      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
          cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        other.name = "Figurarius subscriptus numerus " + i;
        other.muc.setDate(0);  // skip waiting period for the test
        other.store(undefined, reducedDifficulty);
        subscribed.push(other.key);
        subject.addSubscriptionRecommendation(other.key);
        expect(subject.subscriptionRecommendations[i].equals(other.key)).toBeTruthy();
      }
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
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

    it('preserves extension MUC keys and does not update unchanged MUCs when adding subscriptions', async () => {
      // Create a subject. First subscribe 40 authors, then add one more.
      const TESTSUBCOUNT = 40;
      const subject: Identity = await Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor consuentus novarum interessantiarum";
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
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
      const plusone: Identity = await Identity.Create(
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

    it("correctly saves and restores recommended subscriptions to and from extension MUCs", async () => {
      // Create a subject and subscribe 100 other authors
      const TESTSUBCOUNT = 100;
      const subject: Identity = await Identity.Create(
        cubeStore,
        "subscriptor",
        "clavis mea",
        idTestOptions
      );
      subject.name = "Subscriptor novarum interessantiarum";
      for (let i = 0; i < TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
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
      const recovered_muc: cciCube = await cubeStore.getCube(subject.key) as cciCube;
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
      const firstIndexCube: cciCube = await cubeStore.getCube(
        rel.remoteKey
      ) as cciCube;
      expect(firstIndexCube).toBeInstanceOf(cciCube);
      // First subscription recommendation index contains for subscription recommendation?
      expect(firstIndexCube.fields).toBeInstanceOf(cciFields);
      expect(firstIndexCube.fields.length).toBeGreaterThan(1);
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
      const secondIndexCube: cciCube = await cubeStore.getCube(
        secondIndexRel.remoteKey
      ) as cciCube;
      expect(secondIndexCube).toBeInstanceOf(cciCube);

      // let's put it all together:
      // all subscription recommendations correctly restored?
      const restored: Identity = await Identity.Construct(cubeStore, muc);
      expect(restored.subscriptionRecommendations.length).toEqual(TESTSUBCOUNT);
      for (let i = 0; i < TESTSUBCOUNT; i++) {
        const othermuc = await cubeStore.getCube(
          restored.subscriptionRecommendations[i]
        ) as cciCube;
        expect(othermuc).toBeInstanceOf(cciCube);
        const restoredother: Identity = await Identity.Construct(cubeStore, othermuc);
        expect(restoredother.name).toEqual("Figurarius " + i + "-tus");
      }
    }, 10000);
  });  // describe subscription recommendations

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
        const id: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        idkey = id.key;
        expect(id.name).toBeUndefined();
        id.name = "Probator Identitatum";
        id.avatar = new Avatar("0102030405", AvatarScheme.MULTIAVATAR);

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
        expect(restoredId.avatar.scheme).toEqual(AvatarScheme.MULTIAVATAR);
        expect(restoredId.avatar.seedString).toEqual("0102030405");
      }
    }, 10000000);
  });  // local persistant storage tests

  describe('static helpers', () => {
    describe('Create', () => {
      it('should create a valid Identity', async () => {
        const original: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        expect(original.masterKey).toBeInstanceOf(Buffer);
        expect(original.key).toBeInstanceOf(Buffer);
        expect(original.privateKey).toBeInstanceOf(Buffer);
        expect(original.avatar.render().length).toBeGreaterThan(20);  // SVG
      });

      // Note: This test asserts key derivation (and avatar) stability.
      // It is at full hardness in order to automatically detect
      // any inconsitencies occurring on prod settings.
      it('should be stable, i.e. always create the same Identity including the same avatar for the same user/pass combo at full hardness', async () => {
        const id: Identity = await Identity.Create(
          cubeStore, "Identitas stabilis", "Clavis stabilis", {
            persistance: undefined,
            requiredDifficulty: 0,  // this is just the hashcash level,
                                    // note argon settings have not been touched
        });
        // expected derivation results
        const expectedMasterkey = "d8eabeb1ab3592fc1dfcc9434e42db8d213c5312c2e9446dcb7915c11d9d65e3";
        const expectedPubkey = "cc5fe0e80bad6db35723f578aa57c074f9bc00866fa9d206686f25f542118ce2";
        const expectedPrivkey = "8fcc6cc84f67b8e753317c6f41d0637d6d45515463e01569e61994c3b6a28765cc5fe0e80bad6db35723f578aa57c074f9bc00866fa9d206686f25f542118ce2";
        const expectedAvatar = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMzEgMjMxIj48cGF0aCBkPSJNMzMuODMsMzMuODNhMTE1LjUsMTE1LjUsMCwxLDEsMCwxNjMuMzQsMTE1LjQ5LDExNS40OSwwLDAsMSwwLTE2My4zNFoiIHN0eWxlPSJmaWxsOiMwZGY7Ii8+PHBhdGggZD0ibTExNS41IDUxLjc1YTYzLjc1IDYzLjc1IDAgMCAwLTEwLjUgMTI2LjYzdjE0LjA5YTExNS41IDExNS41IDAgMCAwLTUzLjcyOSAxOS4wMjcgMTE1LjUgMTE1LjUgMCAwIDAgMTI4LjQ2IDAgMTE1LjUgMTE1LjUgMCAwIDAtNTMuNzI5LTE5LjAyOXYtMTQuMDg0YTYzLjc1IDYzLjc1IDAgMCAwIDUzLjI1LTYyLjg4MSA2My43NSA2My43NSAwIDAgMC02My42NS02My43NSA2My43NSA2My43NSAwIDAgMC0wLjA5OTYxIDB6IiBzdHlsZT0iZmlsbDojZmZjZThiOyIvPjxwYXRoIGQ9Im05MS45MiAxOTQuNDFhMTAxLjQ3IDEwMS40NyAwIDAgMSAyMy41OCAxNy4wOSAxMDEuNDcgMTAxLjQ3IDAgMCAxIDIzLjU4LTE3LjA5YzAuODkgMC4xOSAxLjc4IDAuMzggMi42NyAwLjU5YTExNC43OSAxMTQuNzkgMCAwIDEgMzggMTYuNSAxMTUuNTMgMTE1LjUzIDAgMCAxLTEyOC40NiAwIDExNC43OSAxMTQuNzkgMCAwIDEgMzgtMTYuNWMwLjg4LTAuMjEgMS43OC0wLjQgMi42Ny0wLjU5eiIgc3R5bGU9ImZpbGw6IzcwODkxMzsiLz48cGF0aCBkPSJtNzMuNjUgMTk5LjgyYzE2LjU5IDguMjMgMjguNzIgMTguOTEgMzQuMjcgMzAuOTNhMTE0Ljg2IDExNC44NiAwIDAgMS01Ni42NS0xOS4yNSAxMTUuMDYgMTE1LjA2IDAgMCAxIDIyLjM4LTExLjY4eiIgc3R5bGU9ImZpbGw6I2ZkZWExNDsiLz48cGF0aCBkPSJtNjAuNjMgMjA1Ljg1YzEyLjM1IDUuOTQgMjEuOTMgMTMuNDQgMjcuNTkgMjEuOTFhMTE0LjcgMTE0LjcgMCAwIDEtMzYuOTUtMTYuMjZxNC41My0zIDkuMzYtNS42NXoiIHN0eWxlPSJmaWxsOiM3MDg5MTM7Ii8+PHBhdGggZD0ibTE1Ny4zNSAxOTkuODJjLTE2LjYgOC4yMy0yOC43MiAxOC45MS0zNC4yNyAzMC45M2ExMTQuODYgMTE0Ljg2IDAgMCAwIDU2LjY1LTE5LjI1IDExNS4wNiAxMTUuMDYgMCAwIDAtMjIuMzgtMTEuNjh6IiBzdHlsZT0iZmlsbDojZmRlYTE0OyIvPjxwYXRoIGQ9Im0xNzAuMzcgMjA1Ljg1Yy0xMi4zNSA1Ljk0LTIxLjkzIDEzLjQ0LTI3LjU5IDIxLjkxYTExNC43IDExNC43IDAgMCAwIDM2Ljk1LTE2LjI2cS00LjUzLTMtOS4zNi01LjY1eiIgc3R5bGU9ImZpbGw6IzcwODkxMzsiLz48cGF0aCBkPSJtMTI0LjIyIDEzLjYxYy0xOS43ODMgMC0zNi45NDUgOC4wODg3LTM5LjY5NSAyNC4xMDYtMTUuMzMyIDAuMjM1MzktMzEuODMxIDIuNzcxMi00MS42NjMgMTUuNzgyLTYuMDIzOCA3Ljk2MDQtNy4wNDAyIDE5LjkwMS02Ljg0NzYgMzEuNzI0IDAuNDYwMDcgMjguNTAzIDEwLjc0MiA2NC4yMjgtNC4zMDEyIDg5LjcxNCAxNi41ODQgNS43Nzc3IDQzLjA4NiAxMC43NDIgNzMuNTkgMTEuNjYydi04LjY1NThjLTEuODUxLTAuMzUzMDgtMy42NTkyLTAuNzgxMDUtNS40MzUzLTEuMjczMi0zMC45NTMtOC40NjMyLTUwLjY3Mi0zNi42MzUtNDcuMjU5LTY4LjY2OSAxLjU1MTQtMTAuNjAzIDQuNjIyMS0xOS42NjUgMTAuMDI1LTI3LjY5IDUuMzgxOC03Ljk5MjUgMTMuMjY3LTE1LjcxNyAyMy44OTItMjEuNDEgMC40MDY1OCAwLjcyNzU3IDEuOTkwMSAzLjU4NDMgMi40MDc0IDQuMzAxMiA3LjUwMDMgMTIuNzc1IDE3Ljk4NiAyMy44NDkgMzMuMTU3IDI2Ljg2NiAxMi40MzMgMi40NjA5IDIzLjg0OSAzLjQ2NjYgMzYuMzQ2IDEuMTU1NSA0LjI1ODQtMC43ODEwNiAxMC42NjctMi4zOTY3IDE0Ljg1MS0yLjQxODEgMTQuODYxIDMzLjQwNC0xLjA4MDYgNzUuMDM1LTQwLjY2OCA4Ny40NTctMi4yMjU1IDAuNzA2MTYtNC41MjU4IDEuMzE2LTYuODkwNCAxLjgxODkgMCAyLjcwNy0wLjA0MjggNS42NDkzLTAuMDY0MiA4LjUyNzQgMjMuNjAzLTAuNzI3NTcgNDguNjgyLTQuMDQ0NCA3Mi44NzQtMTEuMjM0LTE4LjUyMS0zMi4xNTIgMC44MTMxNS04OS4wODMtMTAuMDM2LTEyMS40Ni05LjA3MzEtMjYuOTczLTM4Ljg1LTQwLjMxNS02NC4yODItNDAuMzA1eiIgc3R5bGU9ImZpbGw6IzAwMDsiLz48cGF0aCBkPSJtMzMuMTQ3IDE3Mi4zMmMtMi42NTM1IDUuMTE0My02LjA4OCA5Ljk1MDQtMTAuMSAxMi40MTEgNy44NDI3IDEwLjQ1MyAxNy4zODcgMTkuNTE2IDI4LjI1NyAyNi43ODEgMTYuMDM4LTEwLjczMSAzNS42MjktMTcuMDU1IDU0LTE4LjYwNnYtOS4wMDg5Yy0zMC4wNjUtMC45NDE1NS01Ni4xMDgtNS44ODQ3LTcyLjE1Ny0xMS41Nzd6bTE2NC4wNiAwLjU1NjM3Yy0yMy43MzEgNy4wNzIzLTQ4LjM2MSAxMC4zMjUtNzEuNTI1IDExLjA0Mi0wLjAzMjEgMy4xMjQyLTAuMDUzNSA2LjIzNzctMC4wMTA3IDkuMDUxNyAxOS4yMjcgMS43MjI2IDM3LjkwOCA3Ljg1MzQgNTMuOTg5IDE4LjU0MiAwLjAxMDcgMCAwLjAxMDcgMCAwLjAyMTQgMC4wMTA3IDEwLjczMS03LjE2ODYgMjAuMTc5LTE2LjA4MSAyNy45NTgtMjYuMzc0LTQuMjc5OC0yLjM5NjctNy44MzItNi45NjUzLTEwLjQzMi0xMi4yNzJ6IiBzdHlsZT0iZmlsbDpub25lOyIvPjxwYXRoIGQ9Im01MC4wMiA0Ni41Yy0yLjkyOTcgMS45MTQzLTYuMTMxMyAzLjg4MjYtMTAuMTU0IDcuOTgwNS0xNC4wOTEgMTQuMzU5LTE2LjE0NSAyNy43MDEtNi4xNDA2IDQ0LjAxOCA0LjIwNDkgNi44NTgzIDYuMTQxNCAxMy43MDYtMC4yNDYwOSAyMC41LTcuNzE0MyA4LjE5NTctMjEuNTU5IDQuMjkxMi0yMS41MzcgMTYuMDYxIDAuMDIxNCA4LjYxMyAxNS4wNjMgNy45MTc4IDIyLjUzMSAxMy45ODQgMy43NjYyIDMuMDcwNyA1LjA4MzYgOC4zOTkyIDIuMDY2NCAxMi41MDgtNC4yMTU2IDUuNzQ1Ni0xNi4wMDYgNy4zNzE1LTIyLjYyOSA4LjkzMzYgNS44ODExIDEwLjg0MyAxMy40NSAyMC42MzggMjIuMzU1IDI5LjAzM2wwLjAwMzkgMC4wMjM0IDAuMDA1OS0wLjAxMzdjMmUtMyAyZS0zIDAuMDAzOCA0ZS0zIDAuMDA1OSA2ZS0zIDAuMDAzNC0wLjAxMTIgMC4wMDYzLTAuMDIxOSAwLjAwOTgtMC4wMzMyIDE0Ljc3NS0xMi4yMTggMjAuMjY4LTIwLjk2NSA0OS40NjEtMjguNDM0LTE3LjQwNC0xMC4yNTgtMzAuNjgtMjcuMTIyLTI0LjE0My0zNS4zNCA0LjQxMjMtNS41NDQ0IDUuNjYxMi03Ljg2MzMgNi40MDYyLTEyLjA3OCAyLjM1ODItMTMuMzM5LTEwLjIwOC0yMi4zMzUtOS4yMzYzLTMyLjcxNSAxLjk0MzItOC4yMzQ2IDExLjM3OS0xMS4xNzMgMTYuOTQ3LTE1LjExNSA1LjQ1NzctMy45MDgyIDkuODAxNC04Ljc2OTUgMTAuNzk5LTE2LjkxOC0xMy41NTgtNC44ODk2LTE3LjYwOS01Ljg2MTctMzYuNTA2LTEyLjR6bTE0MC44NyAxOS4zNTdjLTMuNDQwNC0wLjkxMjQzLTIzLjMxMSAxMjIuNDMgNC40MTIxIDEzMy4xNCA4Ljk2NjEtOC41ODA5IDE2LjU1Mi0xOC41ODQgMjIuNDA0LTI5LjY1OCAwLTAuMzEwMjktMjUuMTMzLTMuOTkyMi0yNS45NzktMTQuMDE4LTAuMTA2OTktMS4xNzY5IDAuMTE4MjItMS40ODU1IDAuODY3MTgtMi41MDIgNi42NzY0LTkuMjEyMiAzMC43MTYtMTEuNDE2IDI5LjY0Ni0yMy40OTYtMC4yNzgxOC0zLjE1NjMtNC4xNjE3LTUuMjMzNC02Ljc0MDItNi40NTMxLTEyLjE1NS01Ljc2Ny0zMi45NDItOS42NDk0LTE1LjAzMS0yNC41NDMgOS4yMTIyLTcuMzUwNSAxMC40My04LjQzMjMgMC41OTc2Ni0xNC42OTEtOS40NTgzLTYuMDIzOC05LjM5NC0xMS45OTMtOS43NTc4LTE2LjMyNi0wLjA3NjctMC45MzAzNS0wLjIyMDg5LTEuNDAwMy0wLjQxOTkyLTEuNDUzMXoiIHN0eWxlPSJmaWxsOm5vbmU7Ii8+PHBhdGggZD0ibTEzMy44MyAzOS45MDljLTExLjMzIDEuMzkzLTkuNTQ5MiAxNi4yMDQtMmUtMyAxNi42NDMtNC41MTAyIDEwLjcxNyA5LjAxNjUgMTYuMTgxIDE0LjQ0MSA4LjMxMjUgNi41NjIgOC42NzY1IDE4LjU5NiAwLjk0NzUxIDE0LjQ1Ny04LjMxMjUgMTEuNzE4LTEuNTM4MSA5LjI3NjktMTYuMDk5IDAtMTYuNjQzIDQuNTAzLTEwLjg2Ny05LjQ4ODMtMTYuMTAxLTE0LjQ1Ny04LjMzMDEtNi44ODMyLTkuMDQxMS0xOC41MDktMC40NzMyMS0xNC40MzkgOC4zMzAxeiIgc3R5bGU9ImZpbGw6I0ZGQ0MwMDsiLz48cGF0aCBkPSJtMTUzLjg2IDQ4LjIyMmMwLTMuMDUyOC0yLjUxODQtNS41NjQ4LTUuNTc5MS01LjU2NDgtMy4wNzgzIDAtNS41NzkzIDIuNTEyLTUuNTc5MyA1LjU2NDggMCAzLjA3MDMgMi41MDEgNS41NjQ4IDUuNTc5MyA1LjU2NDggMy4wNjA2IDAgNS41NzkxLTIuNDk0NiA1LjU3OTEtNS41NjQ4eiIgc3R5bGU9ImZpbGw6cmVkOyIvPjxwYXRoIGQ9Im03OC43MyAxMTFhMTAuOSAxMC45IDAgMCAxIDE1LjE5IDBtNDMuMTYgMGExMC45IDEwLjkgMCAwIDEgMTUuMTkgMCIgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLXdpZHRoOjYuMTk5OXB4O3N0cm9rZTojMDAwOyIvPjxwYXRoIGQ9Im03OS44MDQgMTIzLjc0aDcuMDdtNTcuMjczIDBoNy4wNSIgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLXdpZHRoOjUuOTk5OHB4O3N0cm9rZTojMDA3MmZmOyIvPjxwYXRoIGQ9Im0xMjIuODMgMTUxLjg4YTEwLjQ5IDEwLjQ4OSAwIDAgMS0xNC42NiAwIiBzdHlsZT0iZmlsbDpub25lO3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2Utd2lkdGg6Ni4xOTk2cHg7c3Ryb2tlOiMwMDA7Ii8+PC9zdmc+";
        // logger.trace("Masterkey: " + id.masterKey.toString('hex'));
        // logger.trace("Pubkey: " + id.muc.publicKey.toString('hex'));
        // logger.trace("Privkey: " + id.muc.privateKey.toString('hex'));
        // logger.trace("Avatar: " + id.avatar.render());
        expect(id.masterKey.toString('hex')).toEqual(expectedMasterkey);
        expect(id.muc.publicKey.toString('hex')).toEqual(expectedPubkey);
        expect(id.muc.privateKey.toString('hex')).toEqual(expectedPrivkey);
        expect(id.avatar.render()).toEqual(expectedAvatar);
      });
    });

    describe("Load", () => {
      it("returns undefined when MUC is unavailable", () => {
        const doesNotExist = Identity.Load(cubeStore, "Usor absens",
          "quis curat de clavis usoris non existentis?");
        expect(doesNotExist).toBeUndefined;
      });

      it('correctly restores an existing Identity', async () => {
        // create an Identity
        const original: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        // make lots of custom changes
        original.name = "Sum usor frequens, semper redeo"
        original.avatar.random();

        // make a post
        expect(original.posts.length).toEqual(0);
        const post = await makePost("Habeo res importantes dicere",
          undefined, original, reducedDifficulty);
        await cubeStore.addCube(post);
        expect(original.posts.length).toEqual(1);

        // remember individual values and customizations
        const masterkey = original.masterKey.toString('hex');
        const pubkey = original.muc.publicKey.toString('hex');
        const privkey = original.muc.privateKey.toString('hex');
        const chosenAvatar: string = original.avatar.seedString;
        const myPostKey: string = original.posts[0];

        // store Identity
        await original.store();

        // restore Identity
        const restored: Identity = await Identity.Load(cubeStore,
          "usor probationis", "clavis probationis", idTestOptions);

        // assert all values custom changes still present
        expect(restored.name).toEqual("Sum usor frequens, semper redeo");
        expect(restored.masterKey.toString('hex')).toEqual(masterkey);
        expect(restored.muc.publicKey.toString('hex')).toEqual(pubkey);
        expect(restored.muc.privateKey.toString('hex')).toEqual(privkey);
        expect(restored.avatar.seedString).toEqual(chosenAvatar);
        expect(restored.posts.length).toEqual(1);
        expect(restored.posts[0]).toEqual(myPostKey);
      })
    })
  })
});
