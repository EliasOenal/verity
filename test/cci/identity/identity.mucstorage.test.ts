import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { Identity, IdentityOptions } from "../../../src/cci/identity/identity";
import { cciCube, cciFamily } from "../../../src/cci/cube/cciCube";

import { makePost } from "../../../src/app/zw/model/zwUtil";
import { cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciFieldParsers } from "../../../src/cci/cube/cciFields";
import { cciRelationshipType } from "../../../src/cci/cube/cciRelationship";
import { Avatar, AvatarScheme } from "../../../src/cci/identity/avatar";
import { Cube } from "../../../src/core/cube/cube";

import sodium from "libsodium-wrappers-sumo";

describe("Identity (MUC storage)", () => {
  const reducedDifficulty = 0; // no hash cash for testing
  const idTestOptions: IdentityOptions = {
    minMucRebuildDelay: 1, // allow updating Identity MUCs every second
    requiredDifficulty: reducedDifficulty,
    argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
    argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
  };
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore({
      inMemoryLevelDB: true,
      requiredDifficulty: 0, // require no hashcash for faster testing
    });
  });

  describe("MUC storage", () => {
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
      expect((await cubeStore.getCube(restored.posts[0]) as Cube).fields.getFirst(cciFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Habeo res importantes dicere");
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
    }, 5000);

    it('does not store a default avatar to MUC', async() => {
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      const muc = await id.store();
      expect(muc.fields.getFirst(cciFieldType.AVATAR)).toBeUndefined();
    });
  });
});
