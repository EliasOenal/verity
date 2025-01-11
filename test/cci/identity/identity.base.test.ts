import { VerityError } from '../../../src/core/settings';

import { CubeKey } from '../../../src/core/cube/cube.definitions';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { NetConstants } from '../../../src/core/networking/networkDefinitions';

import { cciCube, cciFamily } from '../../../src/cci/cube/cciCube';
import { Identity, IdentityOptions } from '../../../src/cci/identity/identity'
import { Avatar, AvatarScheme } from '../../../src/cci/identity/avatar';

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Identity: base model tests', () => {
  // This test suite provides basic unit tests regarding Identity's internal
  // functionality as a model class.
  // More specific features, like marshalling and demarshalling data into and
  // from Cubes, or persisting Identities in a local database, are addressed
  // in separate test suites for both readability and test performance.

  const reducedDifficulty = 0;  // no hash cash for testing
  let idTestOptions: IdentityOptions;
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
    cubeStore = new CubeStore(testCubeStoreParams);
    await cubeStore.readyPromise;
  });

  describe('post-related methods: addPost(), hasPost(), getPostCount(), getPostKeyStrings()', () => {
    it('stores and remembers own post references', () => {
      // create Identity
      const idKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 41);
      const id = new Identity(undefined, idKey, idTestOptions);
      expect(id.getPostCount()).toEqual(0);

      // add a post
      const postKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337);
      id.addPost(postKey);

      // check getPostCount()
      expect(id.getPostCount()).toEqual(1);

      // check hasPost()
      expect(id.hasPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337))).toBeTruthy();

      // check getPostKeyStrings()
      expect(Array.from(id.getPostKeyStrings())).toHaveLength(1);
      expect(Array.from(id.getPostKeyStrings())[0]).toEqual(postKey.toString('hex'));

      // check getPostKeys()
      expect(Array.from(id.getPostKeys())).toHaveLength(1);
      expect(Array.from(id.getPostKeys())[0]).toEqual(postKey);
    });

    // This test currently fails
    it.skip('remembers only unique posts', () => {
      const id = new Identity(
        undefined, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 41), idTestOptions);
      expect(id.getPostCount()).toEqual(0);

      id.addPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337));
      id.addPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337));
      expect(id.getPostCount).toEqual(1);
      expect(id.hasPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337))).toBeTruthy();
    });
  });

  describe('public subscriptons (aka subscription recommendations)', ()  => {
    it('stores and remembers subscription recommendations', () => {
      const id = new Identity(
        undefined, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 41), idTestOptions);
      expect(id.getPublicSubscriptionCount()).toBe(0);

      id.addPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337));
      expect(id.getPublicSubscriptionCount()).toBe(1);
      expect(id.hasPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337))).toBeTruthy();
    });

    // This test currently fails
    it.skip('remembers only unique subscription recommendations', () => {
      const id = new Identity(
        undefined, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 41), idTestOptions);
      expect(id.getPublicSubscriptionCount()).toBe(0);

      id.addPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337));
      id.addPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337));
      expect(id.getPublicSubscriptionCount()).toBe(1);
      expect(id.hasPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337))).toBeTruthy();
    });

    it('correctly identifies authors as subscribed or not subscribed', async () => {
      const subject: Identity = await Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor novarum interessantiarum";

      // Create 10 subscribed and 10 non-subscribed authors
      const TESTSUBCOUNT = 10;
      const subscribed: CubeKey[] = [];
      const nonsubscribed: CubeKey[] = [];

      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
          cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        other.name = "Figurarius subscriptus numerus " + i;
        other.muc.setDate(0);  // skip waiting period for the test
        other.store();
        subscribed.push(other.key);
        subject.addPublicSubscription(other.key);
        expect(subject.hasPublicSubscription(other.key)).toBeTruthy();
      }
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
          cubeStore, "non implicatus "+i, "secretum"+i, idTestOptions);
        other.name = "Persona non implicata " + i;
        other.muc.setDate(0);  // skip waiting period for the test
        other.store();
        nonsubscribed.push(other.key);
      }

      // verify subscription status
      for (let i=0; i<TESTSUBCOUNT; i++) {
        expect(subject.hasPublicSubscription(subscribed[i])).toBeTruthy();
        expect(subject.hasPublicSubscription(nonsubscribed[i])).toBeFalsy();
      }
    });
  });  // describe subscription recommendations

  describe('recursiveWebOfSubscriptions()', () => {
    it.todo('returns all of my subscriptions and all of their subscriptions by default');
    it.todo('can recurse another level if requested')
    it.todo("does not magically subscribe me to my subscription's subscriptions");
  });

  describe('edge cases', () => {
    describe('constructing and running an Identity without CubeStore access', () => {
      let id: Identity;

      // running an Identity without CubeStore access severely limits functionality
      // and is mainly used for unit testing
      it('can construct an Identity from scratch and keep information in RAM without CubeStore access', async () => {
        // create an Identity without CubeStore access
        id = new Identity(
          undefined,    // explicitly no CubeStore reference
          Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42),  // master key
          idTestOptions,
        );

        // store some information (in RAM only)
        id.name = "Probator Identitatum";
        id.addPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42));
        id.addPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 13));
        id.addPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 37));
        id.avatar = new Avatar("4213374211", AvatarScheme.MULTIAVATAR);
        id.addPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 43));
        id.addPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 44));
        id.addPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 45));

        // compile to MUC
        const muc: cciCube = await id.makeMUC();
        expect(id.muc).toBe(muc);

        // verify information
        expect(id.name).toBe("Probator Identitatum");
        expect(id.getPostCount()).toBe(3);
        expect(id.hasPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))).toBeTruthy();
        expect(id.hasPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 13))).toBeTruthy();
        expect(id.hasPost(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 37))).toBeTruthy();
        expect(id.avatar.seedString).toBe("4213374211");
        expect(id.avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
        expect(id.getPublicSubscriptionCount()).toBe(3);
        expect(id.hasPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 43))).toBeTruthy();
        expect(id.hasPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 44))).toBeTruthy();
        expect(id.hasPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 45))).toBeTruthy();
      });

      it('will parse an Identity MUC on construction but ignore any references to other Cubes', async() => {
        // note that the previous test is required before running this one!
        expect(id.muc).toBeInstanceOf(cciCube);

        // restore an Identity from the MUC without providing a CubeStore reference
        const restored: Identity = new Identity(
          undefined,    // explicitly no CubeStore reference
          id.muc,
          idTestOptions,
        );
        await restored.ready;

        // verify information restored from MUC
        expect(restored.name).toBe("Probator Identitatum");
        expect(restored.avatar.seedString).toBe("4213374211");
        expect(restored.avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
        // Note: No post references will be present in the restored
        // Identity as our current implementation wants to fetch them before
        // adding them to the restored Identity.

        // Note: No subscription recommendations will be present in the restored
        // Identity as those are currently always store in extension MUCs.
        // We do not check for this though as a future implementation may and should
        // store all Identity information in the base MUC as long as it fits.
      });

      it('will throw an Error when attempting to store the Identity', async () => {
        await expect(async () => await id.store()).rejects.toThrow(VerityError);
      });
    });
  });
});
