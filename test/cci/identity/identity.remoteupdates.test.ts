import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { cciCube } from '../../../src/cci/cube/cciCube';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';
import { Avatar, AvatarScheme } from '../../../src/cci/identity/avatar';
import { IdentityOptions } from '../../../src/cci/identity/identity.definitions';
import { Identity } from '../../../src/cci/identity/identity';

import { makePost } from '../../../src/app/zw/model/zwUtil';

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// TODO: Some tests here use "ZW" stuff from the microblogging app
// which breaks the current layering.

describe('Identity: remote updates', () => {
  const reducedDifficulty = 0;  // no hash cash for testing
  let idTestOptions: IdentityOptions;
  let cubeStore: CubeStore;

  beforeEach(async () => {
    await sodium.ready;
    idTestOptions = {  // note that those are diferent for some tests further down
      minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
      requiredDifficulty: reducedDifficulty,
      argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
      argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
    };
    cubeStore = new CubeStore(testCubeStoreParams);
    await cubeStore.readyPromise;
  });

  // TODO split into a multiple-test scenario
  it('will preserve posts written, users subscribed to as well as name and avatar changes performed on another device', async() => {
    // Create an Identity. Let's say the user used their notebook here.
    const notebookId: Identity = await Identity.Create(
      cubeStore, "usor probationis", "clavis probationis", idTestOptions);
    // make a post and set some user attributes
    notebookId.name = "Dominus plurium apparatorum";
    notebookId.avatar = new Avatar("1234567890", AvatarScheme.MULTIAVATAR);
    const postWrittenOnNotebook: cciCube = await makePost(
      "Hoc est scriptum in computatore domi meae",
      { id: notebookId, requiredDifficulty:reducedDifficulty });
    await cubeStore.addCube(postWrittenOnNotebook);
    const pmuc1: cciCube = await notebookId.store();
    // expect PMUC update count to have been auto-incremented
    expect(pmuc1.getFirstField(FieldType.PMUC_UPDATE_COUNT).value
      .readUintBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE))
      .toBe(1);
    // expect everything to be saved correctly
    expect(notebookId.name).toEqual("Dominus plurium apparatorum")
    expect(notebookId.avatar.seedString).toEqual("1234567890");
    expect(notebookId.getPostCount()).toBe(1);
    const savedPostKey: string = Array.from(notebookId.getPostKeyStrings())[0];
    expect(savedPostKey).toEqual(postWrittenOnNotebook.getKeyStringIfAvailable());
    expect((await cubeStore.getCube(savedPostKey)).getFirstField(
      FieldType.PAYLOAD).value.toString('utf8')).toEqual(
        "Hoc est scriptum in computatore domi meae");

    // Re-instantiate same identity.
    // Let's say this is the user logging back in on their phone.
    const phoneId: Identity = await Identity.Load(cubeStore, {
      ...idTestOptions,
      username: "usor probationis",
      password: "clavis probationis",
    });
    await phoneId.fullyParsed;
    // expect all data to have loaded correctly
    expect(phoneId.name).toEqual("Dominus plurium apparatorum")
    expect(phoneId.avatar.seedString).toEqual("1234567890");
    expect(phoneId.getPostCount()).toBe(1);
    expect(phoneId.hasPost(postWrittenOnNotebook.getKeyIfAvailable())).toBeTruthy();

    // perform changes on phone
    const postWrittenOnPhone: cciCube = await makePost(
      "Hoc scriptum est in telefono mobili meo",
      { id: phoneId, requiredDifficulty: reducedDifficulty });
    await cubeStore.addCube(postWrittenOnPhone);
    phoneId.name = "Dominus plurium apparatorum qui nunc iter agit";
    phoneId.avatar = new Avatar("cafebabe42", AvatarScheme.MULTIAVATAR);
    const pmuc2: cciCube = await phoneId.store();
    // expect PMUC update count to have been auto-incremented
    expect(pmuc2.getFirstField(FieldType.PMUC_UPDATE_COUNT).value
      .readUintBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE))
      .toBe(2);
    // expect all changes to be saved correctly
    expect(phoneId.name).toEqual("Dominus plurium apparatorum qui nunc iter agit")
    expect(phoneId.avatar.seedString).toEqual("cafebabe42");
    expect(phoneId.getPostCount()).toBe(2);
    expect(phoneId.hasPost(postWrittenOnPhone.getKeyIfAvailable())).toBeTruthy();

    await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

    // expect all changes to have synced to the the first "device"
    // (= original Identity instance)
    expect(notebookId.name).toEqual("Dominus plurium apparatorum qui nunc iter agit")
    expect(notebookId.avatar.seedString).toEqual("cafebabe42");
    expect(notebookId.getPostCount()).toBe(2);
    // notebook should still have their original post, as well as the one
    // written on the phone
    expect(notebookId.hasPost(postWrittenOnNotebook.getKeyIfAvailable())).toBeTruthy();
    expect(notebookId.hasPost(postWrittenOnPhone.getKeyIfAvailable())).toBeTruthy();
  });

  // this still fails as we currently don't actively attempt to merge
  // conflicting MUC versions
  it.skip('will merge posts on conflicting remote updates', async() => {
    const masterKey: Buffer = Buffer.from(
      sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES, 'uint8array'));

    // create Identity
    const leftId: Identity =
      await Identity.Construct(cubeStore, masterKey, idTestOptions);
    const commonPostKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(1);
    leftId.addPost(commonPostKey);
    const leftOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(2);
    leftId.addPost(leftOnlyKey);
    expect(leftId.getPostCount()).toEqual(2);
    expect(leftId.hasPost(commonPostKey)).toBeTruthy();
    expect(leftId.hasPost(leftOnlyKey)).toBeTruthy();
    const leftMuc: cciCube = await leftId.makeMUC();
    await cubeStore.addCube(leftMuc);

    // create conflicting Identity (this might e.g. happen on another device)
    const anotherCubeStore = new CubeStore(testCubeStoreParams);
    const rightId: Identity =
      await Identity.Construct(anotherCubeStore, masterKey, idTestOptions);
    rightId.addPost(commonPostKey);
    const rightOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(3);
    rightId.addPost(rightOnlyKey);
    expect(rightId.getPostCount()).toEqual(2);
    expect(rightId.hasPost(commonPostKey)).toBeTruthy();
    expect(rightId.hasPost(leftOnlyKey)).toBeFalsy();
    expect(rightId.hasPost(rightOnlyKey)).toBeTruthy();
    const rightMuc: cciCube = await rightId.makeMUC();

    // merge right to left by adding right's MUC to left's CubeStore
    await cubeStore.addCube(rightMuc);
    expect(leftId.getPostCount()).toEqual(3);
    expect(leftId.hasPost(commonPostKey)).toBeTruthy();
    expect(leftId.hasPost(leftOnlyKey)).toBeTruthy();
    expect(leftId.hasPost(rightOnlyKey)).toBeTruthy();
  });

  it('should not apply remote changes when explicitly not subscribed', async() => {
    const masterKey: Buffer = Buffer.from(
      sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES, 'uint8array'));
    idTestOptions.subscribeRemoteChanges = false;

    // create Identity
    const leftId: Identity =
      await Identity.Construct(cubeStore, masterKey, idTestOptions);
    const commonPostKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(1);
    leftId.addPost(commonPostKey);
    const leftOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(2);
    leftId.addPost(leftOnlyKey);
    expect(leftId.getPostCount()).toEqual(2);
    expect(leftId.hasPost(commonPostKey)).toBeTruthy();
    expect(leftId.hasPost(leftOnlyKey)).toBeTruthy();
    const leftMuc: cciCube = await leftId.makeMUC();
    await cubeStore.addCube(leftMuc);

    // create conflicting Identity (this might e.g. happen on another device)
    const anotherCubeStore = new CubeStore(testCubeStoreParams);
    const rightId: Identity =
      await Identity.Construct(anotherCubeStore, masterKey, idTestOptions);
    rightId.addPost(commonPostKey);
    const rightOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(3);
    rightId.addPost(rightOnlyKey);
    expect(rightId.getPostCount()).toEqual(2);
    expect(rightId.hasPost(commonPostKey)).toBeTruthy();
    expect(rightId.hasPost(leftOnlyKey)).toBeFalsy();
    expect(rightId.hasPost(rightOnlyKey)).toBeTruthy();
    const rightMuc: cciCube = await rightId.makeMUC();

    // merge right to left by adding right's MUC to left's CubeStore
    await cubeStore.addCube(rightMuc);
    expect(leftId.getPostCount()).toEqual(2);
    expect(leftId.hasPost(commonPostKey)).toBeTruthy();
    expect(leftId.hasPost(leftOnlyKey)).toBeTruthy();
    expect(leftId.hasPost(rightOnlyKey)).toBeFalsy();
  });
});

