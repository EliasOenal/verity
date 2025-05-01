import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

import { cciCube } from "../../../../src/cci/cube/cciCube";
import { TestWorld } from "../testWorld";
import { explorePostGenerator, isPostDisplayable, wotPostGenerator } from '../../../../src/app/zw/model/zwUtil';
import { PostInfo, RecursiveRelResolvingPostInfo } from '../../../../src/cci/identity/identity';
import { Cube } from '../../../../src/core/cube/cube';
import { ArrayFromAsync } from '../../../../src/core/helpers/misc';
import { Veritable } from '../../../../src/core/cube/veritable.definition';
import { IdentityStore } from '../../../../src/cci/identity/identityStore';

describe('post generators', () => {
  describe('verify test setup (i.e. test TestWorld', () => {
    let w: TestWorld;
    beforeAll(async () => {
      w = new TestWorld({ subscriptions: true });
      await w.setup();
    });

    test('expect all Identity MUCs in store', async () => {
      expect(await w.cubeStore.getCube(w.protagonist.key)).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(w.directSub.key)).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(w.indirectSub.key)).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(w.thirdLevelSub.key)).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(w.unrelatedId.key)).toBeInstanceOf(cciCube);
    });

    test('expect all posts to be in store, except of course the unavailable one', async() => {
      expect(await w.cubeStore.getCube(await w.posts[0].own.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].ownDirect.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].ownIndirect.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].ownThird.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].ownUnrelatedUnanswered.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].ownUnrelatedAnswered.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].ownUnrelatedSub.getKey())).toBeInstanceOf(cciCube);

      expect(await w.cubeStore.getCube(await w.posts[0].directUnreplied.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].directThird.getKey())).toBeInstanceOf(cciCube);

      expect(await w.cubeStore.getCube(await w.posts[0].indirectUnreplied.getKey())).toBeInstanceOf(cciCube);

      expect(await w.cubeStore.getCube(await w.posts[0].thirdUnreplied.getKey())).toBeInstanceOf(cciCube);

      expect(await w.cubeStore.getCube(await w.posts[0].unrelatedUnanswered.getKey())).toBeInstanceOf(cciCube);

      expect(await w.cubeStore.getCube(await w.posts[0].unrelatedAnsweredBySub.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].unrelatedSub.getKey())).toBeInstanceOf(cciCube);

      expect(await w.cubeStore.getCube(await w.posts[0].unrelatedAnsweredByProtagonist.getKey())).toBeInstanceOf(cciCube);
      expect(await w.cubeStore.getCube(await w.posts[0].unrelatedOwn.getKey())).toBeInstanceOf(cciCube);

      expect(await w.cubeStore.getCube(await w.posts[0].subUnavailable.getKey())).toBeUndefined();
      expect(await w.cubeStore.getCube(await w.posts[0].subUnavailableIndirect.getKey())).toBeInstanceOf(cciCube);
    });

    test('expect all posts to be listed by their authors', async () => {
      expect(w.protagonist.hasPost(await w.posts[0].own.getKey())).toBeTruthy();
      expect(w.directSub.hasPost(await w.posts[0].ownDirect.getKey())).toBeTruthy();
      expect(w.indirectSub.hasPost(await w.posts[0].ownIndirect.getKey())).toBeTruthy();
      expect(w.thirdLevelSub.hasPost(await w.posts[0].ownThird.getKey())).toBeTruthy();
      expect(w.unrelatedId.hasPost(await w.posts[0].ownUnrelatedUnanswered.getKey())).toBeTruthy();
      expect(w.unrelatedId.hasPost(await w.posts[0].ownUnrelatedAnswered.getKey())).toBeTruthy();
      expect(w.directSub.hasPost(await w.posts[0].ownUnrelatedSub.getKey())).toBeTruthy();

      expect(w.directSub.hasPost(await w.posts[0].directUnreplied.getKey())).toBeTruthy();
      expect(w.thirdLevelSub.hasPost(await w.posts[0].directThird.getKey())).toBeTruthy();

      expect(w.indirectSub.hasPost(await w.posts[0].indirectUnreplied.getKey())).toBeTruthy();

      expect(w.thirdLevelSub.hasPost(await w.posts[0].thirdUnreplied.getKey())).toBeTruthy();

      expect(w.unrelatedId.hasPost(await w.posts[0].unrelatedUnanswered.getKey())).toBeTruthy();

      expect(w.unrelatedId.hasPost(await w.posts[0].unrelatedAnsweredBySub.getKey())).toBeTruthy();
      expect(w.directSub.hasPost(await w.posts[0].unrelatedSub.getKey())).toBeTruthy();

      expect(w.unrelatedId.hasPost(await w.posts[0].unrelatedAnsweredByProtagonist.getKey())).toBeTruthy();
      expect(w.protagonist.hasPost(await w.posts[0].unrelatedOwn.getKey())).toBeTruthy();

      expect(w.directSub.hasPost(await w.posts[0].subUnavailable.getKey())).toBeTruthy();
      expect(w.indirectSub.hasPost(await w.posts[0].subUnavailableIndirect.getKey())).toBeTruthy();
    });
  });

  async function shouldDisplay(post: Veritable, list: RecursiveRelResolvingPostInfo<Cube>[]) {
    const postInfo = list.find((p) => p.main.getKeyStringIfAvailable() === post.getKeyStringIfAvailable());
    expect(postInfo).toBeDefined();
    expect(await isPostDisplayable(postInfo!)).toBe(true);
  }

  function shouldNotGenerate(post: Veritable, list: RecursiveRelResolvingPostInfo<Cube>[]) {
    const postInfo = list.find((p) => p.main.getKeyStringIfAvailable() === post.getKeyStringIfAvailable());
    expect(postInfo).toBeUndefined();
  }

  async function shouldGenerateButNotDisplay(post: Veritable, list: RecursiveRelResolvingPostInfo<Cube>[]) {
    const postInfo = list.find((p) => p.main.getKeyStringIfAvailable() === post.getKeyStringIfAvailable());
    expect(postInfo).toBeDefined();
    expect(await isPostDisplayable(postInfo!)).toBe(false);
  }

  describe('full WOT', () => {
    let w: TestWorld;
    const list: RecursiveRelResolvingPostInfo<Cube>[] = [];
    beforeAll(async () => {
      w = new TestWorld({ subscriptions: true });
      await w.setup();

      const gen = wotPostGenerator(w.protagonist, 1337);
      (async () => { for await (const post of gen) list.push(post) })();
      await gen.existingYielded;
    });

    it('should display my own root posts', async () => {
      await shouldDisplay(w.posts[0].own, list);
    });

    it("should display my direct subscription's posts", async () => {
      await shouldDisplay(w.posts[0].directUnreplied, list);
    });

    it("should display indirect subscription's posts", async () => {
      await shouldDisplay(w.posts[0].indirectUnreplied, list);
      await shouldDisplay(w.posts[0].thirdUnreplied, list);
    });

    it("should display my own replies to direct subscription's posts", async () => {
      await shouldDisplay(w.posts[0].directOwn, list);
    });

    it("should display my own replies to indirect subscription's posts", async () => {
      await shouldDisplay(w.posts[0].indirectOwn, list);
      await shouldDisplay(w.posts[0].thirdOwn, list);
    });

    it("should display my subscription's replies to my own posts", async () => {
      await shouldDisplay(w.posts[0].ownDirect, list);
      await shouldDisplay(w.posts[0].ownIndirect, list);
      await shouldDisplay(w.posts[0].ownThird, list);
    });

    it("should display my subscription's replies to my subscription's posts", async () => {
      await shouldDisplay(w.posts[0].directThird, list);
    });

    it('should NOT show root posts by non-subscribed users', async () => {
      await shouldNotGenerate(w.posts[0].unrelatedUnanswered, list);
    });

    it('should NOT show replies by non-subscribed users', async () => {
      await shouldNotGenerate(w.posts[0].ownUnrelatedUnanswered, list);
    });

    it('should not generate posts by non-subscribed users even if subscribed users answered them', async () => {
      // Note that this post will still be displayed by the app, because it
      // will get displayed as root post when processing the reply.
      await shouldNotGenerate(w.posts[0].ownUnrelatedAnswered, list);
    });

    it('should not generate posts by non-subscribed users even if I answered them', async () => {
      // Note that this post will still be displayed by the app, because it
      // will get displayed as root post when processing the reply.
      await shouldNotGenerate(w.posts[0].unrelatedAnsweredByProtagonist, list);
    });

    it("should show my subscription's replies to non-subscribed users", async () => {
      await shouldDisplay(w.posts[0].unrelatedSub, list);
      await shouldDisplay(w.posts[0].ownUnrelatedSub, list);
    });

    it("should show my own replies to non-subscribed users", async () => {
      await shouldDisplay(w.posts[0].unrelatedOwn, list);
    });

    // TODO do we actually want that?
    it("should NOT display replies to unavailable posts", async () => {
      await shouldGenerateButNotDisplay(w.posts[0].subUnavailableIndirect, list);
    });
  });


  describe('explore unknown authors through notifications', () => {
    let w: TestWorld;
    const list: RecursiveRelResolvingPostInfo<Cube>[] = [];

    beforeAll(async () => {
      w = new TestWorld({ subscriptions: false });
      await w.setup();

      const gen = explorePostGenerator(w.retriever.cubeRetriever, new IdentityStore(w.retriever));
      (async () => { for await (const post of gen) list.push(post) })();
      await new Promise((resolve) => setTimeout(resolve, 100));  // TODO provide proper done promise
    });

    it('should display my own root posts', async () => {
      await shouldDisplay(w.posts[0].own, list);
    });

    it("should display my direct subscription's posts", async () => {
      await shouldDisplay(w.posts[0].directUnreplied, list);
    });

    it("should display indirect subscription's posts", async () => {
      await shouldDisplay(w.posts[0].indirectUnreplied, list);
      await shouldDisplay(w.posts[0].thirdUnreplied, list);
    });

    it("should display my own replies to direct subscription's posts", async () => {
      await shouldDisplay(w.posts[0].directOwn, list);
    });

    it("should display my own replies to indirect subscription's posts", async () => {
      await shouldDisplay(w.posts[0].indirectOwn, list);
      await shouldDisplay(w.posts[0].thirdOwn, list);
    });

    it("should display my subscription's replies to my own posts", async () => {
      await shouldDisplay(w.posts[0].ownDirect, list);
      await shouldDisplay(w.posts[0].ownIndirect, list);
      await shouldDisplay(w.posts[0].ownThird, list);
    });

    it("should display my subscription's replies to my subscription's posts", async () => {
      await shouldDisplay(w.posts[0].directThird, list);
    });

    it('should show root posts by non-subscribed users', async () => {
      await shouldDisplay(w.posts[0].unrelatedUnanswered, list);
    });

    it('should show replies by non-subscribed users', async () => {
      await shouldDisplay(w.posts[0].ownUnrelatedUnanswered, list);
    });

    it('should show posts by non-subscribed users if subscribed users answered them', async () => {
      await shouldDisplay(w.posts[0].ownUnrelatedAnswered, list);
    });

    it('should show posts by non-subscribed users if I answered them', async () => {
      await shouldDisplay(w.posts[0].unrelatedAnsweredByProtagonist, list);
    });

    it("should show my subscription's replies to non-subscribed users", async () => {
      await shouldDisplay(w.posts[0].unrelatedSub, list);
      await shouldDisplay(w.posts[0].ownUnrelatedSub, list);
    });

    it("should show my own replies to non-subscribed users", async () => {
      await shouldDisplay(w.posts[0].unrelatedOwn, list);
    });

    // TODO do we actually want that?
    it("should NOT display replies to unavailable posts", async () => {
      await shouldGenerateButNotDisplay(w.posts[0].subUnavailableIndirect, list);
    });
  });

});
