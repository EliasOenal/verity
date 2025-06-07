import { Veritable } from '../../../src/core/cube/veritable.definition';
import { Cube } from '../../../src/core/cube/cube';

import { cciCube } from '../../../src/cci/cube/cciCube';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';
import { Relationship, RelationshipType } from '../../../src/cci/cube/relationship';
import { Veritum } from '../../../src/cci/veritum/veritum';
import { ResolveRelsRecursiveResult } from '../../../src/cci/veritum/veritumRetrievalUtil';

import { GetPostsGenerator, PostFormat, PostInfo } from '../../../src/cci/identity/identity.definitions';
import { Identity } from '../../../src/cci/identity/identity';

// TODO: Don't use test setups from ZW for CCI components, it breaks our layering
import { TestWordPostSet, TestWorld } from '../../app/zw/testWorld';

import { beforeAll, describe, expect, it } from 'vitest';

async function hasPost(list: Veritable[]|PostInfo<Veritable>[], post: Veritable, format?: PostFormat, expectAuthor?: Identity, shouldResolveBasePost?: Veritable) {
  // fetch item from list by key
  const item = list.find(item => {
    if (item['main'] !== undefined) item = (item as unknown as PostInfo<Veritable>).main;
    return (item as Veritable).getKeyStringIfAvailable() === post.getKeyStringIfAvailable();
  });
  expect(item).toBeDefined();

  // author check requested?
  if (expectAuthor) expect(item!['author'].keyString).toEqual(expectAuthor.keyString);
  // normalise postInfo to post
  let veritum: Veritable = item as Veritable;
  if (veritum['main'] !== undefined) veritum = (veritum as unknown as PostInfo<Veritable>).main;
  // correct format?
  if (format === PostFormat.Veritum) expect(veritum).toBeInstanceOf(Veritum);
  if (format === PostFormat.Cube) expect(veritum).toBeInstanceOf(cciCube);

  if (shouldResolveBasePost) {
    const rel: Relationship = (veritum as Veritum).getFirstRelationship(RelationshipType.REPLY_TO);
    expect(rel).toBeDefined();  // verify test setup

    const resPromise: Promise<ResolveRelsRecursiveResult> = item![RelationshipType.REPLY_TO][0];
    expect(resPromise).toBeInstanceOf(Promise);
    const res = await resPromise;
    expect(res.main.getFirstField(FieldType.PAYLOAD).valueString).toEqual(
      shouldResolveBasePost.getFirstField(FieldType.PAYLOAD).valueString);
  }
}

