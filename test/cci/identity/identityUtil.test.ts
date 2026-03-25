import { CancellableTask } from '../../../src/cci/helpers';
import { Identity } from '../../../src/cci/identity/identity';
import { verifyAuthorship } from '../../../src/cci/identity/identityUtil';
import { asCubeKey } from '../../../src/core/cube/keyUtil';
import { passiveIdTestOptions } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('IdentityUtil', () => {
  beforeAll(async () => {
    await sodium.ready;
  });


  describe('verifyAuthorship()', () => {

    describe('immediate confirmation', () => {
      const identity = new Identity(
        undefined,  // no CubeStore or anything required for these trivial tests
        Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 81),  // random master key
        passiveIdTestOptions,
      );
      const claimedPostKey = asCubeKey(Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 41));

      beforeAll(async () => {
        identity.addPost(claimedPostKey);
      })

      it('immediately confirms authorship of already-known posts', async () => {
        const task: CancellableTask<boolean> =
          verifyAuthorship(claimedPostKey, identity);
        const result: boolean = await task.promise;
        expect(result).toBe(true);
      });
    });

    describe('deferred confirmation', () => {
      const identity = new Identity(
        undefined,  // no CubeStore or anything required for these trivial tests
        Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 82),  // random master key
        passiveIdTestOptions,
      );
      const claimedPostKey = asCubeKey(Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42));

      it('confirms authorship once the post is learned', async () => {
        const task: CancellableTask<boolean> =
          verifyAuthorship(claimedPostKey, identity);
        // wait a little to make sure this is actually deferred
        await new Promise((resolve) => setTimeout(resolve, 100));
        identity.addPost(claimedPostKey);
        const result: boolean = await task.promise;
        expect(result).toBe(true);
      });

    });

    describe('cancellation', () => {
      const identity = new Identity(
        undefined,  // no CubeStore or anything required for these trivial tests
        Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 83),  // random master key
        passiveIdTestOptions,
      );
      const claimedPostKey = asCubeKey(Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43));

      it('does not resolve unconfirmed posts until cancelled', async () => {
        const task: CancellableTask<boolean> =
          verifyAuthorship(claimedPostKey, identity);
        // wait a little to make sure this is actually deferred
        await new Promise((resolve) => setTimeout(resolve, 100));
        task.cancel();
        const result: boolean = await task.promise;
        expect(result).toBe(undefined);
      });
    });
  });
});