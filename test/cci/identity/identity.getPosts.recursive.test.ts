import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { Veritable } from '../../../src/core/cube/veritable.definition';
import { Identity, PostFormat, PostInfo } from '../../../src/cci/identity/identity';

// TODO: Don't use test setups from ZW for CCI components, it breaks our layering
import { TestWordPostSet, TestWorld } from '../../app/zw/testWorld';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

function hasPost(list: Veritable[]|PostInfo<Veritable>[], post: Veritable, expectAuthor?: Identity): boolean {
  if (list.some(item => {
    // author check requested?
    if (expectAuthor && item['author'].keyString !== expectAuthor.keyString) return false;
    // normalise postInfo to post
    if (item['post'] !== undefined) item = item.post;
    // compare key
    return item.getKeyStringIfAvailable() === post.getKeyStringIfAvailable();
  })) return true;
  else return false;
}

describe('Identity: getPosts generator; recursive retrieval of own posts and posts by subscribed authors', () => {
  // This also tests "subscription mode", i.e. retrieving through an endless AsyncGenerator

  describe('Veritum post format', () => {
    for (const lvl of [0, 1, 2, 3, 1337]) describe (`recursion level ${lvl}`, () => {
      let w: TestWorld;
      const posts: Veritable[] = [];
      const postInfos: PostInfo<Veritable>[] = [];

      beforeAll(async () => {
        // prepare test setup
        w = new TestWorld({ subscriptions: true, notifications: false });
        await w.setup();

        // run tests using direct post output, i.e. no PostInfos
        (async() => {
          for await (const post of w.protagonist.getPosts({
            depth: lvl,
            format: PostFormat.Veritum,
            postInfo: false,
            subscribe: true,
          })) {
            posts.push(post);
          }
        })();

        // run tests using PostInfo output
        (async() => {
          for await (const postInfo of w.protagonist.getPosts({
            depth: lvl,
            format: PostFormat.Veritum,
            postInfo: true,
            subscribe: true,
          })) {
            postInfos.push(postInfo);
          }
        })();

        await new Promise((resolve) => setTimeout(resolve, 100));  // TODO nicify
      });

      function testPostBunch(list: Veritable[]|PostInfo<Veritable>[], n: number = 0, testAuthor: boolean) {
        it('should include my own root posts', () => {
          expect(hasPost(list, w.posts[n].own, testAuthor? w.protagonist : undefined)).toBe(true);
        });

        if (lvl > 0) it("should include my 1st level subscription's posts", () => {
          expect(hasPost(list, w.posts[n].directUnreplied, testAuthor? w.directSub : undefined)).toBe(true);
        });
        else it("should NOT include my 1st level subscription's posts", () => {
          expect(hasPost(list, w.posts[n].directUnreplied)).toBe(false);
        });

        if (lvl > 1) it("should include my 2nd level subscription's posts", () => {
          expect(hasPost(list, w.posts[n].indirectUnreplied, testAuthor? w.indirectSub : undefined)).toBe(true);
        });
        else it("should NOT include my 2nd level subscription's posts", () => {
          expect(hasPost(list, w.posts[n].indirectUnreplied)).toBe(false);
        });

        if (lvl > 2) it("should include my 3rd level subscription's posts", () => {
          expect(hasPost(list, w.posts[n].thirdUnreplied, testAuthor? w.thirdLevelSub : undefined)).toBe(true);
        });
        else it("should NOT include my 3rd level subscription's posts", () => {
          expect(hasPost(list, w.posts[n].thirdUnreplied)).toBe(false);
        });

        it("should include my own replies to direct subscription's posts", async () => {
          expect(hasPost(list, w.posts[n].directOwn, testAuthor? w.protagonist : undefined)).toBe(true);
        });

        it("should include my own replies to indirect subscription's posts", async () => {
          expect(hasPost(list, w.posts[n].indirectOwn, testAuthor? w.protagonist : undefined)).toBe(true);
          expect(hasPost(list, w.posts[n].thirdOwn, testAuthor? w.protagonist : undefined)).toBe(true);
        });

        if (lvl > 0) it("should include my 1st level subscription's replies to my own posts", async () => {
          expect(hasPost(list, w.posts[n].ownDirect, testAuthor? w.directSub : undefined)).toBe(true);
        });
        else it("should NOT include my 1st level subscription's replies to my own posts", async () => {
          expect(hasPost(list, w.posts[n].ownDirect)).toBe(false);
        });

        if (lvl > 1) it("should include my 2nd level subscription's replies to my own posts", async () => {
          expect(hasPost(list, w.posts[n].ownIndirect, testAuthor? w.indirectSub : undefined)).toBe(true);
        });
        else it("should NOT include my 2nd level subscription's replies to my own posts", async () => {
          expect(hasPost(list, w.posts[n].ownIndirect)).toBe(false);
        });

        if (lvl > 2) it("should include my 3rd level subscription's replies to my own posts", async () => {
          expect(hasPost(list, w.posts[n].ownThird, testAuthor? w.thirdLevelSub : undefined)).toBe(true);
        });
        else it("should NOT include my 3rd level subscription's replies to my own posts", async () => {
          expect(hasPost(list, w.posts[n].ownThird)).toBe(false);
        });

        if (lvl > 2) it("should include my 3rd level subscription's replies to my subscription's posts", async () => {
          expect(hasPost(list, w.posts[n].directThird, testAuthor? w.thirdLevelSub : undefined)).toBe(true);
        });
        else it("should NOT include my 3rd level subscription's replies to my subscription's posts", async () => {
          expect(hasPost(list, w.posts[n].directThird)).toBe(false);
        });

        it('should NOT include root posts by non-subscribed users', async () => {
          expect(hasPost(list, w.posts[n].unrelatedUnanswered)).toBe(false);
        });

        it('should NOT include replies by non-subscribed users', async () => {
          expect(hasPost(list, w.posts[n].ownUnrelatedUnanswered)).toBe(false);
        });

        it('should NOT include posts by non-subscribed users even if subscribed users answered them', async () => {
          expect(hasPost(list, w.posts[n].ownUnrelatedAnswered)).toBe(false);
        });

        it('should NOT include posts by non-subscribed users even if I answered them', async () => {
          expect(hasPost(list, w.posts[n].unrelatedAnsweredByProtagonist)).toBe(false);
        });

        if (lvl > 0) it("should include my 1st level subscription's replies to non-subscribed users", async () => {
          expect(hasPost(list, w.posts[n].unrelatedSub, testAuthor? w.directSub : undefined)).toBe(true);
          expect(hasPost(list, w.posts[n].ownUnrelatedSub, testAuthor? w.directSub : undefined)).toBe(true);
        });
        else it("should NOT include my 1st level subscription's replies to non-subscribed users", async () => {
          expect(hasPost(list, w.posts[n].unrelatedSub)).toBe(false);
          expect(hasPost(list, w.posts[n].ownUnrelatedSub)).toBe(false);
        });

        it("should include my own replies to non-subscribed users", async () => {
          expect(hasPost(list, w.posts[n].unrelatedOwn, testAuthor? w.protagonist : undefined)).toBe(true);
        });

        if (lvl > 1) it("should include 2nd level replies to unavailable posts", async () => {
          expect(hasPost(list, w.posts[n].subUnavailableIndirect, testAuthor? w.indirectSub : undefined)).toBe(true);
        });
        else it("should NOT include 2nd level replies to unavailable posts", async () => {
          expect(hasPost(list, w.posts[n].subUnavailableIndirect)).toBe(false);
        });
      }

      describe('pre-existing posts', () => {
        describe('raw post yield format (no PostInfo)', () => {
          testPostBunch(posts, 0, false);
        });

        describe('PostInfo yield format', () => {
          testPostBunch(postInfos, 0, true);
        });
      });

      describe('subscription mode (i.e. posts arriving while the Generator is already runnning)', () => {
        beforeAll(async () => {
          w.posts.push(new TestWordPostSet(w, "; second run"));
          await w.posts[1].makePosts();
          await new Promise(resolve => setTimeout(resolve, 100));
        });

        describe('raw post yield format (no PostInfo)', () => {
          testPostBunch(posts, 1, false);
        });

        describe('PostInfo yield format', () => {
          testPostBunch(postInfos, 1, true);
        });
      });
    });  // for each recursion level
  });  // Veritum post format

  describe('edge cases', () => {
    it.todo('write more tests');
  });

  // features currently not implemented
  it.todo('will automatically yield existing posts from newly added subscriptions');
  it.todo('will automatically yield new posts from newly added subscriptions');
});
