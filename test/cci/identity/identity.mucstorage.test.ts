import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeKey } from "../../../src/core/cube/cube.definitions";
import { Cube } from "../../../src/core/cube/cube";
import { CubeStore } from "../../../src/core/cube/cubeStore";

import { cciFieldType, MediaTypes } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { cciCube, cciFamily } from "../../../src/cci/cube/cciCube";
import { Identity, IdentityOptions } from "../../../src/cci/identity/identity";
import { cciFieldParsers } from "../../../src/cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";
import { Avatar, AvatarScheme } from "../../../src/cci/identity/avatar";

import { makePost } from "../../../src/app/zw/model/zwUtil";

import { idTestOptions, requiredDifficulty } from "../testcci.definitions";

import sodium from "libsodium-wrappers-sumo";
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const reducedDifficulty = 0;  // no hash cash for testing

describe("Identity (MUC storage)", () => {
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore({
      inMemory: true,
      enableCubeCache: false,
      requiredDifficulty: 0, // require no hashcash for faster testing
      family: cciFamily,
    });
    await cubeStore.readyPromise;
  });

  describe("MUC storage", () => {
    describe('own posts restore', () => {
      it('restores its post list recursively', async () => {
        // test prep:
        const TESTPOSTCOUNT = 50;  // 50 keys are more than guaranteed not to fit in the MUC
        const testPostKeys: string[] = [];

        // create a test Identity
        const original: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        original.name = "Probator memoriae tabellae";
        const idkey = original.publicKey;

        // make some test posts
        for (let i=0; i<TESTPOSTCOUNT; i++) {
          const post: cciCube = await makePost("I got " + (i+1).toString() + " important things to say", undefined, original, reducedDifficulty);
          const key: CubeKey = post.getKeyIfAvailable();
          expect(key).toBeDefined();
          const keyString: string = post.getKeyStringIfAvailable();
          expect(keyString).toBeDefined();
          testPostKeys.push(keyString);
          await cubeStore.addCube(post);
        }
        // just a few sanity checks to verify the test setup
        expect(original.posts.length).toEqual(TESTPOSTCOUNT);
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
        expect(restored.posts.length).toEqual(TESTPOSTCOUNT);
        for (let i=0; i<restored.posts.length; i++) {
          const restoredPostKey: string = restored.posts[i].toString('hex');
          expect(restoredPostKey).toHaveLength(NetConstants.CUBE_KEY_SIZE*2);  // *2 due to string representation
          expect(testPostKeys).toContain(restoredPostKey);
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
            cciField.Application(("Test")),
            cciField.MediaType(MediaTypes.TEXT),
            cciField.Payload("Per mentionem ad aliam tabulam, circulum mentionis creo"),
            // post reference can only be added later as we don't know the key yet
          ]
        });
        const keyA: CubeKey = postA.getKeyIfAvailable();  // MUC keys are always available
        // Craft the second post
        const postB: cciCube = cciCube.Frozen({
          requiredDifficulty: reducedDifficulty,
          fields: [
            cciField.Application(("Test")),
            cciField.MediaType(MediaTypes.TEXT),
            cciField.Payload("Hoc est ordinarius tabulae mentionem"),
            cciField.RelatesTo(new cciRelationship(
              cciRelationshipType.MYPOST, keyA)),
          ]
        });
        const keyB: CubeKey = await postB.getKey();  // implicitly compiles postB
        await cubeStore.addCube(postB);
        // complete circular reference
        postA.insertFieldBeforeBackPositionals(
          cciField.RelatesTo(new cciRelationship(
            cciRelationshipType.MYPOST, keyB)));
        await postA.compile();
        await cubeStore.addCube(postA);
        // Now craft an Identity MUC referring to postB
        const idKeyPair = sodium.crypto_sign_keypair();
        const idPubKey: Buffer = Buffer.from(idKeyPair.publicKey);
        const idPrivKey: Buffer = Buffer.from(idKeyPair.privateKey);
        const idMuc: cciCube = cciCube.MUC(idPubKey, idPrivKey, {
          requiredDifficulty: reducedDifficulty,
          fields: [
            cciField.Application("ID"),
            cciField.Username("Usor confusus"),
            cciField.RelatesTo(new cciRelationship(
              cciRelationshipType.MYPOST, keyB)),
          ]
        });
        await idMuc.compile();
        await cubeStore.addCube(idMuc);
        // verify we have indeed created a circular reference
        expect(idMuc.fields.getFirstRelationship(
          cciRelationshipType.MYPOST).remoteKey).toEqual(keyB);
        expect(postB.fields.getFirstRelationship(
          cciRelationshipType.MYPOST).remoteKey).toEqual(keyA);
        expect(postA.fields.getFirstRelationship(
          cciRelationshipType.MYPOST).remoteKey).toEqual(keyB);
        // now try an Identity restore from this MUC
        const restored: Identity =
          await Identity.Construct(cubeStore, idMuc, idTestOptions);
        // restored Identity should correctly list two posts, A and B
        expect(restored.posts).toHaveLength(2);
        expect(restored.posts).toContainEqual(keyA);
        expect(restored.posts).toContainEqual(keyB);
      });

      // recursion depth limit not implemented yet
      it.todo('will not recurse deeper than the specified limit while restoring post list');
    });

    describe('TODO categorise these tests', () => {
      it('should create an Identity, then store and retrieve it to and from a MUC object', async() => {
        const original: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        original.name = "Probator Identitatum";
        const muc = await original.makeMUC();
        expect(muc).toBeInstanceOf(cciCube);
        const mucadded = await cubeStore.addCube(muc);
        expect(mucadded.getKeyIfAvailable()).toEqual(original.publicKey);

        const restoredmuc: cciCube = await cubeStore.getCube(await muc.getKey()) as cciCube;
        expect(restoredmuc).toBeInstanceOf(cciCube);
        const restored: Identity = await Identity.Construct(cubeStore, restoredmuc);
        expect(restored).toBeInstanceOf(Identity);
        expect(restored.name).toEqual("Probator Identitatum");
      }, 5000);

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
          undefined, original, requiredDifficulty);
        const postkey = await post.getKey();
        await cubeStore.addCube(post);
        expect(postkey).toBeInstanceOf(Buffer);
        expect(original.posts.length).toEqual(1);
        expect((await cubeStore.getCube(original.posts[0]) as Cube).getFirstField(cciFieldType.PAYLOAD).value.toString('utf-8')).
          toEqual("Habeo res importantes dicere");

        // compile ID into MUC
        const muc: cciCube = await original.makeMUC();
        expect(muc).toBeInstanceOf(cciCube);

        // double check everything's in there
        expect(muc.fields.getFirstRelationship(cciRelationshipType.ILLUSTRATION).remoteKey).
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
        expect((await cubeStore.getCube(restored.posts[0]) as Cube).getFirstField(
          cciFieldType.PAYLOAD).value.toString('utf-8')).
          toEqual("Habeo res importantes dicere");
      }, 5000);

      it('should store and retrieve an Identity to and from a binary MUC', async () => {
        const original: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);

        // populate ID
        original.name = "Probator Identitatum";
        original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
        original.avatar = new Avatar("0102030405", AvatarScheme.MULTIAVATAR);
        original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
        await cubeStore.addCube(await makePost("Habeo res importantes dicere", undefined, original, requiredDifficulty));

        // compile ID into binary MUC
        const muc = await original.makeMUC();
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
        expect((await cubeStore.getCube(restored.posts[0]) as Cube).getFirstField(cciFieldType.PAYLOAD).value.toString('utf-8')).
          toEqual("Habeo res importantes dicere");
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
      }, 10000);

      it('does not store a default avatar to MUC', async() => {
        const id: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        const muc = await id.store();
        expect(muc.getFirstField(cciFieldType.AVATAR)).toBeUndefined();
      });
    });
  });
});
