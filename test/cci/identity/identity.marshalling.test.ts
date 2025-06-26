import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { asNotificationKey } from "../../../src/core/cube/keyUtil";
import { Cube } from "../../../src/core/cube/cube";
import { CubeStore } from "../../../src/core/cube/cubeStore";

import { FieldType, MediaTypes } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { cciCube, cciFamily } from "../../../src/cci/cube/cciCube";
import { IdentityOptions } from "../../../src/cci/identity/identity.definitions";
import { Identity } from "../../../src/cci/identity/identity";
import { cciFieldParsers, VerityFields } from "../../../src/cci/cube/verityFields";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";
import { Avatar, AvatarScheme } from "../../../src/cci/identity/avatar";

import { makePost } from "../../../src/app/zw/model/zwUtil";

import { idTestOptions, requiredDifficulty } from "../testcci.definitions";

import sodium from "libsodium-wrappers-sumo";
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const reducedDifficulty = 0;  // no hash cash for testing

// TODO: Some tests here use "ZW" stuff from the microblogging app
// which breaks the current layering.

describe("Identity: mashalling and demarshalling tests", () => {
// This test suite addresses storing and restoring Identities to/from Cubes,
// which is obviously the way Identities can travel through the Verity network.
let cubeStore: CubeStore;

  beforeEach(async () => {
    await sodium.ready;
    cubeStore = new CubeStore({
      inMemory: true,
      enableCubeCache: false,
      requiredDifficulty: 0, // require no hashcash for faster testing
      family: cciFamily,
    });
    await cubeStore.readyPromise;
  });

  describe('storing and restoring base properties', () => {
    it('should store and retrieve an Identity to and from a MUC object', async () => {
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA) as CubeKey;
      original.avatar = new Avatar(
        Buffer.from("0102030405", 'hex'), AvatarScheme.MULTIAVATAR);

      const post = await makePost("Habeo res importantes dicere",
        { id: original, requiredDifficulty });
      const postkey = await post.getKey();
      await cubeStore.addCube(post);
      expect(postkey).toBeInstanceOf(Buffer);
      expect(original.getPostCount()).toEqual(1);
      expect((await cubeStore.getCube(Array.from(original.getPostKeyStrings())[0]) as Cube).getFirstField(FieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");

      // compile ID into MUC
      const muc: cciCube = await original.marshall();
      expect(muc).toBeInstanceOf(cciCube);
      expect(muc.getKeyIfAvailable()).toEqual(original.key);

      // double check everything's in there
      expect(muc.fields.getFirstRelationship(RelationshipType.ILLUSTRATION).remoteKey).
        toEqual(original.profilepic);
      expect(muc.fields.getFirstRelationship(RelationshipType.MYPOST).remoteKey).
        toEqual(postkey);

      // Store the MUC
      const mucadded = await cubeStore.addCube(muc);
      expect(mucadded).toBe(muc);

      // Restore the Identity from the stored MUC
      const restoredmuc: cciCube = await cubeStore.getCube(original.key) as cciCube;
      expect(restoredmuc).toBeInstanceOf(cciCube);
      const restored: Identity = await Identity.Construct(cubeStore, restoredmuc);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.avatar.scheme).toEqual(AvatarScheme.MULTIAVATAR);
      expect(restored.avatar.seedString).toEqual("0102030405");
      expect(restored.getPostCount()).toEqual(1);
      expect((await cubeStore.getCube(Array.from(restored.getPostKeyStrings())[0]) as Cube).getFirstField(
        FieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");
      expect(restored.encryptionPublicKey.equals(original.encryptionPublicKey)).toBeTruthy();
    }, 5000);

    it('should store and retrieve an Identity to and from a binary MUC', async () => {
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);

      // populate ID
      original.name = "Probator Identitatum";
      original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA) as CubeKey;
      original.avatar = new Avatar("0102030405", AvatarScheme.MULTIAVATAR);
      await cubeStore.addCube(
        await makePost("Habeo res importantes dicere", {
          id: original,
          requiredDifficulty,
        }
      ));

      // compile ID into binary MUC
      const muc = await original.marshall();
      expect(muc).toBeInstanceOf(cciCube);
      const muckey = await muc.getKey();
      expect(muckey).toBeInstanceOf(Buffer);
      expect(muckey).toEqual(original.publicKey);
      const binarymuc = await muc.getBinaryData();
      expect(binarymuc).toBeInstanceOf(Buffer);
      const mucadded = await cubeStore.addCube(binarymuc);
      expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

      // restore Identity from stored MUC
      const restoredmuc: Cube = await cubeStore.getCube(await muc.getKey());
      expect(restoredmuc).toBeInstanceOf(Cube);
      const restored: Identity = await Identity.Construct(
        cubeStore, restoredmuc as cciCube);
      expect(restored).toBeInstanceOf(Identity);
      expect(restored.name).toEqual("Probator Identitatum");
      expect(restored.profilepic[0]).toEqual(0xDA);
      expect(restored.avatar.scheme).toEqual(AvatarScheme.MULTIAVATAR);
      expect(restored.avatar.seedString).toEqual("0102030405");
      expect(restored.getPostCount()).toEqual(1);
      expect((await cubeStore.getCube(Array.from(restored.getPostKeyStrings())[0]) as Cube).getFirstField(FieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");
    }, 5000);

    it("correctly handles subsequent changes", async () => {
      const id: Identity = await Identity.Create(
        cubeStore,
        "usor probationis",
        "clavis probationis",
        idTestOptions
      );
      id.name = "Probator Identitatum";
      const firstMuc: cciCube = await id.store();
      const firstMucHash: Buffer = firstMuc.getHashIfAvailable();
      expect(firstMuc).toBeInstanceOf(cciCube);
      expect(firstMucHash).toBeInstanceOf(Buffer);
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeUndefined();

      id.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xda) as CubeKey;
      const secondMuc: cciCube = await id.store();
      const secondMucHash: Buffer = secondMuc.getHashIfAvailable();
      expect(secondMuc).toBeInstanceOf(cciCube);
      expect(secondMucHash).toBeInstanceOf(Buffer);
      expect(secondMucHash.equals(firstMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum");
      expect(id.profilepic).toBeInstanceOf(Buffer);

      id.name = "Probator Identitatum Repetitus";
      const thirdMuc: cciCube = await id.store();
      const thirdMucHash: Buffer = thirdMuc.getHashIfAvailable();
      expect(thirdMuc).toBeInstanceOf(cciCube);
      expect(thirdMucHash).toBeInstanceOf(Buffer);
      expect(thirdMucHash.equals(firstMucHash)).toBeFalsy();
      expect(thirdMucHash.equals(secondMucHash)).toBeFalsy();
      expect(id.name).toEqual("Probator Identitatum Repetitus");
      expect(id.profilepic).toBeInstanceOf(Buffer);
    }, 5000);

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
        const muc: cciCube = await id.marshall();
        muc.setDate(i);
        await muc.getBinaryData();
        const key = await muc.getKey();
        // @ts-ignore testing private method
        expect(() => muc.validateCube()).not.toThrow();
        await cubeStore.addCube(muc);

        // reading it back
        const restoredMuc = await cubeStore.getCube(key) as cciCube;
        expect(restoredMuc).toBeInstanceOf(Cube);
        const restored: Identity = await Identity.Construct(cubeStore, restoredMuc, idTestOptions);
        expect(restored.name).toEqual("Probator condendi repetitionis " + i);
        expect(parseInt(restored.avatar.seedString, 16)).toEqual(i);
      }
    }, 10000);

    it('does not store a default avatar to MUC', async() => {
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      const muc = await id.store();
      expect(muc.getFirstField(FieldType.AVATAR)).toBeUndefined();
    });
  });


  describe('storing and restoring own posts', () => {
    it('restores its post list recursively', async () => {
      // test prep:
      const TESTPOSTCOUNT = 100;
      // 100 keys are guaranteed to require at least three Cubes.
      // We must test for at least three Cubes as the second Cube may
      // (and as of the writing of this comment still is!)
      // be treated differently than subsequent ones.
      const testPostKeys: string[] = [];

      // create a test Identity
      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      original.name = "Probator memoriae tabellae";
      const idkey = original.publicKey as CubeKey;

      // make some test posts
      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const post: cciCube = await makePost(
          "I got " + (i+1).toString() + " important things to say",
          {
            id: original,
            requiredDifficulty: reducedDifficulty,
          }
        );
        const key: CubeKey = post.getKeyIfAvailable();
        expect(key).toBeDefined();
        const keyString: string = post.getKeyStringIfAvailable();
        expect(keyString).toBeDefined();
        testPostKeys.push(keyString);
        await cubeStore.addCube(post);
      }
      // just a few sanity checks to verify the test setup
      expect(original.getPostCount()).toEqual(TESTPOSTCOUNT);
      expect(testPostKeys.length).toEqual(TESTPOSTCOUNT);

      // store the test Identity
      await original.store();
      const muc: cciCube = original.muc;
      await cubeStore.addCube(muc);

      // perform actual test:
      // restore the Identity from the stored MUC
      const restoredMuc: cciCube = await cubeStore.getCube(idkey);
      expect(restoredMuc).toBeInstanceOf(cciCube);
      const restored: Identity = await Identity.Construct(cubeStore, restoredMuc)
      expect(restored.getPostCount()).toEqual(TESTPOSTCOUNT);
      for (const expectedKey of testPostKeys) {
        expect(restored.hasPost(expectedKey)).toBeTruthy();
      }
    }, 5000);

    it('will not fail on circular post references', async() => {
      // Note that unlike regular posts, at least one of those has to be a MUC.
      // With regular posts, circular references are impossible as you'd need
      // to know both post's keys to create the reference, but creating the
      // reference will change the key.
      // We do however still want the Identity module to withstand such nonsense
      // and also to allow applications to use MUCs as posts, hence this test.
      const postKeyPair = sodium.crypto_sign_keypair();
      const postPubKey: Buffer = Buffer.from(postKeyPair.publicKey);
      const postPrivKey: Buffer = Buffer.from(postKeyPair.privateKey);
      // Prepare the first post which will later complete the circular reference
      const postA: cciCube = cciCube.MUC(postPubKey, postPrivKey, {
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.Application(("Test")),
          VerityField.MediaType(MediaTypes.TEXT),
          VerityField.Payload("Per mentionem ad aliam tabulam, circulum mentionis creo"),
          // post reference can only be added later as we don't know the key yet
        ]
      });
      const keyA: CubeKey = postA.getKeyIfAvailable();  // MUC keys are always available
      // Craft the second post
      const postB: cciCube = cciCube.Frozen({
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.Application(("Test")),
          VerityField.MediaType(MediaTypes.TEXT),
          VerityField.Payload("Hoc est ordinarius tabulae mentionem"),
          VerityField.RelatesTo(new Relationship(
            RelationshipType.MYPOST, keyA)),
        ]
      });
      const keyB: CubeKey = await postB.getKey();  // implicitly compiles postB
      await cubeStore.addCube(postB);
      // complete circular reference
      postA.insertFieldBeforeBackPositionals(
        VerityField.RelatesTo(new Relationship(
          RelationshipType.MYPOST, keyB)));
      await postA.compile();
      await cubeStore.addCube(postA);
      // Now craft an Identity MUC referring to postB
      const idKeyPair = sodium.crypto_sign_keypair();
      const idPubKey: Buffer = Buffer.from(idKeyPair.publicKey);
      const idPrivKey: Buffer = Buffer.from(idKeyPair.privateKey);
      const idMuc: cciCube = cciCube.MUC(idPubKey, idPrivKey, {
        requiredDifficulty: reducedDifficulty,
        fields: [
          VerityField.Application("ID"),
          VerityField.Username("Usor confusus"),
          VerityField.RelatesTo(new Relationship(
            RelationshipType.MYPOST, keyB)),
        ]
      });
      await idMuc.compile();
      await cubeStore.addCube(idMuc);
      // verify we have indeed created a circular reference
      expect(idMuc.fields.getFirstRelationship(
        RelationshipType.MYPOST).remoteKey).toEqual(keyB);
      expect(postB.fields.getFirstRelationship(
        RelationshipType.MYPOST).remoteKey).toEqual(keyA);
      expect(postA.fields.getFirstRelationship(
        RelationshipType.MYPOST).remoteKey).toEqual(keyB);
      // now try an Identity restore from this MUC
      const restored: Identity =
        await Identity.Construct(cubeStore, idMuc, idTestOptions);
      // restored Identity should correctly list two posts, A and B
      expect(restored.getPostCount()).toEqual(2);
      expect(restored.hasPost(keyA)).toBeTruthy();
      expect(restored.hasPost(keyB)).toBeTruthy();
    });

    // recursion depth limit not implemented yet
    it.todo('will not recurse deeper than the specified limit while restoring post list');
  });  // storing and restoring own posts

  describe('public subscriptons (aka subscription recommendations)', ()  => {
    it("correctly saves and restores recommended subscriptions to and from extension Cubes", async () => {
      // Create a subject and subscribe 40 other authors
      const TESTSUBCOUNT = 40;
      const subject: Identity = await Identity.Create(
        cubeStore,
        "subscriptor",
        "clavis mea",
        idTestOptions
      );
      const subs: Identity[] = [];
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
        other.store();
        subs.push(other);
        subject.addPublicSubscription(other.key);
        expect(
          subject.hasPublicSubscription(other.key)).toBeTruthy();
      }

      // Marshall Identity
      const masterCube: cciCube = await subject.store();
      // 40 subs should have required two index Cubes
      expect(subject.publicSubscriptionIndices.length).toEqual(2);

      // Master Cube stored in CubeStore?
      const recoveredMaster: cciCube = await cubeStore.getCube(subject.key) as cciCube;
      expect(recoveredMaster).toBeInstanceOf(cciCube);

      // First subscription recommendation index referenced from the Identitiy root?
      const rel: Relationship = recoveredMaster.getFirstRelationship(
        RelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX
      );
      expect(rel.remoteKey).toBeInstanceOf(Buffer);
      expect(
        rel.remoteKey.equals(
          subject.publicSubscriptionIndices[0].getKeyIfAvailable()
        )
      ).toBeTruthy();
      // First subscription recommendation index saved in CubeStore?
      const firstIndexCube: cciCube = await cubeStore.getCube(
        rel.remoteKey
      ) as cciCube;
      expect(firstIndexCube).toBeInstanceOf(cciCube);
      // First subscription recommendation index contains a subscription recommendation?
      expect(firstIndexCube.fields).toBeInstanceOf(VerityFields);
      expect(firstIndexCube.fields.length).toBeGreaterThan(1);
      const subStored: Relationship = firstIndexCube.getFirstRelationship(
        RelationshipType.SUBSCRIPTION_RECOMMENDATION);
      expect(subject.hasPublicSubscription(subStored.remoteKeyString)).toBeTruthy();

      // Second subscription recommendation index referred from first one?
      const secondIndexRel: Relationship =
        firstIndexCube.fields.getFirstRelationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX
        );
      expect(secondIndexRel).toBeInstanceOf(Relationship);
      const secondIndexCube: cciCube = await cubeStore.getCube(
        secondIndexRel.remoteKey
      ) as cciCube;
      expect(secondIndexCube).toBeInstanceOf(cciCube);

      // let's put it all together:
      // all subscription recommendations correctly restored?
      const restored: Identity = await Identity.Construct(cubeStore, masterCube);
      expect(restored.getPublicSubscriptionCount()).toEqual(TESTSUBCOUNT);
      for (let i = 0; i < TESTSUBCOUNT; i++) {
        expect(restored.hasPublicSubscription(subs[i].keyString)).toBeTruthy();
      }
      // subscription index extension Cubes still referenced?
      expect(restored.publicSubscriptionIndices.length).toEqual(2);
    }, 5000);

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
        other.store();
        subject.addPublicSubscription(other.key);
        expect(subject.hasPublicSubscription(other.key)).toBeTruthy();
      }
      subject.muc.setDate(0);  // hack, just for the test let's not wait 5s for the MUC update
      const muc: cciCube = await subject.store();

      // Good, 40 added. Now let's have a look at the extension MUCs.
      const firstExtensionMuc: cciCube = subject.publicSubscriptionIndices[0];
      const firstExtensionMucKey: CubeKey = firstExtensionMuc.getKeyIfAvailable();
      expect(firstExtensionMucKey).toBeInstanceOf(Buffer);
      const firstExtensionMucHash: Buffer = firstExtensionMuc.getHashIfAvailable();
      expect(firstExtensionMucHash).toBeInstanceOf(Buffer);

      const secondExtensionMuc: cciCube = subject.publicSubscriptionIndices[1];
      const secondExtensionMucKey: CubeKey = secondExtensionMuc.getKeyIfAvailable();
      expect(secondExtensionMucKey).toBeInstanceOf(Buffer);
      const secondExtensionMucHash: Buffer = secondExtensionMuc.getHashIfAvailable();
      expect(secondExtensionMucHash).toBeInstanceOf(Buffer);

      // Now add one more subscription
      const plusone: Identity = await Identity.Create(
        cubeStore, "adiectus", "secretum", idTestOptions);
      plusone.name = "Figurarius adiectus"
      plusone.muc.setDate(0);  // accelerate test
      plusone.store();
      subject.addPublicSubscription(plusone.key);
      subject.muc.setDate(0);  // accelarate test
      await subject.store();

      // Extension MUC keys should not have changed.
      // First extension MUC hash should not have changed either,
      // but the second one's must have.
      const firstExtensionMucAfterChange: cciCube = subject.publicSubscriptionIndices[0];
      const firstExtensionMucKeyAfterChange: CubeKey = firstExtensionMucAfterChange.getKeyIfAvailable();
      expect(firstExtensionMucKeyAfterChange).toBeInstanceOf(Buffer);
      const firstExtensionMucHashAfterChange: Buffer = firstExtensionMucAfterChange.getHashIfAvailable();
      expect(firstExtensionMucHashAfterChange).toBeInstanceOf(Buffer);
      expect(firstExtensionMucKeyAfterChange.equals(firstExtensionMucKey)).toBeTruthy();
      // expect(firstExtensionMucHashAfterChange.equals(firstExtensionMucHash)).toBeTruthy();  // TODO fix -- the first extension should not have been re-sculpted since it's subscription content has not changed and it's relationship to the changed second extension MUC has not changed either (as MUC keys don't change)

      const secondExtensionMucAfterChange: cciCube = subject.publicSubscriptionIndices[1];
      const secondExtensionMucKeyAfterChange: CubeKey = secondExtensionMucAfterChange.getKeyIfAvailable();
      expect(secondExtensionMucKeyAfterChange).toBeInstanceOf(Buffer);
      const secondExtensionMucHashAfterChange: Buffer = secondExtensionMucAfterChange.getHashIfAvailable();
      expect(secondExtensionMucHashAfterChange).toBeInstanceOf(Buffer);
      expect(secondExtensionMucKeyAfterChange.equals(secondExtensionMucKey)).toBeTruthy();
      expect(secondExtensionMucHashAfterChange.equals(secondExtensionMucHash)).toBeFalsy();
    });

    it.todo('will not fail on circular subscription recommendation index cubes');

  });  // public subscriptons

  describe('optional fields', () => {
    it('makes a Notification Cube if requested', async () => {
      const notificationKey = asNotificationKey("1337133713371337133713371337133713371337133713371337133713371337");
      const options: IdentityOptions = {
        ...idTestOptions,
        idmucNotificationKey: notificationKey,
      }
      const id: Identity = new Identity(
        cubeStore, Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42), options);
      const muc: cciCube = await id.marshall();
      expect(muc).toBeInstanceOf(cciCube);
      expect(muc.cubeType).toBe(CubeType.PMUC_NOTIFY);
      expect(muc.getFirstField(FieldType.NOTIFY).value.equals(notificationKey)).toBeTruthy();
    });

    it.todo('includes an APPLICATION field if requested');
  });
});
