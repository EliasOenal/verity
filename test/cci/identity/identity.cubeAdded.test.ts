import { RecursiveEmitter } from '../../../src/core/helpers/recursiveEmitter';
import { CubeType } from '../../../src/core/cube/coreCube.definitions';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { IdentityOptions } from '../../../src/cci/identity/identity.definitions';
import { Identity } from '../../../src/cci/identity/identity'
import { Cube } from '../../../src/cci/cube/cube';
import { VerityField } from '../../../src/cci/cube/verityField';
import { FieldType } from '../../../src/cci/cube/cube.definitions';

import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Identity: emitting cubeAdded events', () => {
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

        const post: Cube = Cube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: VerityField.Payload("Nuntius"),
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

        const sub: Cube = Cube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: VerityField.Payload("Subscriptio"),
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
        expect(cubeInfo.getCube().getFirstField(FieldType.USERNAME).valueString).toBe("nomen mutatum");
      });
    });



    describe('events originating from other Identities', () => {
      describe('events originating from directly subscribed Identities', () => {
        let masterKey: Buffer;
        let id: Identity;
        let directSub: Identity;
        let emitter: RecursiveEmitter;

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
          emitter = id.getRecursiveEmitter({ depth: 1337, event: 'cubeAdded' });
        });

        afterEach(async () => {
          await id.identityStore.shutdown();
          await emitter.shutdown();
        });


        it('will emit cubeAdded if a new post is added by a directly subscribed Identity', async () => {
          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });
          directSub.addPost(post.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if a new subscription is added by a directly subscribed Identity', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(sub.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const sub: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Subscriptio"),
          });
          await cubeStore.addCube(sub);
          directSub.addPublicSubscription(sub.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(sub.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if the Identity\'s root Cube is updated by a directly subscribed Identity', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(directSub.key)) resolve(cubeInfo);
            });
          });

          directSub.name = "nomen mutatum";
          directSub.store();

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(directSub.key)).toBeTruthy();
          expect(cubeInfo.getCube().getFirstField(FieldType.USERNAME).valueString).toBe("nomen mutatum");
        });

        // This currently FAILS as Identity currently has no way to update
        // existing emitters
        it.todo('will also emit for a new post by a brand new subscription', async () => {
          // create a new Identity and subscribe to it
          const newSub: Identity = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 201),
            idTestOptions,
          );
          newSub.name = "Usor novus";
          await newSub.store();
          id.addPublicSubscription(newSub.key);

          // anticipate an event to be emitted for a new post by the new subscription
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          // have the newly subscribed-to user make a post
          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          newSub.addPost(post.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
        });
      });  // events originating from directly subscribed Identities



      describe('events originating from indirectly subscribed Identities', () => {
        let masterKey: Buffer;
        let id: Identity;
        let directSub: Identity;
        let indirectSub: Identity;
        let emitter: RecursiveEmitter;

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
          emitter = id.getRecursiveEmitter({ depth: 1337, event: 'cubeAdded' });
        });

        afterEach(async () => {
          await id.identityStore.shutdown();
          await emitter.shutdown();
        });


        it('will emit cubeAdded if a new post is added by an indirectly subscribed Identity within the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          indirectSub.addPost(post.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if a new subscription is added by an indirectly subscribed Identity within the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(sub.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const sub: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Subscriptio"),
          });
          await cubeStore.addCube(sub);
          indirectSub.addPublicSubscription(sub.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(sub.getKeyIfAvailable())).toBeTruthy();
        });

        it('will emit cubeAdded if the Identity\'s root Cube is updated by an indirectly subscribed Identity within the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(indirectSub.key)) resolve(cubeInfo);
            });
          });

          indirectSub.name = "nomen mutatum";
          indirectSub.store();

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(indirectSub.key)).toBeTruthy();
          expect(cubeInfo.getCube().getFirstField(FieldType.USERNAME).valueString).toBe("nomen mutatum");
        });

        // This currently FAILS as Identity currently has no way to update
        // existing emitters
        it.todo('will also emit for a new post by a brand new indirect subscription, caused by us subscribing to someone new', async () => {
          // create a new Identity, who is themselves subscribed to another
          // new Identity, and subscribe to it
          const newSub: Identity = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 201),
            idTestOptions,
          );
          newSub.name = "Usor novus";

          const newSubSub: Identity = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 202),
            idTestOptions,
          );
          newSubSub.name = "Usor novus indirecte subscriptus";
          await newSubSub.store();

          newSub.addPublicSubscription(newSubSub.key);
          await newSub.store();
          id.addPublicSubscription(newSub.key);

          // anticipate an event to be emitted for a new post by the new indirect subscription
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          // have the new indirectly-subscribed-to user make a post
          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          newSubSub.addPost(post.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
        });

        // This currently FAILS as Identity currently has no way to update
        // existing emitters
        it.todo('will also emit for a new post by a new indirect subscription, caused by someone we\'re subscribed to subscribing to someone new', async () => {
          // create a new Identity, who our directly-subscribed-to Identity
          // will then subscribe to
          const newSubSub: Identity = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 203),
            idTestOptions,
          );
          newSubSub.name = "Usor novus indirecte subscriptus";
          await newSubSub.store();

          directSub.addPublicSubscription(newSubSub.key);
          await directSub.store();

          // anticipate an event to be emitted for a new post by the new indirect subscription
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          // have the new indirectly-subscribed-to user make a post
          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          newSubSub.addPost(post.getKeyIfAvailable());

          const cubeInfo: CubeInfo = await eventPromise;
          expect(cubeInfo.key.equals(post.getKeyIfAvailable())).toBeTruthy();
        });
      });  // events originating from indirectly subscribed Identities



      describe('events occurring beyond the recursion limit', () => {
        let masterKey: Buffer;
        let id: Identity;
        let directSub: Identity;
        let indirectSub: Identity;
        let emitter: RecursiveEmitter;

        beforeEach(async () => {
          // prepare an Identity
          masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
          id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
          id.name = "protagonista qui illas probationes pro nobis administrabit"

          // Prepare another Identity to subscribe to
          directSub = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 137),
            idTestOptions,
          );
          directSub.name = "Subscriptio directa";
          // Make our primary Identity subscribe to it.
          id.addPublicSubscription(directSub.key);

          // Prepare another Identity to subscribe to
          indirectSub = new Identity(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 138),
            idTestOptions,
          );
          indirectSub.name = "Subscriptio indirecta";
          // Make our direct subscription subscribe to it.
          directSub.addPublicSubscription(indirectSub.key);

          // store all Identities
          await Promise.all([id.store(), directSub.store(), indirectSub.store()]);

          // set recursion level
          emitter = id.getRecursiveEmitter({ depth: 1, event: 'cubeAdded' });
        });

        afterEach(async () => {
          await id.identityStore.shutdown();
          await emitter.shutdown();
        });

        it('will not emit cubeAdded if a new post is added by an indirectly subscribed Identity beyond the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(post.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          indirectSub.addPost(post.getKeyIfAvailable());

          const timeout: Promise<CubeInfo|string> = new Promise((resolve) => {
            setTimeout(() => resolve("timeout"), 1000)});
          const resolved: CubeInfo|string = await Promise.race([eventPromise, timeout]);
          expect(resolved).toEqual("timeout");
        });

        it('will not emit cubeAdded if a new subscription is added by an indirectly subscribed Identity beyond the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(sub.getKeyIfAvailable())) resolve(cubeInfo);
            });
          });

          const sub: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Subscriptio"),
          });
          await cubeStore.addCube(sub);
          indirectSub.addPublicSubscription(sub.getKeyIfAvailable());

          const timeout: Promise<CubeInfo|string> = new Promise((resolve) => {
            setTimeout(() => resolve("timeout"), 1000)});
          const resolved: CubeInfo|string = await Promise.race([eventPromise, timeout]);
          expect(resolved).toEqual("timeout");
        });

        it('will not emit cubeAdded if the Identity\'s root Cube is updated by an indirectly subscribed Identity beyond the recursion limit', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(indirectSub.key)) resolve(cubeInfo);
            })
          });

          indirectSub.name = "nomen mutatum";
          indirectSub.store();

          const timeout: Promise<CubeInfo|string> = new Promise((resolve) => {
            setTimeout(() => resolve("timeout"), 1000)});
          const resolved: CubeInfo|string = await Promise.race([eventPromise, timeout]);
          expect(resolved).toEqual("timeout");
        });
      });
    });  // events originating from other Identities



    describe('avoiding endless recursion', () => {
      describe('subscribed to self', () => {
        let masterKey: Buffer;
        let id: Identity;
        let emitter: RecursiveEmitter;

        beforeEach(async () => {
          // prepare an Identity
          masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
          id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
          id.name = "protagonista qui illas probationes pro nobis administrabit"

          emitter = id.getRecursiveEmitter({ depth: 1337, event: 'cubeAdded' });

          // Store the Identity and anticipate the associated root Cube event
          const rootCubePromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo.key.equals(id.key)) resolve(cubeInfo);
            });
          })
          id.store();
          await rootCubePromise;
        });

        afterEach(async () => {
          await id.identityStore.shutdown();
          await emitter.shutdown();
        });


        it('will only emit once per new post if subscribed to itself', async () => {
          // anticipante the expected new post event
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(post.getKeyIfAvailable())) {
                resolve(cubeInfo);
              }
            });
          });
          // create a second promise for the same event which must never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(post.getKeyIfAvailable())) {
                  resolve(cubeInfo);
                }
              });
            })
          });

          // subscribe to self
          id.addPublicSubscription(id.key);

          // make a post
          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          id.addPost(post.getKeyIfAvailable());

          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(post.getKeyIfAvailable())).toBeTruthy();

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });


        it('will only emit once per new subscription if subscribed to itself', async () => {
          // anticipante the expected new subscription event
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(subId.key)) {
                resolve(cubeInfo);
              }
            });
          });
          // create a second promise for the same event which must never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(subId.key)) {
                  resolve(cubeInfo);
                }
              });
            })
          });

          // subscribe to self
          id.addPublicSubscription(id.key);

          // create a new Identity to subscribe to
          const subId: Identity = await Identity.Construct(
            cubeStore, Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 69), idTestOptions);
          subId.name = "Subscriptio";
          await subId.store();
          id.addPublicSubscription(subId.key);

          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(subId.key)).toBeTruthy();

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });
      });  // subscribed to self



      describe('reciprocal subscriptions', () => {
        let id1: Identity;
        let id2: Identity;
        let emitter: RecursiveEmitter;

        beforeEach(async () => {
          // prepare two Identities that will subscribe to each other
          id1 = await Identity.Construct(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42),
            idTestOptions);
          id1.name = "Identity 1";

          id2 = await Identity.Construct(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43),
            idTestOptions
          );
          id2.name = "Identity 2";

          // Create reciprocal subscriptions
          id1.addPublicSubscription(id2.key);
          id2.addPublicSubscription(id1.key);

          // Store both identities
          await Promise.all([id1.store(), id2.store()]);

          emitter = id1.getRecursiveEmitter({ depth: 1337, event: 'cubeAdded' });
        });

        afterEach(async () => {
          await id1.identityStore.shutdown();
          await emitter.shutdown();
        });

        it('will only emit once per new post on a directly circular subscriptions', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(post.getKeyIfAvailable())) {
                resolve(cubeInfo);
              }
            });
          });

          // Create a second promise that should never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(post.getKeyIfAvailable())) {
                  resolve(cubeInfo);
                }
              });
            });
          });

          // Create and add a post from id2
          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          id2.addPost(post.getKeyIfAvailable());

          // Verify we get exactly one event
          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(post.getKeyIfAvailable())).toBeTruthy();

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });

        it('will only emit once per new subscription on a directly circular subscriptions', async () => {
          // Create a new Identity to subscribe to
          const newId: Identity = await Identity.Construct(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44),
            idTestOptions
          );
          newId.name = "New Identity";
          await newId.store();

          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(newId.key)) {
                resolve(cubeInfo);
              }
            });
          });

          // Create a second promise that should never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(newId.key)) {
                  resolve(cubeInfo);
                }
              });
            });
          });

          // Add subscription from id2
          id2.addPublicSubscription(newId.key);

          // Verify we get exactly one event
          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(newId.key)).toBeTruthy();

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });

        it('will only emit once per Identity Cube change on a directly circular subscriptions', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(id2.key)) {
                resolve(cubeInfo);
              }
            });
          });

          // Create a second promise that should never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(id2.key)) {
                  resolve(cubeInfo);
                }
              });
            });
          });

          // Change id2's name
          id2.name = "Identity 2 Updated";
          await id2.store();

          // Verify we get exactly one event
          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(id2.key)).toBeTruthy();
          expect(emitted.getCube().getFirstField(FieldType.USERNAME).valueString)
            .toBe("Identity 2 Updated");

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });
      });



      describe('circular subscriptions', () => {
        let id1: Identity;
        let id2: Identity;
        let id3: Identity;
        let emitter: RecursiveEmitter;

        beforeEach(async () => {
          // Create 3 identities in a circular subscription chain
          id1 = await Identity.Construct(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42),
            idTestOptions
          );
          id1.name = "Identity 1";

          id2 = await Identity.Construct(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43),
            idTestOptions
          );
          id2.name = "Identity 2";

          id3 = await Identity.Construct(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44),
            idTestOptions
          );
          id3.name = "Identity 3";

          // Create circular subscriptions: 1 -> 2 -> 3 -> 1
          id1.addPublicSubscription(id2.key);
          id2.addPublicSubscription(id3.key);
          id3.addPublicSubscription(id1.key);

          // Store all identities
          await Promise.all([id1.store(), id2.store(), id3.store()]);

          emitter = id1.getRecursiveEmitter({ depth: 1337, event: 'cubeAdded' });
        });

        afterEach(async () => {
          await id1.identityStore.shutdown();
          await emitter.shutdown();
        });


        it('will only emit once per new post on an indirectly circular subscriptions', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(post.getKeyIfAvailable())) {
                resolve(cubeInfo);
              }
            });
          });

          // Create a second promise that should never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(post.getKeyIfAvailable())) {
                  resolve(cubeInfo);
                }
              });
            });
          });

          // Create and add a post from id3
          const post: Cube = Cube.Create({
            cubeType: CubeType.PIC,
            requiredDifficulty: 0,
            fields: VerityField.Payload("Nuntius"),
          });
          await cubeStore.addCube(post);
          id3.addPost(post.getKeyIfAvailable());

          // Verify we get exactly one event
          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(post.getKeyIfAvailable())).toBeTruthy();

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });


        it('will only emit once per new subscription on an indirectly circular subscriptions', async () => {
          // Create a new Identity to subscribe to
          const newId: Identity = await Identity.Construct(
            cubeStore,
            Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 45),
            idTestOptions
          );
          newId.name = "New Identity";
          await newId.store();

          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(newId.key)) {
                resolve(cubeInfo);
              }
            });
          });

          // Create a second promise that should never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(newId.key)) {
                  resolve(cubeInfo);
                }
              });
            });
          });

          // Add subscription from id3
          id3.addPublicSubscription(newId.key);

          // Verify we get exactly one event
          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(newId.key)).toBeTruthy();

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });


        it('will only emit once per Identity Cube change on an indirectly circular subscriptions', async () => {
          const eventPromise: Promise<CubeInfo> = new Promise((resolve) => {
            emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
              if (cubeInfo?.key && cubeInfo.key.equals(id3.key)) {
                resolve(cubeInfo);
              }
            });
          });

          // Create a second promise that should never resolve
          const shouldNotHappen: Promise<CubeInfo> = new Promise((resolve) => {
            eventPromise.then(() => {
              emitter.on('cubeAdded', (cubeInfo: CubeInfo) => {
                if (cubeInfo?.key && cubeInfo.key.equals(id3.key)) {
                  resolve(cubeInfo);
                }
              });
            });
          });

          // Change id3's name
          id3.name = "Identity 3 Updated";
          await id3.store();

          // Verify we get exactly one event
          const emitted: CubeInfo = await eventPromise;
          expect(emitted.key.equals(id3.key)).toBeTruthy();
          expect(emitted.getCube().getFirstField(FieldType.USERNAME).valueString)
            .toBe("Identity 3 Updated");

          const timeout: Promise<string> = new Promise((resolve) =>
            setTimeout(() => {resolve("timeout")}, 1000));
          const result: string|CubeInfo = await Promise.race([timeout, shouldNotHappen]);
          expect(result).toEqual("timeout");
        });
      });
    });



    describe('edge cases', () => {
      it('will not create CubeInfos if there are no subscribers', async () => {
        const masterKey = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
        const id = await Identity.Construct(cubeStore, masterKey, idTestOptions);
        id.name = "protagonista qui illas probationes pro nobis administrabit"

        // Create a post
        const post: Cube = Cube.Create({
          cubeType: CubeType.PIC,
          requiredDifficulty: 0,
          fields: VerityField.Payload("Nuntius"),
        });
        await cubeStore.addCube(post);

        // Spy on the CubeStore's getCubeInfo method
        const getCubeInfoSpy = vi.spyOn(cubeStore, 'getCubeInfo');

        // Add the post without any event listeners
        id.addPost(post.getKeyIfAvailable());

        // Verify that no CubeInfo was created
        expect(getCubeInfoSpy).not.toHaveBeenCalled();

        await id.identityStore.shutdown();
        getCubeInfoSpy.mockRestore();
      });
    });
  });  // cubeAdded event
});
