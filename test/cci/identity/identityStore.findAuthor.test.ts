import { CubeStore } from '../../../src/core/cube/cubeStore';

import { Cube } from '../../../src/cci/cube/cube';
import { VerityField } from '../../../src/cci/cube/verityField';
import { RelationshipType } from '../../../src/cci/cube/relationship';
import { Identity } from '../../../src/cci/identity/identity';
import { IdentityStore } from '../../../src/cci/identity/identityStore';
import { dummyVerityNode, VerityNodeIf } from '../../../src/cci/verityNode';

import { idTestOptions, passiveIdTestOptions, testCciOptions, testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('IdentityStore.findAuthor()', () => {
  let cubeStore: CubeStore;
  let identityStore: IdentityStore;
  const masterKey: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42);
  let author: Identity;
  let notification: Cube;

  let result: Identity;

  beforeAll(async () => {
    await sodium.ready;
  });

  describe('immediate confirmation for author already in store', () => {
    beforeAll(async () => {
      // set up framework
      cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      identityStore = new IdentityStore(cubeStore);

      // create author and notification
      author = new Identity(cubeStore, masterKey, {
        ...passiveIdTestOptions, identityStore,
      });
      notification = Cube.Create({
        fields: VerityField.RelatesTo(
          RelationshipType.AUTHORHINT,
          author.key
        )
      });
      await cubeStore.addCube(notification);
      author.addPost(notification.getKeyIfAvailable());
      await author.store();

      // run test
      result = await identityStore.findAuthor(notification).promise;
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      await identityStore.shutdown();
    });

    it('resolves the author to the exact Identity object in store', async () => {
      expect(result).toBe(author);
    });
  });

  describe('immediate confirmation for author not yet in store', () => {
    beforeAll(async () => {
      // set up framework
      cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      identityStore = new IdentityStore(cubeStore);

      // create author and notification;
      // ensure author is not added to the Identity store
      delete passiveIdTestOptions.identityStore;
      author = new Identity(cubeStore, masterKey, {
        ...passiveIdTestOptions
      });
      notification = Cube.Create({
        fields: VerityField.RelatesTo(
          RelationshipType.AUTHORHINT,
          author.key
        )
      });
      await cubeStore.addCube(notification);
      author.addPost(notification.getKeyIfAvailable());
      await author.store();

      // verify test setup
      expect(identityStore.getIdentity(author.keyString)).toBeUndefined();

      // run test
      result = await identityStore.findAuthor(notification).promise;
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      await identityStore.shutdown();
    });

    it('resolves the author', () => {
      expect(result.keyString).toEqual(author.keyString);
      expect(result.hasPost(notification.getKeyIfAvailable())).toBeTruthy();
    });

    it('created a new Identity object for the author, as the original was not in store', async () => {
      expect(result).not.toBe(author);
    });
  });

  describe('deferred confirmation for author already in store', () => {
    beforeAll(async () => {
      // set up framework
      cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      identityStore = new IdentityStore(cubeStore);

      // create author
      author = new Identity(cubeStore, masterKey, {
        ...passiveIdTestOptions, identityStore,
      });
      await author.store();

      // create notification, but don't add it yet
      notification = Cube.Create({
        fields: VerityField.RelatesTo(
          RelationshipType.AUTHORHINT,
          author.key
        )
      });
      await cubeStore.addCube(notification);

      // verify test setup:
      // - author is in store
      expect(identityStore.getIdentity(author.keyString)).toBe(author);
      // - author has not claimed the notification yet
      expect(author.hasPost(notification.getKeyIfAvailable())).toBeFalsy();

      // run test
      const resultPromise = identityStore.findAuthor(notification).promise;

      // wait a little to make sure this is actually deferred
      await new Promise((resolve) => setTimeout(resolve, 100));

      // have the author claim the notification only after the test has started
      author.addPost(notification.getKeyIfAvailable());

      // test should complete now
      result = await resultPromise;
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      await identityStore.shutdown();
    });

    it('resolves the author to the exact Identity object in store', async () => {
      expect(result).toBe(author);
    });
  });

  describe('deferred confirmation for author not yet in store', () => {
    beforeAll(async () => {
      // set up framework
      cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      identityStore = new IdentityStore(cubeStore);

      // create author, and ensure it is *not* added to the Identity store
      delete idTestOptions.identityStore;
      author = new Identity(cubeStore, masterKey, {
        // note: must not use passive ID options as in this test, the author's
        //   Identity object tested will not be the same object as the one we're
        //   using during setup, and the author later claiming the notification
        //   must propagate to the tested Identity object through regular
        //   Verity marshalling/demarshalling, same as it would be in a real
        //   world use case
        ...idTestOptions
      });
      // create notification, but don't have the author claim it yet
      notification = Cube.Create({
        fields: VerityField.RelatesTo(
          RelationshipType.AUTHORHINT,
          author.key
        )
      });
      await cubeStore.addCube(notification);
      await author.store();

      // verify test setup:
      // - author is not in the IdentityStore
      expect(identityStore.getIdentity(author.keyString)).toBeUndefined();
      // - author has not claimed the notification yet
      expect(author.hasPost(notification.getKeyIfAvailable())).toBeFalsy();

      // run test
      const resultPromise = identityStore.findAuthor(notification).promise;

      // wait a little to make sure this is actually deferred
      await new Promise((resolve) => setTimeout(resolve, 100));

      // have the author claim the notification only after the test has started
      author.addPost(notification.getKeyIfAvailable());
      // need to re-store so the claim can propage to author's the *different*
      //   Identity object tested
      await author.store();

      // test should complete now
      result = await resultPromise;
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      await identityStore.shutdown();
    });

    it('resolves the author', () => {
      expect(result.keyString).toEqual(author.keyString);
      expect(result.hasPost(notification.getKeyIfAvailable())).toBeTruthy();
    });

    it('created a new Identity object for the author, as the original was not in store', async () => {
      expect(result).not.toBe(author);
    });
  });

  describe('deferred confirmation for author not immediately retrievable, confirmed immediately once retrieved', () => {
    beforeAll(async () => {
      // set up framework --
      // as we're dealing with not immediately retrievable Cubes in this test
      // scenario we do meet a CubeRetriever, so we'll set up a full dummy node
      const node: VerityNodeIf = dummyVerityNode(testCciOptions);
      cubeStore = node.cubeStore;
      await node.readyPromise;
      identityStore = new IdentityStore(node.veritumRetriever);

      // create author, ensure it is *not* added to the Identity store,
      // and do *not* store (marshall) it yet -- this creates the "not immediately
      // retrievable" part of the test scenario
      delete idTestOptions.identityStore;
      author = new Identity(node.veritumRetriever, masterKey, {
        // note: must not use passive ID options as in this test, the author's
        //   Identity object tested will not be the same object as the one we're
        //   using during setup, and the author later claiming the notification
        //   must propagate to the tested Identity object through regular
        //   Verity marshalling/demarshalling, same as it would be in a real
        //   world use case
        ...idTestOptions
      });
      // create notification, which the author immediately claims
      notification = Cube.Create({
        fields: VerityField.RelatesTo(
          RelationshipType.AUTHORHINT,
          author.key
        )
      });
      await cubeStore.addCube(notification);
      author.addPost(notification.getKeyIfAvailable());

      // verify test setup:
      // - author is not in the IdentityStore
      expect(identityStore.getIdentity(author.keyString)).toBeUndefined();
      // - author's Identity root is not yet available in CubeStore either
      expect(await cubeStore.getCube(author.key)).toBeUndefined();
      // - author has claimed the notification
      expect(author.hasPost(notification.getKeyIfAvailable())).toBeTruthy();

      // run test
      const resultPromise = identityStore.findAuthor(notification).promise;

      // wait a little to make sure this is actually deferred
      await new Promise((resolve) => setTimeout(resolve, 200));

      // make the author available for unmarshalling only after the test has stared
      await author.store();

      // test should complete now
      result = await resultPromise;
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      await identityStore.shutdown();
    });

    it('resolves the author', () => {
      expect(result.keyString).toEqual(author.keyString);
      expect(result.hasPost(notification.getKeyIfAvailable())).toBeTruthy();
    });

    it('created a new Identity object for the author, as the original was not in store', async () => {
      expect(result).not.toBe(author);
    });
  });

  describe('deferred confirmation for author not immediately retrievable, confirmation still deferred after author retrieved', () => {
    beforeAll(async () => {
      // set up framework --
      // as we're dealing with not immediately retrievable Cubes in this test
      // scenario we do meet a CubeRetriever, so we'll set up a full dummy node
      const node: VerityNodeIf = dummyVerityNode(testCciOptions);
      cubeStore = node.cubeStore;
      await node.readyPromise;
      identityStore = new IdentityStore(node.veritumRetriever);

      // create author, ensure it is *not* added to the Identity store,
      // and do *not* store (marshall) it yet -- this creates the "not immediately
      // retrievable" part of the test scenario
      delete idTestOptions.identityStore;
      author = new Identity(node.veritumRetriever, masterKey, {
        // note: must not use passive ID options as in this test, the author's
        //   Identity object tested will not be the same object as the one we're
        //   using during setup, and the author later claiming the notification
        //   must propagate to the tested Identity object through regular
        //   Verity marshalling/demarshalling, same as it would be in a real
        //   world use case
        ...idTestOptions
      });
      // create notification, but don't have the author claim it yet
      notification = Cube.Create({
        fields: VerityField.RelatesTo(
          RelationshipType.AUTHORHINT,
          author.key
        )
      });
      await cubeStore.addCube(notification);

      // verify test setup:
      // - author is not in the IdentityStore
      expect(identityStore.getIdentity(author.keyString)).toBeUndefined();
      // - author's Identity root is not yet available in CubeStore either
      expect(await cubeStore.getCube(author.key)).toBeUndefined();
      // - author has not claimed the notification yet
      expect(author.hasPost(notification.getKeyIfAvailable())).toBeFalsy();

      // run test
      const resultPromise = identityStore.findAuthor(notification).promise;

      // wait a little to make sure this is actually deferred
      await new Promise((resolve) => setTimeout(resolve, 200));

      // make the author available for unmarshalling only after the test has stared
      await author.store();

      // even not the author has still now claimed the post;
      // wait a little more to make sure this is actually deferred
      await new Promise((resolve) => setTimeout(resolve, 200));

      // have the author claim the notification only after the test has started
      author.addPost(notification.getKeyIfAvailable());
      // need to re-store so the claim can propage to author's the *different*
      //   Identity object tested
      await author.store();

      // test should complete now
      result = await resultPromise;
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      await identityStore.shutdown();
    });

    it('resolves the author', () => {
      expect(result.keyString).toEqual(author.keyString);
      expect(result.hasPost(notification.getKeyIfAvailable())).toBeTruthy();
    });

    it('created a new Identity object for the author, as the original was not in store', async () => {
      expect(result).not.toBe(author);
    });
  });

  describe('error handling', () => {
    beforeAll(async () => {
      // set up framework
      cubeStore = new CubeStore(testCubeStoreParams);
      await cubeStore.readyPromise;
      identityStore = new IdentityStore(cubeStore);
    });

    afterAll(async () => {
      await cubeStore.shutdown();
      await identityStore.shutdown();
    });

    it('resolves undefined for undefined notification keys', async () => {
      // create a Cube but don't compile it; that means it doesn't know
      // its key yet
      notification = Cube.Create({
        fields: VerityField.RelatesTo(RelationshipType.AUTHORHINT, author.key
      )});

      // run test
      result = await identityStore.findAuthor(notification).promise;
      expect(result).toBeUndefined();
    });

    it('resolves undefined for notifications lacking an AUTHORHINT', async() => {
      // create and compile a notification without an AUTHORHINT
      notification = Cube.Create({
        fields: VerityField.Payload('Testing')
      });
      await notification.compile();
      // verify this Cube knows its key
      expect(Buffer.isBuffer(notification.getKeyIfAvailable())).toBeTruthy();

      // run test
      result = await identityStore.findAuthor(notification).promise;
      expect(result).toBeUndefined();
    });
  });
});
