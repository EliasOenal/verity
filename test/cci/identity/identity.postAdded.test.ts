import { Identity, IdentityOptions, PostFormat, PostInfo } from '../../../src/cci/identity/identity';
import { Veritum } from '../../../src/cci/veritum/veritum';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { Veritable } from '../../../src/core/cube/veritable.definition';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { TestWordPostSet, TestWorld } from '../../app/zw/testWorld';
import { testCubeStoreParams } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

function hasPost(list: PostInfo<Veritum>[], post: Veritable, author?: Identity): boolean {
  if (list.some(item => (
    item.post.getKeyStringIfAvailable() === post.getKeyStringIfAvailable() &&
    (author? item.author.keyString === author.keyString : true)
  ))) return true;
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
      let posts: PostInfo<Veritum>[];

      const handler: (postInfo: PostInfo<Veritum>) => void =
        (postInfo: PostInfo<Veritum>) => posts.push(postInfo);

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
        w.posts = [new TestWordPostSet(w, "")];
        await w.posts[0].makePosts();
      });

      afterAll(async () => {
        w.protagonist.removeListener('postAdded', handler);
        await w.protagonist.identityStore.shutdown();
      });

      it('should emit my own root posts', () => {
        expect(hasPost(posts, w.posts[0].own, w.protagonist)).toBe(true);
      });

      if (lvl > 0) it("should emit my 1st level subscription's posts", () => {
        expect(hasPost(posts, w.posts[0].directUnreplied, w.directSub)).toBe(true);
      });
      else it("should NOT emit my 1st level subscription's posts", () => {
        expect(hasPost(posts, w.posts[0].directUnreplied)).toBe(false);
      });

      if (lvl > 1) it("should emit my 2nd level subscription's root posts", () => {
        expect(hasPost(posts, w.posts[0].indirectUnreplied, w.indirectSub)).toBe(true);
      });
      else it("should NOT emit my 2nd level subscription's root posts", () => {
        expect(hasPost(posts, w.posts[0].indirectUnreplied)).toBe(false);
      });

      if (lvl > 2) it("should emit my 3rd level subscription's root posts", () => {
        expect(hasPost(posts, w.posts[0].thirdUnreplied, w.thirdLevelSub)).toBe(true);
      });
      else it("should NOT emit my 3rd level subscription's root posts", () => {
        expect(hasPost(posts, w.posts[0].thirdUnreplied, w.thirdLevelSub)).toBe(false);
      });

      it("should emit my own replies to direct subscription's posts", async () => {
        expect(hasPost(posts, w.posts[0].directOwn, w.protagonist)).toBe(true);
      });

      it("should emit my own replies to indirect subscription's posts", async () => {
        expect(hasPost(posts, w.posts[0].indirectOwn, w.protagonist)).toBe(true);
        expect(hasPost(posts, w.posts[0].thirdOwn, w.protagonist)).toBe(true);
      });

      if (lvl > 0) it("should emit my direct subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.posts[0].ownDirect, w.directSub)).toBe(true);
      });
      else it("should NOT emit my direct subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.posts[0].ownDirect)).toBe(false);
      });

      if (lvl > 1) it("should emit my 2nd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.posts[0].ownIndirect, w.indirectSub)).toBe(true);
      });
      else it("should NOT emit my 2nd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.posts[0].ownIndirect)).toBe(false);
      });

      if (lvl > 2) it("should emit my 3rd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.posts[0].ownThird, w.thirdLevelSub)).toBe(true);
      });
      else it("should NOT emit my 3rd level subscription's replies to my own posts", async () => {
        expect(hasPost(posts, w.posts[0].ownThird)).toBe(false);
      });

      if (lvl > 2) it("should include 3rd level replies to my 1st level subscription's posts", async () => {
        expect(hasPost(posts, w.posts[0].directThird, w.thirdLevelSub)).toBe(true);
      });
      else it("should NOT include 3rd level replies to my 1st level subscription's posts", async () => {
        expect(hasPost(posts, w.posts[0].directThird)).toBe(false);
      });

      it('should NOT include root posts by non-subscribed users', async () => {
        expect(hasPost(posts, w.posts[0].unrelatedUnanswered)).toBe(false);
      });

      it('should NOT include replies by non-subscribed users', async () => {
        expect(hasPost(posts, w.posts[0].ownUnrelatedUnanswered)).toBe(false);
      });

      it('should NOT include posts by non-subscribed users even if subscribed users answered them', async () => {
        expect(hasPost(posts, w.posts[0].ownUnrelatedAnswered)).toBe(false);
      });

      it('should NOT include posts by non-subscribed users even if I answered them', async () => {
        expect(hasPost(posts, w.posts[0].unrelatedAnsweredByProtagonist)).toBe(false);
      });

      if (lvl > 0) it("should include my 1st level subscription's replies to non-subscribed users", async () => {
        expect(hasPost(posts, w.posts[0].unrelatedSub, w.directSub)).toBe(true);
        expect(hasPost(posts, w.posts[0].ownUnrelatedSub, w.directSub)).toBe(true);
      });
      else it("should NOT include my 1st level subscription's replies to non-subscribed users", async () => {
        expect(hasPost(posts, w.posts[0].unrelatedSub)).toBe(false);
        expect(hasPost(posts, w.posts[0].ownUnrelatedSub)).toBe(false);
      });

      it("should include my own replies to non-subscribed users", async () => {
        expect(hasPost(posts, w.posts[0].unrelatedOwn, w.protagonist)).toBe(true);
      });

      if (lvl > 1) it("should include my 2nd level sub's replies to unavailable posts", async () => {
        expect(hasPost(posts, w.posts[0].subUnavailableIndirect, w.indirectSub)).toBe(true);
      });
      else it("should NOT include my 2nd level sub's replies to unavailable posts", async () => {
        expect(hasPost(posts, w.posts[0].subUnavailableIndirect)).toBe(false);
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
