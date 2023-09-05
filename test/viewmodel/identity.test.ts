import { Identity, IdentityPersistance } from '../../src/viewmodel/identity'
import { CubeKey } from '../../src/model/cube'
import { NetConstants } from '../../src/model/networkDefinitions';

import sodium from 'libsodium-wrappers'

describe('Identity persistance', () => {
  let persistance: IdentityPersistance;

  beforeEach(async () => {
    await sodium.ready;
    // Open the DB and make sure it's empty
    persistance = await IdentityPersistance.create("testidentity");
    await persistance.deleteAll();
    const ids: Array<Identity> = await persistance.retrieve();
    expect(ids).toBeDefined();
    expect(ids.length).toEqual(0);
});

  afterEach(async () => {
    // Empty the DB and then close it
    await persistance.deleteAll();
    const ids: Array<Identity> = await persistance.retrieve();
    expect(ids).toBeDefined();
    expect(ids.length).toEqual(0);
    await persistance.close();
  });

  it.skip('should store and retrieve an Identity locally', async () => {
    {  // expect DB to be empty at the beginning
      const ids: Array<Identity> = await persistance.retrieve();
      expect(ids.length).toEqual(0);
    }

    let idkey: CubeKey | undefined = undefined;
    {  // phase 1: create new identity and store it
      const id = new Identity();
      idkey = id.key;
      id.persistance = persistance;
      expect(id.name).toBeUndefined();
      id.name = "Testar Identitates";
      await id.store();
    }
    { // phase 2: retrieve, compare and delete the identity
      const ids: Array<Identity> = await persistance.retrieve();
      expect(ids.length).toEqual(1);
      const id: Identity = ids[0];
      expect(id.name).toEqual("Testar Identitates");
      expect(id.key).toEqual(idkey);
    }
  });
});



describe('Identity MUC', () => {
  beforeEach(async () => {
    await sodium.ready;
  });

  it('should store and retrieve an Identity to and from a MUC', async () => {
    const original = new Identity();
    original.name = "Testar Identitates";
    original.profilepic = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA);
    original.keyBackupCube = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0x13);
    original.posts.push(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(1));
    original.posts.push(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(2));
    original.posts.push(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(3));
    original.posts.push(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(4));
    original.posts.push(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(5));
    original.posts.push(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(6));
    const muc = original.makeMUC();

    const restored = new Identity(muc);
    expect(restored.name).toEqual("Testar Identitates");
    expect(restored.profilepic[0]).toEqual(0xDA);
    expect(restored.keyBackupCube[0]).toEqual(0x13);
    expect(restored.posts.length).toEqual(6);
    expect(restored.posts[4][0]).toEqual(5);
  });
});
