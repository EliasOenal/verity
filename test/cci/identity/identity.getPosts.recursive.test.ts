import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { Veritable } from '../../../src/core/cube/veritable.definition';
import { GetPostsGenerator, Identity, PostFormat, PostInfo } from '../../../src/cci/identity/identity';

// TODO: Don't use test setups from ZW for CCI components, it breaks our layering
import { TestWordPostSet, TestWorld } from '../../app/zw/testWorld';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { Veritum } from '../../../src/cci/veritum/veritum';
import { Cube } from '../../../src/core/cube/cube';
import { P } from 'pino';

function hasPost(list: Veritable[]|PostInfo<Veritable>[], post: Veritable, format?: PostFormat, expectAuthor?: Identity): boolean {
  if (list.some(item => {
    // author check requested?
    if (expectAuthor && item['author'].keyString !== expectAuthor.keyString) return false;
    // normalise postInfo to post
    if (item['post'] !== undefined) item = item.post;
    // correct format?
    if (format === PostFormat.Veritum && !(item instanceof Veritum)) return false;
    if (format === PostFormat.Cube && !(item instanceof cciCube)) return false;
    // compare key
    return item.getKeyStringIfAvailable() === post.getKeyStringIfAvailable();
  })) return true;
  else return false;
}

describe('Identity: getPosts generator; recursive retrieval of own posts and posts by subscribed authors', () => {
  // This also tests "subscription mode", i.e. retrieving through an endless AsyncGenerator

  for (const lvl of [0, 1, 2, 3, 1337]) describe (`recursion level ${lvl}`, () => {
    let w: TestWorld;
    let postsGenDirectVeritum: GetPostsGenerator<Veritum>;
    let postsGenPostInfoVeritum: GetPostsGenerator<PostInfo<Veritum>>;
    let postsGenDirectCube: GetPostsGenerator<Cube>;
    let postsGenPostInfoCube: GetPostsGenerator<PostInfo<Cube>>;

    const postsDirectVeritum: Veritum[] = [];
    const postsPostInfoVeritum: PostInfo<Veritum>[] = [];
    const postsDirectCube: Cube[] = [];
    const postsPostInfoCube: PostInfo<Cube>[] = [];

    beforeAll(async () => {
      // prepare test setup
      w = new TestWorld({ subscriptions: true, notifications: false });
      await w.setup();

      // run tests using direct Veritum format, i.e. no PostInfos
      postsGenDirectVeritum = w.protagonist.getPosts({
        depth: lvl,
        format: PostFormat.Veritum,
        postInfo: false,
        subscribe: true,
      });
      // push yielded posts to array for ease of testing
      (async() => {
        for await (const post of postsGenDirectVeritum) postsDirectVeritum.push(post);
      })();

      // run tests using PostInfo-wrapped Veritum format
      postsGenPostInfoVeritum = w.protagonist.getPosts({
        depth: lvl,
        format: PostFormat.Veritum,
        postInfo: true,
        subscribe: true,
      });
      // push yielded posts to array for ease of testing
      (async() => {
        for await (const postInfo of postsGenPostInfoVeritum) postsPostInfoVeritum.push(postInfo);
      })();

      // run tests using direct first-Cube-only format, i.e. no PostInfos
      postsGenDirectCube = w.protagonist.getPosts({
        depth: lvl,
        format: PostFormat.Cube,
        postInfo: false,
        subscribe: true,
      });
      // push yielded posts to array for ease of testing
      (async() => {
        for await (const post of postsGenDirectCube) postsDirectCube.push(post);
      })();

      // run tests using PostInfo-wrapped first-Cube-only format
      postsGenPostInfoCube = w.protagonist.getPosts({
        depth: lvl,
        format: PostFormat.Cube,
        postInfo: true,
        subscribe: true,
      });
      // push yielded posts to array for ease of testing
      (async() => {
        for await (const postInfo of postsGenPostInfoCube) postsPostInfoCube.push(postInfo);
      })();

      // tests can start once all pre-existing posts have been yielded
      await postsGenDirectVeritum.existingYielded;
      await postsGenPostInfoVeritum.existingYielded;
    });

    function testPostBunch(list: Veritable[]|PostInfo<Veritable>[], n: number = 0, format: PostFormat, testAuthor: boolean) {
      it('should include my own root posts', () => {
        expect(hasPost(list, w.posts[n].own, format, testAuthor? w.protagonist : undefined)).toBe(true);
      });

      if (lvl > 0) it("should include my 1st level subscription's posts", () => {
        expect(hasPost(list, w.posts[n].directUnreplied, format, testAuthor? w.directSub : undefined)).toBe(true);
      });
      else it("should NOT include my 1st level subscription's posts", () => {
        expect(hasPost(list, w.posts[n].directUnreplied)).toBe(false);
      });

      if (lvl > 1) it("should include my 2nd level subscription's posts", () => {
        expect(hasPost(list, w.posts[n].indirectUnreplied, format, testAuthor? w.indirectSub : undefined)).toBe(true);
      });
      else it("should NOT include my 2nd level subscription's posts", () => {
        expect(hasPost(list, w.posts[n].indirectUnreplied)).toBe(false);
      });

      if (lvl > 2) it("should include my 3rd level subscription's posts", () => {
        expect(hasPost(list, w.posts[n].thirdUnreplied, format, testAuthor? w.thirdLevelSub : undefined)).toBe(true);
      });
      else it("should NOT include my 3rd level subscription's posts", () => {
        expect(hasPost(list, w.posts[n].thirdUnreplied)).toBe(false);
      });

      it("should include my own replies to direct subscription's posts", async () => {
        expect(hasPost(list, w.posts[n].directOwn, format, testAuthor? w.protagonist : undefined)).toBe(true);
      });

      it("should include my own replies to indirect subscription's posts", async () => {
        expect(hasPost(list, w.posts[n].indirectOwn, format, testAuthor? w.protagonist : undefined)).toBe(true);
        expect(hasPost(list, w.posts[n].thirdOwn, format, testAuthor? w.protagonist : undefined)).toBe(true);
      });

      if (lvl > 0) it("should include my 1st level subscription's replies to my own posts", async () => {
        expect(hasPost(list, w.posts[n].ownDirect, format, testAuthor? w.directSub : undefined)).toBe(true);
      });
      else it("should NOT include my 1st level subscription's replies to my own posts", async () => {
        expect(hasPost(list, w.posts[n].ownDirect)).toBe(false);
      });

      if (lvl > 1) it("should include my 2nd level subscription's replies to my own posts", async () => {
        expect(hasPost(list, w.posts[n].ownIndirect, format, testAuthor? w.indirectSub : undefined)).toBe(true);
      });
      else it("should NOT include my 2nd level subscription's replies to my own posts", async () => {
        expect(hasPost(list, w.posts[n].ownIndirect)).toBe(false);
      });

      if (lvl > 2) it("should include my 3rd level subscription's replies to my own posts", async () => {
        expect(hasPost(list, w.posts[n].ownThird, format, testAuthor? w.thirdLevelSub : undefined)).toBe(true);
      });
      else it("should NOT include my 3rd level subscription's replies to my own posts", async () => {
        expect(hasPost(list, w.posts[n].ownThird)).toBe(false);
      });

      if (lvl > 2) it("should include my 3rd level subscription's replies to my subscription's posts", async () => {
        expect(hasPost(list, w.posts[n].directThird, format, testAuthor? w.thirdLevelSub : undefined)).toBe(true);
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
        expect(hasPost(list, w.posts[n].unrelatedSub, format, testAuthor? w.directSub : undefined)).toBe(true);
        expect(hasPost(list, w.posts[n].ownUnrelatedSub, format, testAuthor? w.directSub : undefined)).toBe(true);
      });
      else it("should NOT include my 1st level subscription's replies to non-subscribed users", async () => {
        expect(hasPost(list, w.posts[n].unrelatedSub)).toBe(false);
        expect(hasPost(list, w.posts[n].ownUnrelatedSub)).toBe(false);
      });

      it("should include my own replies to non-subscribed users", async () => {
        expect(hasPost(list, w.posts[n].unrelatedOwn, format, testAuthor? w.protagonist : undefined)).toBe(true);
      });

      if (lvl > 1) it("should include 2nd level replies to unavailable posts", async () => {
        expect(hasPost(list, w.posts[n].subUnavailableIndirect, format, testAuthor? w.indirectSub : undefined)).toBe(true);
      });
      else it("should NOT include 2nd level replies to unavailable posts", async () => {
        expect(hasPost(list, w.posts[n].subUnavailableIndirect)).toBe(false);
      });
    }

    describe('pre-existing posts', () => {
      describe('direct Veritum yield format (no PostInfo)', () => {
        testPostBunch(postsDirectVeritum, 0, PostFormat.Veritum, false);
      });

      describe('PostInfo-wrapped Veritum yield format', () => {
        testPostBunch(postsPostInfoVeritum, 0, PostFormat.Veritum, true);
      });

      describe('direct first-Cube-only yield format (no PostInfo)', () => {
        testPostBunch(postsDirectCube, 0, PostFormat.Cube, false);
      });

      describe('PostInfo-wrapped first-Cube-only yield format', () => {
        testPostBunch(postsPostInfoCube, 0, PostFormat.Cube, true);
      });
    });

    describe('subscription mode (i.e. posts arriving while the Generator is already runnning)', () => {
      beforeAll(async () => {
        w.posts.push(new TestWordPostSet(w, "; second run"));
        await w.posts[1].makePosts();
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      describe('direct Veritum yield format (no PostInfo)', () => {
        testPostBunch(postsDirectVeritum, 1, PostFormat.Veritum, false);
      });

      describe('PostInfo-wrapped Veritum yield format', () => {
        testPostBunch(postsPostInfoVeritum, 1, PostFormat.Veritum, true);
      });

      describe('direct first-Cube-only yield format (no PostInfo)', () => {
        testPostBunch(postsDirectCube, 1, PostFormat.Cube, false);
      });

      describe('PostInfo-wrapped first-Cube-only yield format', () => {
        testPostBunch(postsPostInfoCube, 1, PostFormat.Cube, true);
      });
    });
  });  // for each recursion level

  describe('edge cases', () => {
    it.todo('write more tests');
  });

  // features currently not implemented
  it.todo('will automatically yield existing posts from newly added subscriptions');
  it.todo('will automatically yield new posts from newly added subscriptions');
});
