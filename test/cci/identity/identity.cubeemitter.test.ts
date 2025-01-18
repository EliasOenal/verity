import { CubeStore } from '../../../src/core/cube/cubeStore';
import { Identity, IdentityOptions } from '../../../src/cci/identity/identity'

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { CubeType } from '../../../src/core/cube/cube.definitions';
import { cciField } from '../../../src/cci/cube/cciField';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';
import { cciFieldType } from '../../../src/cci/cube/cciCube.definitions';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

describe('Identity: Cube emitter implementation and related methods', () => {
  // This test suite handles Identity's impelementation of the CubeEmitter interface
  // as well as the supplemental methods and events providing higher level
  // data in a similar fashion

  const reducedDifficulty = 0;  // no hash cash for testing
  let idTestOptions: IdentityOptions;
  let cubeStore: CubeStore;
  let masterKey: Buffer;
  let id: Identity;

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

    // prepare an Identity
    masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
    id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
    id.name = "protagonista qui illas probationes pro nobis administrabit"
    await id.store();
  });

  afterEach(async () => {
    await cubeStore.shutdown();
    await id.identityStore.shutdown();
  });


  describe('CubeInfo generators', () => {
    describe('getPostCubeInfos()', async () => {
      it('retrieves CubeInfos for all of this Identity\'s posts', async () => {
        // prepare two posts
        const post1: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Nuntius primus"),
        });
        await cubeStore.addCube(post1);
        id.addPost(post1.getKeyIfAvailable());

        const post2: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Nuntius secundus"),
        });
        await cubeStore.addCube(post2);
        id.addPost(post2.getKeyIfAvailable());

        // perform test
        const postInfos: CubeInfo[] = await ArrayFromAsync(id.getPostCubeInfos());

        // check results
        expect(postInfos.length).toBe(2);
        expect(postInfos[0].key).toEqual(post1.getKeyIfAvailable());
        expect(postInfos[1].key).toEqual(post2.getKeyIfAvailable());
        expect(postInfos[0].getCube().getFirstField(cciFieldType.PAYLOAD).valueString).toBe("Nuntius primus");
        expect(postInfos[1].getCube().getFirstField(cciFieldType.PAYLOAD).valueString).toBe("Nuntius secundus");
      });

      it('yields nothing if there are no posts', async () => {
        // perform test
        const postInfos: CubeInfo[] = await ArrayFromAsync(id.getPostCubeInfos());

        // check results
        expect(postInfos.length).toBe(0);
      });

      it('does not yield anything for unavailable posts', async () => {
        // prepare two posts
        const post1: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Nuntius primus"),
        });
        // note we missed adding this post to the CubeStore
        id.addPost(post1.getKeyIfAvailable());

        const post2: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Nuntius secundus"),
        });
        await cubeStore.addCube(post2);
        id.addPost(post2.getKeyIfAvailable());

        // perform test
        const postInfos: CubeInfo[] = await ArrayFromAsync(id.getPostCubeInfos());

        // check results
        expect(postInfos.length).toBe(1);
        expect(postInfos[0].key).toEqual(post2.getKeyIfAvailable());
        expect(postInfos[0].getCube().getFirstField(cciFieldType.PAYLOAD).valueString).toBe("Nuntius secundus");
      });
    });

    describe('getPublicSubscriptionCubeInfos()', () => {
      it('retrieves CubeInfos for all of this Identity\'s subscriptions', async () => {
        // prepare two fake subscriptions
        const sub1: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Subscriptio prima"),
        });
        await cubeStore.addCube(sub1);
        id.addPublicSubscription(sub1.getKeyIfAvailable());

        const sub2: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Subscriptio secunda"),
        });
        await cubeStore.addCube(sub2);
        id.addPublicSubscription(sub2.getKeyIfAvailable());

        // perform test
        const subInfos: CubeInfo[] = await ArrayFromAsync(id.getPublicSubscriptionCubeInfos());

        // check results
        expect(subInfos.length).toBe(2);
        expect(subInfos[0].key).toEqual(sub1.getKeyIfAvailable());
        expect(subInfos[1].key).toEqual(sub2.getKeyIfAvailable());
        expect(subInfos[0].getCube().getFirstField(cciFieldType.PAYLOAD).valueString).toBe("Subscriptio prima");
        expect(subInfos[1].getCube().getFirstField(cciFieldType.PAYLOAD).valueString).toBe("Subscriptio secunda");
      });

      it('yields nothing if there are no subscriptions', async () => {
        // perform test
        const subInfos: CubeInfo[] = await ArrayFromAsync(id.getPublicSubscriptionCubeInfos());

        // check results
        expect(subInfos.length).toBe(0);
      });

      it('does not yield anything for unavailable subscriptions', async () => {
        // prepare two fake subscriptions
        const sub1: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Subscriptio prima"),
        });
        // note we missed adding this post to the CubeStore
        id.addPublicSubscription(sub1.getKeyIfAvailable());

        const sub2: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Subscriptio secunda"),
        });
        await cubeStore.addCube(sub2);
        id.addPublicSubscription(sub2.getKeyIfAvailable());

        // perform test
        const subInfos: CubeInfo[] = await ArrayFromAsync(id.getPublicSubscriptionCubeInfos());

        // check results
        expect(subInfos.length).toBe(1);
        expect(subInfos[0].key).toEqual(sub2.getKeyIfAvailable());
        expect(subInfos[0].getCube().getFirstField(cciFieldType.PAYLOAD).valueString).toBe("Subscriptio secunda");
      });
    });

    describe('getPublicSubscriptionIdentities()', () => {
      it('retrieves Identity objects for all of this Identity\'s subscriptions', async () => {
        // prepare additional Identities so we can subscribe to them
        const sub1MasterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43);
        const sub1: Identity = await Identity.Construct(cubeStore, sub1MasterKey, idTestOptions);
        sub1.name = "Subscriptio prima";
        await sub1.store();
        id.addPublicSubscription(sub1.key);

        const sub2MasterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44);
        const sub2: Identity = await Identity.Construct(cubeStore, sub2MasterKey, idTestOptions);
        sub2.name = "Subscriptio secunda";
        await sub2.store();
        id.addPublicSubscription(sub2.key);

        // perform test
        const subs: Identity[] = await ArrayFromAsync(id.getPublicSubscriptionIdentities());

        // check results
        expect(subs.length).toBe(2);
        expect(subs[0].key).toEqual(sub1.key);
        expect(subs[1].key).toEqual(sub2.key);
        expect(subs[0].name).toBe("Subscriptio prima");
        expect(subs[1].name).toBe("Subscriptio secunda");
      });

      it('yields nothing if there are no subscriptions', async () => {
        // perform test
        const subs: Identity[] = await ArrayFromAsync(id.getPublicSubscriptionIdentities());

        // check results
        expect(subs.length).toBe(0);
      });

      it('does not yield anything for unavailable subscriptions', async () => {
        id.addPublicSubscription(Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 1337));

        const sub2MasterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 1338);
        const sub2: Identity = await Identity.Construct(cubeStore, sub2MasterKey, idTestOptions);
        sub2.name = "Subscriptio secunda";
        await sub2.store();
        id.addPublicSubscription(sub2.key);

        // perform test
        const subs: Identity[] = await ArrayFromAsync(id.getPublicSubscriptionIdentities());

        // check results
        expect(subs.length).toBe(1);
        expect(subs[0].key).toEqual(sub2.key);
        expect(subs[0].name).toBe("Subscriptio secunda");
      });
    });

    describe('getAllCubeInfos()', () => {
      describe('tests without recursion', () => {
        beforeEach(() => {
          id.subscriptionRecursionDepth = 0;
        });

        it('yields the Identity\'s own root Cube', async () => {
          // perform test
          const cubeInfos: CubeInfo[] = await ArrayFromAsync(id.getAllCubeInfos());

          // check results
          expect(cubeInfos.length).toBe(1);
          expect(cubeInfos[0].key).toEqual(id.key);
          expect(cubeInfos[0].getCube().getFirstField(cciFieldType.USERNAME).valueString).toBe(id.name);
        });

        it('yield the Identity\'s own posts and subscriptions', async () => {
          // prepare two posts
          const post1: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius primus"),
          });
          await cubeStore.addCube(post1);
          id.addPost(post1.getKeyIfAvailable());

          const post2: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius secundus"),
          });
          await cubeStore.addCube(post2);
          id.addPost(post2.getKeyIfAvailable());

          // prepare two fake subscriptions
          const sub1: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio prima"),
          });
          await cubeStore.addCube(sub1);
          id.addPublicSubscription(sub1.getKeyIfAvailable());

          const sub2: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio secunda"),
          });
          await cubeStore.addCube(sub2);
          id.addPublicSubscription(sub2.getKeyIfAvailable());

          // perform test
          const cubeInfos: CubeInfo[] = await ArrayFromAsync(id.getAllCubeInfos());

          // check results
          expect(cubeInfos.length).toBe(5);
          expect(cubeInfos[0].key).toEqual(id.key);
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            post1.getKeyIfAvailable()))).toBeTruthy();
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            post2.getKeyIfAvailable()))).toBeTruthy();
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub1.getKeyIfAvailable()))).toBeTruthy();
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub2.getKeyIfAvailable()))).toBeTruthy();
        });
      });

      describe('tests with single level recursion', () => {
        beforeEach(() => {
          id.subscriptionRecursionDepth = 1;
        });

        it('yields the Identity\'s own stuff as well as all of the above for its two subscribed Identities', async () => {
          // make a post
          const post: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius primus"),
          });
          await cubeStore.addCube(post);
          id.addPost(post.getKeyIfAvailable());

          // prepare additional Identities so we can subscribe to them
          const sub1MasterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43);
          const sub1: Identity = await Identity.Construct(cubeStore, sub1MasterKey, idTestOptions);
          sub1.name = "Subscriptio prima";
          await sub1.store();
          id.addPublicSubscription(sub1.key);

          const sub2MasterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44);
          const sub2: Identity = await Identity.Construct(cubeStore, sub2MasterKey, idTestOptions);
          sub2.name = "Subscriptio secunda";
          await sub2.store();
          id.addPublicSubscription(sub2.key);

          // for both of our two subscribed Identites, add a post and a fake subscription
          const sub1Post: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius primus"),
          });
          await cubeStore.addCube(sub1Post);
          sub1.addPost(sub1Post.getKeyIfAvailable());

          const sub1Sub: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio prima"),
          });
          await cubeStore.addCube(sub1Sub);
          sub1.addPublicSubscription(sub1Sub.getKeyIfAvailable());

          const sub2Post: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius secundus"),
          });
          await cubeStore.addCube(sub2Post);
          sub2.addPost(sub2Post.getKeyIfAvailable());

          const sub2Sub: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio secunda"),
          });
          await cubeStore.addCube(sub2Sub);
          sub2.addPublicSubscription(sub2Sub.getKeyIfAvailable());

          // perform test
          const cubeInfos: CubeInfo[] = await ArrayFromAsync(id.getAllCubeInfos());

          // check results:
          // 1. the Identity itself
          expect(cubeInfos[0].key).toEqual(id.key);
          // 2. own posts
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            post.getKeyIfAvailable()))).toBeTruthy();
          // 3. own subscriptions
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub1.key))).toBeTruthy();
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub2.key))).toBeTruthy();
          // 4. subscribed Identities' posts
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub1Post.getKeyIfAvailable()))).toBeTruthy();
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub2Post.getKeyIfAvailable()))).toBeTruthy();
          // 5. subscribed Identities' subscriptions
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub1Sub.getKeyIfAvailable()))).toBeTruthy();
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub2Sub.getKeyIfAvailable()))).toBeTruthy();
        });
      });

      describe('tests with two levels of recursion', () => {
        beforeEach(() => {
          id.subscriptionRecursionDepth = 2;
        })

        it('yields our subscribed Identities\' posts and subscriptions, as well as their subscribed Identities\' posts and subscriptions, except unavailable ones', async () => {
          // make an Identity to subscribe to
          const sub1MasterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43);
          const sub1: Identity = await Identity.Construct(cubeStore, sub1MasterKey, idTestOptions);
          sub1.name = "Subscriptio prima";
          id.addPublicSubscription(sub1.key);

          // make a second level of Identity, so sub1 can subscribe to sub2
          const sub2MasterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44);
          const sub2: Identity = await Identity.Construct(cubeStore, sub2MasterKey, idTestOptions);
          sub2.name = "Subscriptio secunda";
          sub1.addPublicSubscription(sub2.key);

          // for both of our two subscribed Identites, add a post and a fake subscription
          const sub1Post: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius primus"),
          });
          await cubeStore.addCube(sub1Post);
          sub1.addPost(sub1Post.getKeyIfAvailable());

          const sub1Sub: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio prima"),
          });
          await cubeStore.addCube(sub1Sub);
          sub1.addPublicSubscription(sub1Sub.getKeyIfAvailable());

          const sub2Post: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius secundus"),
          });
          await cubeStore.addCube(sub2Post);
          sub2.addPost(sub2Post.getKeyIfAvailable());

          const sub2Sub: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio secunda"),
          });
          await cubeStore.addCube(sub2Sub);
          sub2.addPublicSubscription(sub2Sub.getKeyIfAvailable());

          await sub1.store();
          await sub2.store();
          await id.store();

          // perform test
          const cubeInfos: CubeInfo[] = await ArrayFromAsync(id.getAllCubeInfos());

          // check results:
          // 1. the Identity itself
          expect(cubeInfos[0].key).toEqual(id.key);
          // 2. own subscriptions
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub1.key))).toBeTruthy();
          // 3. subscribed Identities' posts (1st level)
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub1Post.getKeyIfAvailable()))).toBeTruthy();
          // 4. subscribed Identities' subscriptions (1st level)
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub1Sub.getKeyIfAvailable()))).toBeTruthy();
          // 5. subscribed Identities' posts (2nd level)
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub2Post.getKeyIfAvailable()))).toBeTruthy();
          // 6. subscribed Identities' subscriptions (2nd level)
          expect(cubeInfos.some((cubeInfo: CubeInfo) => cubeInfo.key.equals(
            sub2Sub.getKeyIfAvailable()))).toBeTruthy();
        });
      });
    });

  });

  describe('CubeInfo event emissions', () => {
    describe('cubeAdded event', () => {
      describe('events originating from this Identity itself', () => {
        it.todo('will emit cubeAdded if a new post is added');
        it.todo('will emit cubeAdded if a new subscription is added');
        it.todo('will emit cubeAdded if the Identity\'s root Cube is updated');
      });

      describe('events originating from other Identities', () => {
        it.todo('will emit cubeAdded if a new post is added by a directly subscribed Identity');
        it.todo('will emit cubeAdded if a new post is added by an indirectly subscribed Identity within the recursion limit');
        it.todo('will not emit cubeAdded if a new post is added by an indirectly subscribed Identity beyond the recursion limit');

        it.todo('will emit cubeAdded if a new subscription is added by a directly subscribed Identity');
        it.todo('will emit cubeAdded if a new subscription is added by an indirectly subscribed Identity within the recursion limit');
        it.todo('will not emit cubeAdded if a new subscription is added by an indirectly subscribed Identity beyond the recursion limit');

        it.todo('will emit cubeAdded if the Identity\'s root Cube is updated by a directly subscribed Identity');
        it.todo('will emit cubeAdded if the Identity\'s root Cube is updated by an indirectly subscribed Identity within the recursion limit');
        it.todo('will not emit cubeAdded if the Identity\'s root Cube is updated by an indirectly subscribed Identity beyond the recursion limit');
      });
    });
  });

});
