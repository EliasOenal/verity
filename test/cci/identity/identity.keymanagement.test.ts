import { Cube } from "../../../src/cci/cube/cube";
import { CrpytographyError } from "../../../src/cci/helpers/cryptography";
import { Identity } from "../../../src/cci/identity/identity";
import { CubeStore } from "../../../src/core/cube/cubeStore";

import { testCubeStoreParams, idTestOptions } from "../testcci.definitions";

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Identity (key management)', () => {
  let cubeStore: CubeStore;

  describe('construction', () => {  // multi-test scenario
    let original: Identity;
    beforeAll(async () => {
      cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      original = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
    });

    it('has an encryption key pair when creating a new Identity from username/password', () => {
      expect(original.encryptionPublicKey).toBeInstanceOf(Buffer);
      expect(original.encryptionPrivateKey).toBeInstanceOf(Buffer);
    });

    it('will still have the same encryption key pair when recreating the same Identity through its master key', () => {
      const restored: Identity = new Identity(cubeStore, original.masterKey, idTestOptions);
      expect(restored.encryptionPublicKey).toEqual(original.encryptionPublicKey);
      expect(restored.encryptionPrivateKey).toEqual(original.encryptionPrivateKey);
    });
  });  // construction multi-test scenario

  describe('supplyMasterKey()', () => {  // multi-test scenario
    let original: Identity;
    let restored: Identity;
    beforeAll(async () => {
      original = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      const compiledMuc: Buffer = await original.muc.getBinaryData();
      const restoredMuc: Cube = new Cube(compiledMuc);
      restored = new Identity(cubeStore, restoredMuc, idTestOptions);
    });

    it('will upgrade a non-owned Identity to an owned one', () => {
      // restored is currently non-owned, i.e. doesn't know its private keys
      expect(restored.masterKey).toBeUndefined();
      expect(restored.privateKey).toBeUndefined();
      expect(restored.encryptionPrivateKey).toBeUndefined();

      restored.supplyMasterKey(original.masterKey);

      // restored is now owned, i.e. knows both its private keys
      expect(restored.masterKey).toEqual(original.masterKey);
      expect(restored.privateKey).toEqual(original.privateKey);
      expect(restored.encryptionPrivateKey).toEqual(original.encryptionPrivateKey);
    });

    it('is idempotent', () => {
      // we can call supplyMasterKey() again and it won't change a thing
      restored.supplyMasterKey(original.masterKey);
      expect(restored.masterKey).toEqual(original.masterKey);
      expect(restored.privateKey).toEqual(original.privateKey);
      expect(restored.encryptionPrivateKey).toEqual(original.encryptionPrivateKey);
    });

    it('will throw when supplying an incompatible key', () => {
      const incompatibleMasterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 0x42);
      expect(() => restored.supplyMasterKey(incompatibleMasterKey)).toThrow(CrpytographyError);
    })
  });
});
