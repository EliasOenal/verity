import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { Veritable } from '../../../src/core/cube/veritable.definition';
import { PostFormat } from '../../../src/cci/identity/identity';

// TODO: Don't use test setups from ZW for CCI components, it breaks our layering
import { TestWordPostSet, TestWorld } from '../../app/zw/testWorld';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

function hasPost(list: Veritable[], post: Veritable): boolean {
  if (list.some(item => item.getKeyStringIfAvailable() === post.getKeyStringIfAvailable())) return true;
  else return false;
}

describe('Identity: getPosts generator; recursive retrieval of own posts and posts by subscribed authors', () => {
  // This also tests "subscription mode", i.e. retrieving through an endless AsyncGenerator

  describe('Veritum output format', () => {
    for (const lvl of [0, 1, 2, 3, 1337]) describe (`recursion level ${lvl}`, () => {
      let w: TestWorld;
      let posts: Veritable[];

      beforeAll(async () => {
        w = new TestWorld({ subscriptions: true, notifications: false });
        await w.setup();
        await w.protagonist.setSubscriptionRecursionDepth(lvl);
        posts = await ArrayFromAsync(w.protagonist.getPosts({
          format: PostFormat.Veritum,
          subscribe: true,
        }));
      });

      function testPostBunch(n: number = 0) {
        it('should include my own root posts', () => {
          expect(hasPost(posts, w.posts[n].own)).toBe(true);
        });

        if (lvl > 0) it("should include my 1st level subscription's posts", () => {
          expect(hasPost(posts, w.posts[n].directUnreplied)).toBe(true);
        });
        else it("should NOT include my 1st level subscription's posts", () => {
          expect(hasPost(posts, w.posts[n].directUnreplied)).toBe(false);
        });

        if (lvl > 1) it("should include my 2nd level subscription's posts", () => {
          expect(hasPost(posts, w.posts[n].indirectUnreplied)).toBe(true);
        });
        else it("should NOT include my 2nd level subscription's posts", () => {
          expect(hasPost(posts, w.posts[n].indirectUnreplied)).toBe(false);
        });

        if (lvl > 2) it("should include my 3rd level subscription's posts", () => {
          expect(hasPost(posts, w.posts[n].thirdUnreplied)).toBe(true);
        });
        else it("should NOT include my 3rd level subscription's posts", () => {
          expect(hasPost(posts, w.posts[n].thirdUnreplied)).toBe(false);
        });

        it("should include my own replies to direct subscription's posts", async () => {
          expect(hasPost(posts, w.posts[n].directOwn)).toBe(true);
        });

        it("should include my own replies to indirect subscription's posts", async () => {
          expect(hasPost(posts, w.posts[n].indirectOwn)).toBe(true);
          expect(hasPost(posts, w.posts[n].thirdOwn)).toBe(true);
        });

        if (lvl > 0) it("should include my 1st level subscription's replies to my own posts", async () => {
          expect(hasPost(posts, w.posts[n].ownDirect)).toBe(true);
        });
        else it("should NOT include my 1st level subscription's replies to my own posts", async () => {
          expect(hasPost(posts, w.posts[n].ownDirect)).toBe(false);
        });

        if (lvl > 1) it("should include my 2nd level subscription's replies to my own posts", async () => {
          expect(hasPost(posts, w.posts[n].ownIndirect)).toBe(true);
        });
        else it("should NOT include my 2nd level subscription's replies to my own posts", async () => {
          expect(hasPost(posts, w.posts[n].ownIndirect)).toBe(false);
        });

        if (lvl > 2) it("should include my 3rd level subscription's replies to my own posts", async () => {
          expect(hasPost(posts, w.posts[n].ownThird)).toBe(true);
        });
        else it("should NOT include my 3rd level subscription's replies to my own posts", async () => {
          expect(hasPost(posts, w.posts[n].ownThird)).toBe(false);
        });

        if (lvl > 2) it("should include my 3rd level subscription's replies to my subscription's posts", async () => {
          expect(hasPost(posts, w.posts[n].directThird)).toBe(true);
        });
        else it("should NOT include my 3rd level subscription's replies to my subscription's posts", async () => {
          expect(hasPost(posts, w.posts[n].directThird)).toBe(false);
        });

        it('should NOT include root posts by non-subscribed users', async () => {
          expect(hasPost(posts, w.posts[n].unrelatedUnanswered)).toBe(false);
        });

        it('should NOT include replies by non-subscribed users', async () => {
          expect(hasPost(posts, w.posts[n].ownUnrelatedUnanswered)).toBe(false);
        });

        it('should NOT include posts by non-subscribed users even if subscribed users answered them', async () => {
          expect(hasPost(posts, w.posts[n].ownUnrelatedAnswered)).toBe(false);
        });

        it('should NOT include posts by non-subscribed users even if I answered them', async () => {
          expect(hasPost(posts, w.posts[n].unrelatedAnsweredByProtagonist)).toBe(false);
        });

        if (lvl > 0) it("should include my 1st level subscription's replies to non-subscribed users", async () => {
          expect(hasPost(posts, w.posts[n].unrelatedSub)).toBe(true);
          expect(hasPost(posts, w.posts[n].ownUnrelatedSub)).toBe(true);
        });
        else it("should NOT include my 1st level subscription's replies to non-subscribed users", async () => {
          expect(hasPost(posts, w.posts[n].unrelatedSub)).toBe(false);
          expect(hasPost(posts, w.posts[n].ownUnrelatedSub)).toBe(false);
        });

        it("should include my own replies to non-subscribed users", async () => {
          expect(hasPost(posts, w.posts[n].unrelatedOwn)).toBe(true);
        });

        if (lvl > 1) it("should include 2nd level replies to unavailable posts", async () => {
          expect(hasPost(posts, w.posts[n].subUnavailableIndirect)).toBe(true);
        });
        else it("should NOT include 2nd level replies to unavailable posts", async () => {
          expect(hasPost(posts, w.posts[n].subUnavailableIndirect)).toBe(false);
        });
      }

      describe('pre-existing posts', () => {
        testPostBunch(0);
      });

      describe.skip('subscription mode (i.e. posts arriving while the Generator is already runnning)', () => {
        beforeAll(async () => {
          w.posts.push(new TestWordPostSet(w, "; second run"));
          await w.posts[1].makePosts();
        });

        testPostBunch(1);
      });
    });  // for each recursion level
  });  // Veritum output format
});
