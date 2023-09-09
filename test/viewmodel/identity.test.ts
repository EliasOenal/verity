import { Identity, IdentityPersistance } from '../../src/viewmodel/identity'
import { Cube, CubeKey } from '../../src/model/cube'
import { NetConstants } from '../../src/model/networkDefinitions';

import sodium from 'libsodium-wrappers'
import { CubeStore } from '../../src/model/cubeStore';
import { makePost } from '../../src/viewmodel/zwCubes';
import { ZwFieldType, ZwFields, ZwRelationshipType } from '../../src/viewmodel/zwFields';

describe('Identity', () => {
  let persistance: IdentityPersistance;
  let cubeStore: CubeStore;

  const reduced_difficulty = 0;

  beforeEach(async () => {
    await sodium.ready;
    // Open the DB and make sure it's empty
    persistance = await IdentityPersistance.create("testidentity");
    await persistance.deleteAll();
    cubeStore = new CubeStore(false, reduced_difficulty);  // require no hashcash for faster testing
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
      const id = new Identity(cubeStore);
      idkey = id.key;
      id.persistance = persistance;
      expect(id.name).toBeUndefined();
      id.name = "Probator Identitatum";
      const storePromise: Promise<void> = id.store();
      expect(storePromise).toBeInstanceOf(Promise<void>);
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
  }, 5000);

  it('should store and retrieve a minimal Identity to and from a MUC object', async() => {
    const original = new Identity(cubeStore);
    original.name = "Probator Identitatum";
    const muc = original.makeMUC(reduced_difficulty);
    expect(muc).toBeInstanceOf(Cube);
    const mucadded = await cubeStore.addCube(muc);
    expect(mucadded).toEqual(original.publicKey);

    const restoredmuc = cubeStore.getCube(await muc.getKey());
    expect(restoredmuc).toBeInstanceOf(Cube);
    const restored = new Identity(cubeStore, restoredmuc);
    expect(restored).toBeInstanceOf(Identity);
    expect(restored.name).toEqual("Probator Identitatum");
  });

  it('should store and retrieve an Identity to and from a MUC object', async () => {
    const original = new Identity(cubeStore);

    // populate ID
    original.name = "Probator Identitatum";
    original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
    original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);

    const postkey = (await cubeStore.addCube(await makePost("I got important stuff to say", undefined, original, reduced_difficulty))) as CubeKey;
    expect(postkey).toBeInstanceOf(Buffer);
    expect(original.posts.length).toEqual(1);
    expect(ZwFields.get(cubeStore.getCube(original.posts[0]) as Cube).getFirstField(ZwFieldType.PAYLOAD).value.toString('utf-8')).
      toEqual("I got important stuff to say");

    // compile ID into MUC
    const muc = original.makeMUC(reduced_difficulty);
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
    expect(mucadded).toEqual(original.publicKey);

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
  });

  it('should store and retrieve an Identity to and from a binary MUC', async () => {
    const original = new Identity(cubeStore);

    // populate ID
    original.name = "Probator Identitatum";
    original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
    original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
    const postkey = (await cubeStore.addCube(await makePost("I got important stuff to say", undefined, original, reduced_difficulty))) as CubeKey;

    // compile ID into binary MUC
    const muc = original.makeMUC(reduced_difficulty);
    expect(muc).toBeInstanceOf(Cube);
    const muckey = await muc.getKey();
    expect(muckey).toBeInstanceOf(Buffer);
    expect(muckey).toEqual(original.publicKey);
    const binarymuc = muc.getBinaryData();
    expect(binarymuc).toBeInstanceOf(Buffer);
    const mucadded = await cubeStore.addCube(binarymuc);
    expect(mucadded).toEqual(original.publicKey);

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
  });

  // This wastes incredible amounts of CPU time for hash-cashing 100 posts.
  // We should dynamically reduce hash difficulty to 0 just for this test.
  // Until we do that, we'll keep this test skipped.
  // Also, to check for correct order by date we currently wait one second between
  // posts creations as we only store date with one second resolution. So 100
  // seconds of this test are actually just spent waiting.
  // We either need to redesign this test completely or it will stay eternally skipped.
  it('restores its post list recursively and sorted by creation time descending', async () => {
    const TESTPOSTCOUNT = 100;  // 100 keys are more than guaranteed not to fit in the MUC
    const original: Identity = new Identity(cubeStore);
    original.name = "Probator memoriae tabellae";
    const idkey = original.publicKey;

    for (let i=0; i<TESTPOSTCOUNT; i++) {
      const post: Cube = await makePost("I got " + (i+1).toString() + " important things to say", undefined, original, reduced_difficulty);
      // @ts-ignore Fake private field date to avoid this test taking forever
      post.date = 1694284300 + i;
      await cubeStore.addCube(post);
    }
    expect(original.posts.length).toEqual(TESTPOSTCOUNT);

    const muc = await original.store()
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
  }, 300000);
});
