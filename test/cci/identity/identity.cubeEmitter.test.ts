import { CubeType } from '../../../src/core/cube/cube.definitions';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { Identity, IdentityOptions } from '../../../src/cci/identity/identity'
import { cciCube } from '../../../src/cci/cube/cciCube';
import { cciField } from '../../../src/cci/cube/cciField';
import { cciFieldType } from '../../../src/cci/cube/cciCube.definitions';

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Identity: Cube emitter events', () => {
  // This test suite handles Identity's impelementation of the CubeEmitter interface,
  // in particular the emission of cubeAdded events.

  let idTestOptions: IdentityOptions;
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    idTestOptions = {  // note that those are diferent for some tests further down
      minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
      requiredDifficulty: 0,  // no hash cash for testing
      argonCpuHardness: sodium.crypto_pwhash_OPSLIMIT_MIN,  // minimum hardness
      argonMemoryHardness: sodium.crypto_pwhash_MEMLIMIT_MIN,  // minimum hardness
    };
    cubeStore = new CubeStore(testCubeStoreParams);
    await cubeStore.readyPromise;
  });

  afterEach(async () => {
    await cubeStore.shutdown();
  });

  describe('cubeAdded event', () => {
    describe('events originating from this Identity itself', () => {
      let masterKey: Buffer;
      let id: Identity;

      beforeEach(async () => {
        // prepare an Identity
        masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
        id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
        id.name = "protagonista qui illas probationes pro nobis administrabit"
        // await id.store();  // Identity doesn't actually need to be in CubeStore for these tests
      });

      afterEach(async () => {
        id.identityStore.shutdown();
      });

      it('will emit cubeAdded if a new post is added', async () => {
        const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
          id.on('cubeAdded', (cubeInfo: CubeInfo) => resolve(cubeInfo));
        });

        const post: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Nuntius"),
        });
        await cubeStore.addCube(post);
        id.addPost(post.getKeyIfAvailable());

        const cubeInfo: CubeInfo = await eventPromise;
        expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
      });

      it('will emit cubeAdded if a new subscription is added', async () => {
        const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
          id.on('cubeAdded', (cubeInfo: CubeInfo) => resolve(cubeInfo));
        });

        const sub: cciCube = cciCube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: cciField.Payload("Subscriptio"),
        });
        await cubeStore.addCube(sub);
        id.addPublicSubscription(sub.getKeyIfAvailable());

        const cubeInfo: CubeInfo = await eventPromise;
        expect(cubeInfo.key.equals(sub.getKeyIfAvailable())).toBeTruthy();
      });

      it('will emit cubeAdded if the Identity\'s root Cube is updated', async () => {
        const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
          id.on('cubeAdded', (cubeInfo: CubeInfo) => resolve(cubeInfo));
        });

        id.name = "nomen mutatum";
        id.store();

        const cubeInfo: CubeInfo = await eventPromise;
        expect(cubeInfo.key.equals(id.key)).toBeTruthy();
        expect(cubeInfo.getCube().getFirstField(cciFieldType.USERNAME).valueString).toBe("nomen mutatum");
      });
    });

    describe('events originating from other Identities', () => {
      describe('events originating from directly subscribed Identities', () => {
        let masterKey: Buffer;
        let id: Identity;
        let directSub: Identity;

        beforeEach(async () => {
          // prepare an Identity
          masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
          id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
          id.name = "protagonista qui illas probationes pro nobis administrabit"
          // await id.store();  // not actually necessary for these tests

          // prepare another Identity to subscribe to
          directSub = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 137),
            idTestOptions,
          );
          directSub.name = "Subscriptio directa";
          // directSub.store();  // not actually necessary for these tests

          // Make our primary Identity subscribe to it.
          id.addPublicSubscription(directSub.key);

          // set recursion level
          await id.setSubscriptionRecursionDepth(1337);  // go DEEP!
        });

        afterEach(async () => {
          id.identityStore.shutdown();
        });

        it('will emit cubeAdded if a new post is added by a directly subscribed Identity', async () => {
          const post: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            id.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });
          directSub.addPost(post.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if a new subscription is added by a directly subscribed Identity', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            id.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(sub.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const sub: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio"),
          });
          await cubeStore.addCube(sub);
          directSub.addPublicSubscription(sub.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(sub.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if the Identity\'s root Cube is updated by a directly subscribed Identity', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            id.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(directSub.key)) resolve(cubeInfo);
            });
          });

          directSub.name = "nomen mutatum";
          directSub.store();

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(directSub.key)).toBeTruthy();
          expect(cubeInfo.getCube().getFirstField(cciFieldType.USERNAME).valueString).toBe("nomen mutatum");
        });

        it.todo('will also emit for a brand new subscription', async () => {
        });
      });  // events originating from directly subscribed Identities

      describe('events originating from indirectly subscribed Identities', () => {
        let masterKey: Buffer;
        let id: Identity;
        let directSub: Identity;
        let indirectSub: Identity;

        beforeEach(async () => {
          // prepare an Identity
          masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
          id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
          id.name = "protagonista qui illas probationes pro nobis administrabit"
          // await id.store();  // not actually necessary for these tests

          // prepare another Identity to subscribe to
          directSub = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 137),
            idTestOptions,
          );
          directSub.name = "Subscriptio directa";
          // directSub.store();  // not actually necessary for these tests

          // Make our primary Identity subscribe to it.
          id.addPublicSubscription(directSub.key);

          // set recursion level
          await id.setSubscriptionRecursionDepth(1337);  // go DEEP!

          // prepare another Identity to subscribe to
          indirectSub = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 138),
            idTestOptions,
          );
          indirectSub.name = "Subscriptio indirecta";
          // indirectSub.store();  // not actually necessary for these tests

          // Make our direct subscription subscribe to it.
          directSub.addPublicSubscription(indirectSub.key);
          // directSub.store();  // not actually necessary for these tests

          // set recursion level
          await id.setSubscriptionRecursionDepth(1337);  // go DEEP!
        });

        afterEach(async () => {
          id.identityStore.shutdown();
        });


        it('will emit cubeAdded if a new post is added by an indirectly subscribed Identity within the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            id.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const post: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          indirectSub.addPost(post.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if a new subscription is added by an indirectly subscribed Identity within the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            id.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(sub.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const sub: cciCube = cciCube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: cciField.Payload("Subscriptio"),
          });
          await cubeStore.addCube(sub);
          indirectSub.addPublicSubscription(sub.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(sub.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if the Identity\'s root Cube is updated by an indirectly subscribed Identity within the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            id.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(indirectSub.key)) resolve(cubeInfo);
            });
          });

          indirectSub.name = "nomen mutatum";
          indirectSub.store();

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(indirectSub.key)).toBeTruthy();
          expect(cubeInfo.getCube().getFirstField(cciFieldType.USERNAME).valueString).toBe("nomen mutatum");
        });

        it.todo('will also emit for a brand new indirect subscription caused by us subscribing to someone new', async () => {
        });

        it.todo('will also emit for a brand new indirect subscription cause by someone we\'re subscribed to subscribing to someone new', async () => {
        });
      });  // events originating from indirectly subscribed Identities

      describe('events occurring beyond the recursion limit', () => {
        it.todo('will not emit cubeAdded if a new post is added by an indirectly subscribed Identity beyond the recursion limit');
        it.todo('will not emit cubeAdded if a new subscription is added by an indirectly subscribed Identity beyond the recursion limit');
        it.todo('will not emit cubeAdded if the Identity\'s root Cube is updated by an indirectly subscribed Identity beyond the recursion limit');
      });

      describe('reducing the recursion level', () => {
        // This tests that re-emissions are properly cancelled when reducing
        // the recursion level.
        it.todo('will stop emitting events for indirect subscriptions after we reduce the recursion level to 1');
        it.todo('will not stop emitting events for direct subscriptions after we reduce the recursion level to 0');
      });
    });

    describe('avoiding endless recursion', () => {
      describe('subscribed to self', () => {
        let masterKey: Buffer;
        let id: Identity;

        beforeEach(async () => {
          // prepare an Identity
          masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
          id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
          id.name = "protagonista qui illas probationes pro nobis administrabit"
          // await id.store();
          // await new Promise(resolve => setTimeout(resolve, 1000));
        });

        afterEach(async () => {
          id.identityStore.shutdown();
        });

        it('will only emit once per new post if subscribed to itself', async () => {
          await id.store();
          // anticipante the expected event
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            id.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo && cubeInfo.key.equals(id.key)) {
                resolve(cubeInfo);
              }
            });
          });
          // create a second promise for the same event which must never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              id.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo.key.equals(id.key)) {
                  resolve(cubeInfo);
                }
              });
            })
          });

          id.addPublicSubscription(id.key);
          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(id.key)).toBeTruthy();

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });

        it.todo('will only emit once per new subscription if subscribed to itself');
      });  // subscribed to self

      describe('reciprocal subscriptions', () => {
        it.todo('will only emit once per new post on a directly circular subscriptions');
        it.todo('will only emit once per new subscription on a directly circular subscriptions');
        it.todo('will only emit once per Identity Cube change on a directly circular subscriptions');
      });

      describe('circular subscriptions', () => {
        it.todo('will only emit once per new post on an indirectly circular subscriptions');
        it.todo('will only emit once per new subscription on an indirectly circular subscriptions');
        it.todo('will only emit once per Identity Cube change on an indirectly circular subscriptions');
      });
    });

    describe('edge cases', () => {
      it.todo('will not resolve Cubes if there are no subscribers');
    });
  });  // cubeAdded event
});
