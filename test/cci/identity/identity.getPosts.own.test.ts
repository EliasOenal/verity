import { IdentityOptions, Identity, PostFormat } from '../../../src/cci/identity/identity';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { evenLonger, testCubeStoreParams } from '../testcci.definitions';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { CubeKey, CubeType } from '../../../src/core/cube/cube.definitions';
import { VerityField } from '../../../src/cci/cube/verityField';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { Veritum } from '../../../src/cci/veritum/veritum';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { VeritumRetriever } from '../../../src/cci/veritum/veritumRetriever';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';
import { Veritable } from '../../../src/core/cube/veritable.definition';

describe('Identity: getPosts generator; own posts only (no recursion)', () => {
  // This test suite handles Identity's impelementation of the CubeEmitter interface,
  // in particular the getAllCubeInfos() generator and related, more specialised
  // and Identity-specific CubeInfo generators.

  let idTestOptions: IdentityOptions;
  let cubeStore: CubeStore;
  let masterKey: Buffer;
  let id: Identity;

  let singleFrozen: cciCube;
  let singleFrozenNotify: cciCube;
  let singlePic: cciCube;
  let singlePicNotify: cciCube;
  let singleMuc: cciCube;
  let singleMucNotify: cciCube;
  let singlePmuc: cciCube;
  let singlePmucNotify: cciCube;
  let multiFrozen: Veritum;
  let multiPic: Veritum;
  let singleFrozenEncrypted: Veritum;

  beforeAll(async () => {
    await sodium.ready;
    idTestOptions = {  // note that those are diferent for some tests further down
      minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
      requiredDifficulty: 0,  // no hash cash for testing
      argonCpuHardness: sodium.crypto_pwhash_OPSLIMIT_MIN,  // minimum hardness
      argonMemoryHardness: sodium.crypto_pwhash_MEMLIMIT_MIN,  // minimum hardness
    };

    // prepare components
    cubeStore = new CubeStore(testCubeStoreParams);
    await cubeStore.readyPromise;
    const veritumRetriever = new VeritumRetriever(cubeStore);

    // prepare an Identity
    masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
    id = await Identity.Construct(veritumRetriever, masterKey, idTestOptions);
    id.name = "protagonista qui illas probationes pro nobis administrabit"

    // Add some posts:
    // - a frozen single Cube post
    singleFrozen = cciCube.Create({
      cubeType: CubeType.FROZEN,
      fields: VerityField.Payload("Commentarius ex uno cubo factus"),
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(singleFrozen);
    id.addPost(await singleFrozen.getKey());

    // - a frozen single Cube post with notification
    const notificationKey1: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x41);
    singleFrozenNotify = cciCube.Create({
      cubeType: CubeType.FROZEN_NOTIFY,
      fields: [
        VerityField.Payload("Commentarius ex uno cubo factus cum nuntio"),
        VerityField.Notify(notificationKey1),
      ],
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(singleFrozenNotify);
    id.addPost(await singleFrozenNotify.getKey());

    // - a PIC single Cube post
    singlePic = cciCube.Create({
      cubeType: CubeType.PIC,
      fields: VerityField.Payload("Commentarius ex cubo immutabili perpetuo factus"),
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(singlePic);
    id.addPost(await singlePic.getKey());

    // - a PIC single Cube post with notification
    const notificationKey2: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
    singlePicNotify = cciCube.Create({
      cubeType: CubeType.PIC_NOTIFY,
      fields: [
        VerityField.Payload("Commentarius ex cubo immutabili perpetuo factus cum nuntio"),
        VerityField.Notify(notificationKey2),
      ],
      requiredDifficulty: 0,
    });
    await cubeStore.addCube(singlePicNotify);
    id.addPost(await singlePicNotify.getKey());

    const singleMucKeys = sodium.crypto_sign_keypair();
    // - a MUC single Cube post
    singleMuc = cciCube.Create({
      cubeType: CubeType.MUC,
      fields: VerityField.Payload("Commentarius ex cubo usoris mutabili factus"),
      requiredDifficulty: 0,
      privateKey: Buffer.from(singleMucKeys.privateKey),
      publicKey: Buffer.from(singleMucKeys.publicKey),
    });
    await cubeStore.addCube(singleMuc);
    id.addPost(await singleMuc.getKey());

    // - a MUC single Cube post with notification
    const notificationKey3: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x43);
    const singleMucNotifyKeys = sodium.crypto_sign_keypair();
    singleMucNotify = cciCube.Create({
      cubeType: CubeType.MUC_NOTIFY,
      fields: [
        VerityField.Payload("Commentarius ex cubo usoris mutabili factus cum nuntio"),
        VerityField.Notify(notificationKey3),
      ],
      requiredDifficulty: 0,
      privateKey: Buffer.from(singleMucNotifyKeys.privateKey),
      publicKey: Buffer.from(singleMucNotifyKeys.publicKey),
    });
    await cubeStore.addCube(singleMucNotify);
    id.addPost(await singleMucNotify.getKey());

    // - a PMUC single Cube post
    const singlePmucKeys = sodium.crypto_sign_keypair();
    singlePmuc = cciCube.Create({
      cubeType: CubeType.PMUC,
      fields: [
        VerityField.Payload("Commentarius ex cubo usoris mutabili perpetuo factus"),
        VerityField.PmucUpdateCount(1337),
      ],
      requiredDifficulty: 0,
      privateKey: Buffer.from(singlePmucKeys.privateKey),
      publicKey: Buffer.from(singlePmucKeys.publicKey),
    });
    await cubeStore.addCube(singlePmuc);
    id.addPost(await singlePmuc.getKey());

    // - a PMUC single Cube post with notification
    const notificationKey4: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x44);
    const singlePmucNotifyKeys = sodium.crypto_sign_keypair();
    singlePmucNotify = cciCube.Create({
      cubeType: CubeType.PMUC_NOTIFY,
      fields: [
        VerityField.Payload("Commentarius ex cubo usoris mutabili perpetuo factus cum nuntio"),
        VerityField.Notify(notificationKey4),
      ],
      requiredDifficulty: 0,
      privateKey: Buffer.from(singlePmucNotifyKeys.privateKey),
      publicKey: Buffer.from(singlePmucNotifyKeys.publicKey),
    });
    await cubeStore.addCube(singlePmucNotify);
    id.addPost(await singlePmucNotify.getKey());

    // - a multi Cube frozen veritum
    multiFrozen = Veritum.Create({
      cubeType: CubeType.FROZEN,
      fields: VerityField.Payload(evenLonger),
      requiredDifficulty: 0,
    });
    await multiFrozen.compile();
    for (const chunk of multiFrozen.chunks) await cubeStore.addCube(chunk);
    id.addPost(await multiFrozen.getKey());

    // - a multi Cube frozen PIC
    multiPic = Veritum.Create({
      cubeType: CubeType.PIC,
      fields: VerityField.Payload(evenLonger),
      requiredDifficulty: 0,
    });
    await multiPic.compile();
    for (const chunk of multiPic.chunks) await cubeStore.addCube(chunk);
    id.addPost(await multiPic.getKey());

    // - multi cube MUCs/PMUCs and notification Verita would have been nice,
    //   but they're still buggy :(

    // encryption test posts:
    // - a single Cube frozen Veritum, encrypted to self
    singleFrozenEncrypted = Veritum.Create({
      cubeType: CubeType.FROZEN,
      fields: VerityField.Payload("Hoc veritum mihi privatum ac cryptatum est."),
      requiredDifficulty: 0,
    });
    await singleFrozenEncrypted.compile({
      recipients: id,
    });
    for (const chunk of singleFrozenEncrypted.chunks) await cubeStore.addCube(chunk);
    id.addPost(await singleFrozenEncrypted.getKey());

    await id.store();
  });

  afterAll(async () => {
    await cubeStore.shutdown();
    await id.identityStore.shutdown();
  });

  describe('verify test setup', () => {
    it('has all post keys registered with the Identity', () => {
      expect(id.getPostKeyStrings()).toContain(singleFrozen.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singleFrozenNotify.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singlePic.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singlePicNotify.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singleMuc.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singleMucNotify.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singlePmuc.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singlePmucNotify.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(multiFrozen.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(multiPic.getKeyStringIfAvailable());
      expect(id.getPostKeyStrings()).toContain(singleFrozenEncrypted.getKeyStringIfAvailable());
    });

    it('has all post keys present in CubeStore', async () => {
      expect(await cubeStore.hasCube(singleFrozen.getKeyStringIfAvailable())).toBeTruthy();
      expect(await cubeStore.hasCube(singleFrozenNotify.getKeyStringIfAvailable())).toBeTruthy();
      expect(await cubeStore.hasCube(singlePic.getKeyStringIfAvailable())).toBeTruthy();
      expect(await cubeStore.hasCube(singlePicNotify.getKeyStringIfAvailable())).toBeTruthy();
      expect(await cubeStore.hasCube(singleMuc.getKeyStringIfAvailable())).toBeTruthy();
      expect(await cubeStore.hasCube(singleMucNotify.getKeyStringIfAvailable())).toBeTruthy();
      expect(await cubeStore.hasCube(singlePmuc.getKeyStringIfAvailable())).toBeTruthy();
      expect(await cubeStore.hasCube(singlePmucNotify.getKeyStringIfAvailable())).toBeTruthy();
      for (const chunk of multiFrozen.chunks) expect(
        await cubeStore.hasCube(chunk.getKeyStringIfAvailable())).toBeTruthy();
      for (const chunk of multiPic.chunks) expect(
        await cubeStore.hasCube(chunk.getKeyStringIfAvailable())).toBeTruthy();
      for (const chunk of singleFrozenEncrypted.chunks) expect(
        await cubeStore.hasCube(chunk.getKeyStringIfAvailable())).toBeTruthy();
    });

    it('has actually encrypted the encrypted post', async () => {
      const singleEncryptedRestored: cciCube =
        await cubeStore.getCube(singleFrozenEncrypted.getKeyStringIfAvailable());
      expect(singleEncryptedRestored).toBeDefined();
      const payload = singleEncryptedRestored.getFirstField(FieldType.PAYLOAD);
      expect(payload).not.toBeDefined();  // no plaintext field
      expect(singleEncryptedRestored.getBinaryDataIfAvailable().toString('utf-8'))
        .not.toContain("veritum");  // plaintext word not present
    });
  });  // verify test setup

  describe('retrieval as Veritum', () => {
    let posts: Veritum[];
    beforeAll(async () => {
      // run test
      posts = await ArrayFromAsync(id.getPosts({
        format: PostFormat.Veritum,
      }));
    });

    it('restores the correct number of posts', () => {
      expect(posts.length).toBe(id.getPostCount());
    });

    it('returns posts with a well-defined key that matches what the Identity claims', async () => {
      for (const post of posts) {
        const key: CubeKey = await post.getKey();
        expect(key).toBeDefined();
        expect(id.hasPost(key)).toBeTruthy();
      }
    });

    it('restores a post made from a single frozen Cube', () => {
      const singleFrozenRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singleFrozen.getKeyStringIfAvailable())!;
      postEquals(singleFrozen, singleFrozenRestored);
    });

    it('restores a post made from a single frozen Cube with notification', () => {
      const singleFrozenNotifyRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singleFrozenNotify.getKeyStringIfAvailable())!;
      postEquals(singleFrozenNotify, singleFrozenNotifyRestored);
    });

    it('restores a post made from a single PIC', async() => {
      let singlePicRestored: Veritum;
      const singlePicKey = await singlePic.getKeyString();
      for (const post of posts) {
        const candidateKey = await post.getKeyString();
        if (candidateKey === singlePicKey) {
          singlePicRestored = post;
          break;
        }
      }
      postEquals(singlePic, singlePicRestored!);
    });

    it('restores a post made from a single PIC with notification', () => {
      const singlePicNotifyRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singlePicNotify.getKeyStringIfAvailable())!;
      postEquals(singlePicNotify, singlePicNotifyRestored);
    });

    it('restores a post made from a single MUC', () => {
      const singleMucRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singleMuc.getKeyStringIfAvailable())!;
      postEquals(singleMuc, singleMucRestored);
    });

    it('restores a post made from a single MUC with notification', () => {
      const singleMucNotifyRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singleMucNotify.getKeyStringIfAvailable())!;
      postEquals(singleMucNotify, singleMucNotifyRestored);
    });

    // TODO FIXME: PMUC Veritum handling still buggy
    it.skip('restores a post made from a single PMUC', () => {
      const singlePmucRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singlePmuc.getKeyStringIfAvailable())!;
      postEquals(singlePmuc, singlePmucRestored);
    });

    it('restores a post made from a single PMUC with notification', () => {
      const singlePmucNotifyRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singlePmucNotify.getKeyStringIfAvailable())!;
      postEquals(singlePmucNotify, singlePmucNotifyRestored);
    });

    it('restores a frozen multi Cube post', () => {
      const multiFrozenRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === multiFrozen.getKeyStringIfAvailable())!;
      postEquals(multiFrozen, multiFrozenRestored);
    });

    // TODO FIXME: PIC Veritum handling still buggy
    it.skip('restores a PIC multi Cube post', () => {
      const multiPicRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === multiPic.getKeyStringIfAvailable())!;
      postEquals(multiPic, multiPicRestored);
    });

    it('restores a frozen single Cube encrypted post', () => {
      const singleFrozenEncryptedRestored: Veritum = posts.find(
        post => post.getKeyStringIfAvailable() === singleFrozenEncrypted.getKeyStringIfAvailable())!;
      // post is encrypted to self and should get decrypted automatically
      postEquals(singleFrozenEncrypted, singleFrozenEncryptedRestored);
    });
  });

  describe('retrieval as Cube', () => {
    it.todo('write tests');
  });

  describe('retrieval as CubeInfo', () => {
    it.todo('write tests or drop feature');
  });

  describe('edge cases', () => {
    it.todo('will return undefined if a chunk is missing');
    it.todo('will return available Verita quickly even if others take a long time to retrieve');
  });
});

function postEquals(a: Veritable, b: Veritable) {
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  const payloadA = a.getFirstField(FieldType.PAYLOAD);
  const payloadB = b.getFirstField(FieldType.PAYLOAD);
  expect(payloadA.valueString).toEqual(payloadB.valueString);
  // TODO once we have proper comparisons, we should also compare things like date,
  //   notification, or update count in case of PMUC
}