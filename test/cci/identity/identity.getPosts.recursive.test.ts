import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { Veritable } from '../../../src/core/cube/veritable.definition';
import { PostFormat } from '../../../src/cci/identity/identity';

// TODO: Don't use test setups from ZW for CCI components, it breaks our layering
import { TestWorld } from '../../app/zw/testWorld';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

function hasPost(list: Veritable[], post: Veritable): boolean {
  if (list.some(item => item.getKeyStringIfAvailable() === post.getKeyStringIfAvailable())) return true;
  else return false;
}

describe('Identity: getPosts generator; recursive retrieval of own posts and posts by subscribed authors', () => {

  describe('full WOT (i.e. no recursion limits), Veritum output format', () => {
    let w: TestWorld;
    let posts: Veritable[];

    beforeAll(async () => {
      w = new TestWorld({ subscriptions: true, notifications: false });
      await w.ready;
      posts = await ArrayFromAsync(w.protagonist.getPosts({
        format: PostFormat.Veritum,
        subscriptionRecursionDepth: 1337,  // GO DEEP!
      }));
    });

    it('should include my own root posts', () => {
      expect(hasPost(posts, w.own)).toBe(true);
    });

    it("should include my direct subscription's posts", () => {
      expect(hasPost(posts, w.directUnreplied)).toBe(true);
    });

    it("should include indirect subscription's posts", () => {
      expect(hasPost(posts, w.indirectUnreplied)).toBe(true);
      expect(hasPost(posts, w.thirdUnreplied)).toBe(true);
    });

    it("should include my own replies to direct subscription's posts", async () => {
      expect(hasPost(posts, w.directOwn)).toBe(true);
    });

    it("should include my own replies to indirect subscription's posts", async () => {
      expect(hasPost(posts, w.indirectOwn)).toBe(true);
      expect(hasPost(posts, w.thirdOwn)).toBe(true);
    });

    it("should include my subscription's replies to my own posts", async () => {
      expect(hasPost(posts, w.ownDirect)).toBe(true);
      expect(hasPost(posts, w.ownIndirect)).toBe(true);
      expect(hasPost(posts, w.ownThird)).toBe(true);
    });

    it("should include my subscription's replies to my subscription's posts", async () => {
      expect(hasPost(posts, w.directThird)).toBe(true);
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

    it("should include my subscription's replies to non-subscribed users", async () => {
      expect(hasPost(posts, w.unrelatedSub)).toBe(true);
      expect(hasPost(posts, w.ownUnrelatedSub)).toBe(true);
    });

    it("should include my own replies to non-subscribed users", async () => {
      expect(hasPost(posts, w.unrelatedOwn)).toBe(true);
    });

    it("should include replies to unavailable posts", async () => {
      expect(hasPost(posts, w.subUnavailableIndirect)).toBe(true);
    });
  });
});
