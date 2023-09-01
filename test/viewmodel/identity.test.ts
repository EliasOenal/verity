import { Identity, IdentityPersistance } from '../../src/viewmodel/identity'
import { CubeKey } from '../../src/model/cube'

describe('Identity', () => {
  let persistance: IdentityPersistance;

  beforeEach(async () => {
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

  it('should create a new identity, store it and retrieve it', async () => {
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
      id.name = "Testar Identitates";  // setting anything implicitly saves the Identity
      await persistance.store(id);     // save it manually anyway so we can await the result
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
