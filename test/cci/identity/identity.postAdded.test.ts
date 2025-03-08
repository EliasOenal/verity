import { IdentityOptions, PostFormat } from '../../../src/cci/identity/identity';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { Veritable } from '../../../src/core/cube/veritable.definition';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { TestWorld } from '../../app/zw/testWorld';
import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

function hasPost(list: Veritable[], post: Veritable): boolean {
  if (list.some(item => item.getKeyStringIfAvailable() === post.getKeyStringIfAvailable())) return true;
  else return false;
}

describe('Identity: emitting postAdded events', () => {
  let idTestOptions: IdentityOptions;
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    idTestOptions = {
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

  for (const lvl of [0, 1, 2, 3, 1337]) {
    describe(`recursion level ${lvl} correctness`, () => {
      let w: TestWorld;
      let posts: Veritable[];

      const handler = (post: Veritable) => posts.push(post);

      beforeAll(async () => {
        // prepare test data
        w = new TestWorld();
        w.createIdentities();
        w.makeSubscriptions();

        // set recursion level
        w.protagonist.setSubscriptionRecursionDepth(lvl);

        // set up test listener
        posts = [];
        w.protagonist.on('postAdded', handler);

        // run test
        await w.makePosts();
      });

      afterAll(async () => {
        w.protagonist.removeListener('postAdded', handler);
        await w.protagonist.identityStore.shutdown();
      });

      it('should emit my own root posts', () => {
        expect(hasPost(posts, w.own)).toBe(true);
      });

      if (lvl > 0) it("should emit my 1st level subscription's posts", () => {
        expect(hasPost(posts, w.directUnreplied)).toBe(true);
      });
      else it("should NOT emit my 1st level subscription's posts", () => {
        expect(hasPost(posts, w.directUnreplied)).toBe(false);
      });

      if (lvl > 1) it("should emit my 2nd level subscription's root posts", () => {
        expect(hasPost(posts, w.indirectUnreplied)).toBe(true);
      });
      else it("should NOT emit my 2nd level subscription's root posts", () => {
        expect(hasPost(posts, w.indirectUnreplied)).toBe(false);
      });

      if (lvl > 2) it("should emit my 3rd level subscription's root posts", () => {
        expect(hasPost(posts, w.thirdUnreplied)).toBe(true);
      });
      else it("should NOT emit my 3rd level subscription's root posts", () => {
        expect(hasPost(posts, w.thirdUnreplied)).toBe(false);
      });

      it("should emit my own replies to direct subscription's posts", async () => {
        expect(hasPost(posts, w.directOwn)).toBe(true);
      });

      it("should emit my own replies to indirect subscription's posts", async () => {
        expect(hasPost(posts, w.indirectOwn)).toBe(true);
        expect(hasPost(posts, w.thirdOwn)).toBe(true);
      });

      if (lvl > 0) it("should emit my direct subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.ownDirect)).toBe(true);
      });
      else it("should NOT emit my direct subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.ownDirect)).toBe(false);
      });

      if (lvl > 1) it("should emit my 2nd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.ownIndirect)).toBe(true);
      });
      else it("should NOT emit my 2nd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.ownIndirect)).toBe(false);
      });

      if (lvl > 2) it("should emit my 3rd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.ownThird)).toBe(true);
      });
      else it("should NOT emit my 3rd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.ownThird)).toBe(false);
      });

      if (lvl > 2) it("should include 3rd level replies to my 1st level subscription's posts", async () => {
        expect(hasPost(posts, w.directThird)).toBe(true);
      });
      else it("should NOT include 3rd level replies to my 1st level subscription's posts", async () => {
        expect(hasPost(posts, w.directThird)).toBe(false);
      });

      it('should NOT include root posts by non-subscribed users', async () => {
        expect(hasPost(posts, w.unrelatedUnanswered)).toBe(false);
      });

      it('should NOT include replies by non-subscribed users', async () => {
        expect(hasPost(posts, w.ownUnrelatedUnanswered)).toBe(false);
      });

      it('should NOT include posts by non-subscribed users even if subscribed users answered them', async () => {
        expect(hasPost(posts, w.ownUnrelatedAnswered)).toBe(false);
      });

      it('should NOT include posts by non-subscribed users even if I answered them', async () => {
        expect(hasPost(posts, w.unrelatedAnsweredByProtagonist)).toBe(false);
      });

      if (lvl > 0) it("should include my 1st level subscription's replies to non-subscribed users", async () => {
        expect(hasPost(posts, w.unrelatedSub)).toBe(true);
        expect(hasPost(posts, w.ownUnrelatedSub)).toBe(true);
      });
      else it("should NOT include my 1st level subscription's replies to non-subscribed users", async () => {
        expect(hasPost(posts, w.unrelatedSub)).toBe(false);
        expect(hasPost(posts, w.ownUnrelatedSub)).toBe(false);
      });

      it("should include my own replies to non-subscribed users", async () => {
        expect(hasPost(posts, w.unrelatedOwn)).toBe(true);
      });

      if (lvl > 1) it("should include my 2nd level sub's replies to unavailable posts", async () => {
        expect(hasPost(posts, w.subUnavailableIndirect)).toBe(true);
      });
      else it("should NOT include my 2nd level sub's replies to unavailable posts", async () => {
        expect(hasPost(posts, w.subUnavailableIndirect)).toBe(false);
      });
    });  // recursion level ${lvl} correctness
  }  // recursion level for loop

  describe.todo('reducing the recursion level');

  describe('feature auto-disable', () => {
    it.todo('will not resolve posts if there are no subscribers');
    // TODO FIXME: even when recursion level > 0 no post retrieval should take place
    //   if there are no subscribers; this currently does not work because
    //   the root Identity is always subscribed on recursion level > 0
    //   even if it has no subscribers itself :-/
  });
});