function doesNotHavePost(list: Veritable[]|PostInfo<Veritable>[], post: Veritable): void {
  // fetch item from list by key
  const item = list.find(item => {
    if (item['main'] !== undefined) item = (item as unknown as PostInfo<Veritable>).main;
    return (item as Veritable).getKeyStringIfAvailable() === post.getKeyStringIfAvailable();
  });
  expect(item).toBeUndefined();
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
        subscriptionDepth: lvl,
        format: PostFormat.Veritum,
        metadata: false,
        subscribe: true,
      });
      // push yielded posts to array for ease of testing
      (async() => {
        for await (const post of postsGenDirectVeritum) postsDirectVeritum.push(post);
      })();

      // run tests using PostInfo-wrapped Veritum format
      // including reverse reply resolution
      postsGenPostInfoVeritum = w.protagonist.getPosts({
        subscriptionDepth: lvl,
        format: PostFormat.Veritum,
        metadata: true,
        subscribe: true,
        resolveRels: 'recursive',
        relTypes: [RelationshipType.REPLY_TO],
      });
      // push yielded posts to array for ease of testing
      (async() => {
        for await (const postInfo of postsGenPostInfoVeritum) postsPostInfoVeritum.push(postInfo);
      })();

      // run tests using direct first-Cube-only format, i.e. no PostInfos
      postsGenDirectCube = w.protagonist.getPosts({
        subscriptionDepth: lvl,
        format: PostFormat.Cube,
        metadata: false,
        subscribe: true,
      });
      // push yielded posts to array for ease of testing
      (async() => {
        for await (const post of postsGenDirectCube) postsDirectCube.push(post);
      })();

      // run tests using PostInfo-wrapped first-Cube-only format
      postsGenPostInfoCube = w.protagonist.getPosts({
        subscriptionDepth: lvl,
        format: PostFormat.Cube,
        metadata: true,
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

    function testPostBunch(list: Veritable[]|PostInfo<Veritable>[], n: number = 0, format: PostFormat, testAuthor: boolean, testReplyResolution: boolean) {
      it('should include my own root posts', () => {
        hasPost(list, w.posts[n].own, format, testAuthor? w.protagonist : undefined);
      });

      if (lvl > 0) it("should include my 1st level subscription's posts", async () => {
        await hasPost(list, w.posts[n].directUnreplied, format, testAuthor? w.directSub : undefined);
      });
      else it("should NOT include my 1st level subscription's posts", async () => {
        await doesNotHavePost(list, w.posts[n].directUnreplied);
      });

      if (lvl > 1) it("should include my 2nd level subscription's posts", async () => {
        await hasPost(list, w.posts[n].indirectUnreplied, format, testAuthor? w.indirectSub : undefined);
      });
      else it("should NOT include my 2nd level subscription's posts", async () => {
        await doesNotHavePost(list, w.posts[n].indirectUnreplied);
      });

      if (lvl > 2) it("should include my 3rd level subscription's posts", async () => {
        await hasPost(list, w.posts[n].thirdUnreplied, format, testAuthor? w.thirdLevelSub : undefined);
      });
      else it("should NOT include my 3rd level subscription's posts", async () => {
        await doesNotHavePost(list, w.posts[n].thirdUnreplied);
      });

      it("should include my own replies to direct subscription's posts", async () => {
        await hasPost(list, w.posts[n].directOwn, format, testAuthor? w.protagonist : undefined, testReplyResolution? w.posts[n].directReplied : undefined);
      });

      it("should include my own replies to indirect subscription's posts", async () => {
        await hasPost(list, w.posts[n].indirectOwn, format, testAuthor? w.protagonist : undefined, testReplyResolution? w.posts[n].indirectReplied : undefined);
        await hasPost(list, w.posts[n].thirdOwn, format, testAuthor? w.protagonist : undefined, testReplyResolution ? w.posts[n].thirdReplied : undefined);
      });

      if (lvl > 0) it("should include my 1st level subscription's replies to my own posts", async () => {
        await hasPost(list, w.posts[n].ownDirect, format, testAuthor? w.directSub : undefined, testReplyResolution? w.posts[n].own : undefined);
      });
      else it("should NOT include my 1st level subscription's replies to my own posts", async () => {
        await doesNotHavePost(list, w.posts[n].ownDirect);
      });

      if (lvl > 1) it("should include my 2nd level subscription's replies to my own posts", async () => {
        await hasPost(list, w.posts[n].ownIndirect, format, testAuthor? w.indirectSub : undefined, testReplyResolution? w.posts[n].own : undefined);
      });
      else it("should NOT include my 2nd level subscription's replies to my own posts", async () => {
        await doesNotHavePost(list, w.posts[n].ownIndirect);
      });

      if (lvl > 2) it("should include my 3rd level subscription's replies to my own posts", async () => {
        await hasPost(list, w.posts[n].ownThird, format, testAuthor? w.thirdLevelSub : undefined, testReplyResolution? w.posts[n].own : undefined);
      });
      else it("should NOT include my 3rd level subscription's replies to my own posts", async () => {
        await doesNotHavePost(list, w.posts[n].ownThird);
      });

      if (lvl > 2) it("should include my 3rd level subscription's replies to my subscription's posts", async () => {
        await hasPost(list, w.posts[n].directThird, format, testAuthor? w.thirdLevelSub : undefined, testReplyResolution? w.posts[n].directReplied : undefined);
      });
      else it("should NOT include my 3rd level subscription's replies to my subscription's posts", async () => {
        await doesNotHavePost(list, w.posts[n].directThird);
      });

      it('should NOT include root posts by non-subscribed users', async () => {
        await doesNotHavePost(list, w.posts[n].unrelatedUnanswered);
      });

      it('should NOT include replies by non-subscribed users', async () => {
        await doesNotHavePost(list, w.posts[n].ownUnrelatedUnanswered);
      });

      it('should NOT include posts by non-subscribed users even if subscribed users answered them', async () => {
        await doesNotHavePost(list, w.posts[n].ownUnrelatedAnswered);
      });

      it('should NOT include posts by non-subscribed users even if I answered them', async () => {
        await doesNotHavePost(list, w.posts[n].unrelatedAnsweredByProtagonist);
      });

      if (lvl > 0) it("should include my 1st level subscription's replies to non-subscribed users", async () => {
        await hasPost(list, w.posts[n].unrelatedSub, format, testAuthor? w.directSub : undefined, testReplyResolution? w.posts[n].unrelatedAnsweredBySub : undefined);
        await hasPost(list, w.posts[n].ownUnrelatedSub, format, testAuthor? w.directSub : undefined, testReplyResolution? w.posts[n].ownUnrelatedAnswered : undefined);
      });
      else it("should NOT include my 1st level subscription's replies to non-subscribed users", async () => {
        await doesNotHavePost(list, w.posts[n].unrelatedSub);
        await doesNotHavePost(list, w.posts[n].ownUnrelatedSub);
      });

      it("should include my own replies to non-subscribed users", async () => {
        await hasPost(list, w.posts[n].unrelatedOwn, format, testAuthor? w.protagonist : undefined, testReplyResolution? w.posts[n].unrelatedAnsweredByProtagonist : undefined);
      });

      if (lvl > 1) it("should include 2nd level replies to unavailable posts", async () => {
        await hasPost(list, w.posts[n].subUnavailableIndirect, format, testAuthor? w.indirectSub : undefined, undefined /* no reply resolution,  base post is unavailable */);
      });
      else it("should NOT include 2nd level replies to unavailable posts", async () => {
        await doesNotHavePost(list, w.posts[n].subUnavailableIndirect);
      });
    }

    describe('pre-existing posts', () => {
      describe('direct Veritum yield format (no PostInfo)', () => {
        testPostBunch(postsDirectVeritum, 0, PostFormat.Veritum, false, false);
      });

      describe('PostInfo-wrapped Veritum yield format', () => {
        testPostBunch(postsPostInfoVeritum, 0, PostFormat.Veritum, true, true);
      });

      describe('direct first-Cube-only yield format (no PostInfo)', () => {
        testPostBunch(postsDirectCube, 0, PostFormat.Cube, false, false);
      });

      describe('PostInfo-wrapped first-Cube-only yield format', () => {
        testPostBunch(postsPostInfoCube, 0, PostFormat.Cube, true, false);
      });
    });

    describe('subscription mode (i.e. posts arriving while the Generator is already runnning)', () => {
      beforeAll(async () => {
        w.posts.push(new TestWordPostSet(w, "; second run"));
        await w.posts[1].makePosts();
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      describe('direct Veritum yield format (no PostInfo)', () => {
        testPostBunch(postsDirectVeritum, 1, PostFormat.Veritum, false, false);
      });

      describe('PostInfo-wrapped Veritum yield format', () => {
        testPostBunch(postsPostInfoVeritum, 1, PostFormat.Veritum, true, true);
      });

      describe('direct first-Cube-only yield format (no PostInfo)', () => {
        testPostBunch(postsDirectCube, 1, PostFormat.Cube, false, false);
      });

      describe('PostInfo-wrapped first-Cube-only yield format', () => {
        testPostBunch(postsPostInfoCube, 1, PostFormat.Cube, true, false);
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
