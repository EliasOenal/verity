import type { CubeKey } from '../../../src/core/cube/cube.definitions';

import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { Identity, IdentityOptions } from '../../../src/cci/identity/identity';
import { IdentityStore } from '../../../src/cci/identity/identityStore';
import { notifyingIdentities } from '../../../src/cci/identity/identityUtil';

import { testCciOptions } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';

describe('IdentityUtil', () => {
  describe('notifyingIdentities', () => {
    let cubeStore: CubeStore;
    let notifying1: Identity, notifying2: Identity, notifying3: Identity;
    let irrelevant: Identity, nonNotifying: Identity;

    const notificationKey: CubeKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42);
    const irrelevantKey: CubeKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 99);

    let result: Identity[];

    describe('from local CubeStore', () => {
      beforeAll(async () => {
        await sodium.ready;
        cubeStore = new CubeStore(testCciOptions);
        await cubeStore.readyPromise;

        // prepare test Identities

        const identityStore: IdentityStore = new IdentityStore(cubeStore);
        const identityOptions: IdentityOptions = {
          ...testCciOptions,
          identityStore,
        };

        const masterKey1: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 11);
        notifying1 = new Identity(cubeStore, masterKey1, {
          ...identityOptions,
          idmucNotificationKey: notificationKey,
        });
        await notifying1.store();

        const masterKey2: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 22);
        notifying2 = new Identity(cubeStore, masterKey2, {
          ...identityOptions,
          idmucNotificationKey: notificationKey,
        });
        await notifying2.store();

        const masterKey3: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 33);
        notifying3 = new Identity(cubeStore, masterKey3, {
          ...identityOptions,
          idmucNotificationKey: notificationKey,
        });
        await notifying3.store();

        const masterKey4: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44);
        irrelevant = new Identity(cubeStore, masterKey4, {
          ...identityOptions,
          idmucNotificationKey: irrelevantKey,
        });
        await irrelevant.store();

        const masterKey5: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 55);
        nonNotifying = new Identity(cubeStore, masterKey5, identityOptions);
        await nonNotifying.store();

        // run test
        const gen = notifyingIdentities(cubeStore, notificationKey, identityStore);
        // save results to array for ease of testing
        result = await ArrayFromAsync(gen);
      });

      afterAll(async () => {
        await notifying1.identityStore.shutdown();
        await cubeStore.shutdown();
      });

      it('will yield three matching notifying Identities', () => {
        expect(result.length).toBe(3);
        expect(result.some(id =>
          id.key.equals(notifying1.key)
        )).toBe(true);
        expect(result.some(id =>
          id.key.equals(notifying2.key)
        )).toBe(true);
        expect(result.some(id =>
          id.key.equals(notifying3.key)
        )).toBe(true);
      });

      it('will not yield the non-notifying Identity', () => {
        expect(result.some(id =>
          id.key.equals(nonNotifying.key)
        )).toBe(false);
      });

      it('will not yield the non-matching notifying Identity', () => {
        expect(result.some(id =>
          id.key.equals(irrelevant.key)
        )).toBe(false);
      });
    });
  });  // from local CubeStore

  describe('retrieving over the wire', () => {
    describe('regular one-off requests', () => {
      it.todo('write tests');
    });

    describe('subscribe mode', () => {
      it.todo('write tests');
    });
  });
});
