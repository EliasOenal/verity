import { Cube } from '../../../src/core/cube/cube';
import { CubeKey } from '../../../src/core/cube/cube.definitions';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { Avatar, AvatarScheme } from '../../../src/cci/identity/avatar';
import { IdentityOptions } from '../../../src/cci/identity/identity.definitions';
import { Identity } from '../../../src/cci/identity/identity';
import { IdentityPersistence } from '../../../src/cci/identity/identityPersistence';

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const reducedDifficulty = 0; // no hash cash for testing

describe('Identity:local persistant storage', () => {
  let persistance: IdentityPersistence;
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

    // Open the DB and make sure it's empty
    persistance = await IdentityPersistence.Construct({dbName: "testidentity"});
    await persistance.deleteAll();
    const ids: Array<Identity> = await persistance.retrieve(cubeStore);
    expect(ids).toBeDefined();
    expect(ids.length).toEqual(0);
    idTestOptions = {
      minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
      requiredDifficulty: reducedDifficulty,
      identityPersistence: persistance,
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

      const storePromise: Promise<Cube> = id.store();
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
  }, 5000);
});  // local persistant storage tests
