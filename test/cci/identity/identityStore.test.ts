import { Identity, IdentityOptions } from '../../../src/cci/identity/identity'

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { IdentityStore } from '../../../src/cci/identity/identityStore';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

describe('IdentityStore', () => {
  const reducedDifficulty = 0;  // no hash cash for testing
  let idTestOptions: IdentityOptions;
  let identityStore: IdentityStore;
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    idTestOptions = {  // note that those are diferent for some tests further down
      minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
      requiredDifficulty: reducedDifficulty,
      argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
      argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
    };
    cubeStore = new CubeStore(testCubeStoreParams)
    await cubeStore.readyPromise;
    identityStore = new IdentityStore(cubeStore);
  });

  afterEach(async () => {
    identityStore.shutdown();
    await cubeStore.shutdown();
  });

  describe('addIdentity(); getIdentity()', () => {
    it('adds and retrieves an Identity & returns undefined for Identities not in store', () => {
      const masterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
      // assert undefined for invalid key
      expect(identityStore.getIdentity(masterKey)).toBeUndefined();

      const id: Identity = new Identity(undefined, masterKey, idTestOptions);
      expect(id.key.length).toBe(NetConstants.CUBE_KEY_SIZE);
      identityStore.addIdentity(id);

      // assert retrieve stored Identity
      expect(identityStore.getIdentity(id.keyString)).toBe(id);

      // assert undefined for Identity not in store
      expect(identityStore.getIdentity(
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 43)
      )).toBeUndefined();
    });
  });

  describe('retrieveIdentity()', () => {
    it('retrieves an existing Identity when in store', async () => {
      const masterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
      const id: Identity = new Identity(undefined, masterKey, idTestOptions);
      identityStore.addIdentity(id);

      const retrieved: Identity = await identityStore.retrieveIdentity(id.key);
      expect(retrieved).toBe(id);
    });

    it('restores an Identity from Cubes when not in store', async () => {
      const masterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
      const id: Identity = new Identity(cubeStore, masterKey, idTestOptions);
      await id.ready;
      id.name = "Probator conversionis";
      await id.store();
      expect(identityStore.getIdentity(id.keyString)).toBeUndefined();
      const retrieved: Identity = await identityStore.retrieveIdentity(id.key);

      // retrieved cannot be the same ID object as it has been reconstructed from Cubes
      expect(retrieved).not.toBe(id);
      expect(retrieved.keyString).toEqual(id.keyString);
      expect(retrieved.name).toEqual("Probator conversionis");
    });

    it('returns undefined if Identity is neither in store nor retrievable', async () => {
      expect(await identityStore.retrieveIdentity(
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 404)
      )).toBeUndefined();
    });
  });

  describe('shutdown()', () => {
    it('shuts down all Identities in store and removes their references', () => {
      const masterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
      const id: Identity = new Identity(cubeStore, masterKey, idTestOptions);
      identityStore.addIdentity(id);
      expect(identityStore.shuttingDown).toBe(false);
      expect(id.shuttingDown).toBe(false);

      const masterKey2: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
      const id2: Identity = new Identity(cubeStore, masterKey2, idTestOptions);
      identityStore.addIdentity(id2);
      expect(identityStore.shuttingDown).toBe(false);
      expect(id2.shuttingDown).toBe(false);

      identityStore.shutdown();
      expect(identityStore.shuttingDown).toBe(true);
      expect(id.shuttingDown).toBe(true);

      expect(identityStore.getIdentity(id.keyString)).toBeUndefined();
      expect(identityStore.getIdentity(id2.keyString)).toBeUndefined();
    });
  });
});
