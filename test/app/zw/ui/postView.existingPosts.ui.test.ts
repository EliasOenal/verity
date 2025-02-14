// @vitest-environment jsdom

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { TestWorld } from '../testWorld';
import { PostController } from '../../../../src/app/zw/webui/post/postController';
import { DummyCoreNode, CoreNodeIf, CoreNodeOptions } from '../../../../src/core/coreNode';
import { DummyNavController } from '../../../../src/webui/navigation/navigationDefinitions';
import { Veritable } from '../../../../src/core/cube/veritable.definition';
import { FieldType } from '../../../../src/cci/cube/cciCube.definitions';
import { Identity } from '../../../../src/cci/identity/identity';

import { Buffer } from 'buffer';
import { cciTestOptions } from '../../../cci/e2e/e2eCciSetup';
import { loadZwTemplate } from './uiTestSetup';
import { CubeKey } from '../../../../src/core/cube/cube.definitions';
import { keyVariants } from '../../../../src/core/cube/cubeUtil';
import { VerityNodeIf, DummyVerityNode } from '../../../../src/cci/verityNode';
import { Cockpit } from '../../../../src/cci/cockpit';

const testOptions: CoreNodeOptions = {
  ...cciTestOptions,
  requestTimeout: 100,
}

describe('PostView tests regarding displayal of existing posts', () => {
  beforeAll(async () => {
    // verify test setup
    // - uses regular UInt8Array-based Buffers and not whatever crap JSDOM tries to inject
    const testBuf = Buffer.alloc(10, 42);
    expect(testBuf).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(testBuf)).toBe(true);

    // load HTML/CSS templates
    await loadZwTemplate();
  });

  describe('showing the correct posts', () => {
    describe('My Network (posts based on subscriptions using full WOT)', () => {
      let w: TestWorld;
      let controller: PostController;

      beforeAll(async () => {
        const node: VerityNodeIf = new DummyVerityNode(testOptions);
        await node.readyPromise;
        w = new TestWorld({ subscriptions: true, cubeStore: node.cubeStore });
        await w.ready;
        controller = new PostController({
          node,
          nav: new DummyNavController(),
          identity: w.protagonist,
          cockpit: new Cockpit(node, {identity: w.protagonist}),
        });
        await controller.navWot();
        controller.contentAreaView.show();
      });

      it('should display my own root posts', async () => {
        expectDisplayed(w.own, { author: w.protagonist });
      });

      it("should display my direct subscription's posts", async () => {
        expectDisplayed(w.directUnreplied, { author: w.directSub });
      });

      it("should display indirect subscription's posts", async () => {
        expectDisplayed(w.indirectUnreplied, { author: w.indirectSub });
        expectDisplayed(w.thirdUnreplied, { author: w.thirdLevelSub });
      });

      it("should display my own replies to direct subscription's posts", async () => {
        expectDisplayed(w.directOwn, { author: w.protagonist });
      });

      it("should display my own replies to indirect subscription's posts", async () => {
        expectDisplayed(w.indirectOwn, { author: w.protagonist });
        expectDisplayed(w.thirdOwn, { author: w.protagonist });
      });

      it("should display my subscription's replies to my own posts", async () => {
        expectDisplayed(w.ownDirect, { author: w.directSub });
        expectDisplayed(w.ownIndirect, { author: w.indirectSub });
        expectDisplayed(w.ownThird, { author: w.thirdLevelSub });
      });

      it("should display my subscription's replies to my subscription's posts", async () => {
        expectDisplayed(w.directThird, { author: w.thirdLevelSub });
      });

      it('should NOT show root posts by non-subscribed users', async () => {
        expectNotDisplayed(w.unrelatedUnanswered);
      });

      it('should NOT show replies by non-subscribed users', async () => {
        expectNotDisplayed(w.ownUnrelatedUnanswered);
      });

      it('should show posts by non-subscribed users if subscribed users answered them', async () => {
        // expectDisplayed(w.ownUnrelatedAnswered, { author: w.unrelatedId });
        // TODO BUGBUG: currently unable to resolve the non-subscribed author;
        //              will display as unknown user
        expectDisplayed(w.ownUnrelatedAnswered);
      });

      it('should show posts by non-subscribed users if I answered them', async () => {
        // expectDisplayed(w.unrelatedAnsweredByProtagonist, { author: w.unrelatedId });
        // TODO BUGBUG: currently unable to resolve the non-subscribed author;
        //              will display as unknown user
        expectDisplayed(w.unrelatedAnsweredByProtagonist);
      });

      it("should show my subscription's replies to non-subscribed users", async () => {
        expectDisplayed(w.unrelatedSub, { author: w.directSub });
        expectDisplayed(w.ownUnrelatedSub, { author: w.directSub });
      });

      it("should show my own replies to non-subscribed users", async () => {
        expectDisplayed(w.unrelatedOwn, { author: w.protagonist });
      });

      // TODO do we actually want that?
      it("should NOT display replies to unavailable posts", async () => {
        expectNotDisplayed(w.subUnavailableIndirect);
      });
    });  // My Network (posts based on subscriptions using full WOT)

    describe('Explore (showcasing unknown authors based on group notifications)', () => {
      let w: TestWorld;
      let controller: PostController;

      beforeAll(async () => {
        const node: VerityNodeIf = new DummyVerityNode(testOptions);
        await node.readyPromise;
        w = new TestWorld({ subscriptions: false, cubeStore: node.cubeStore });
        await w.ready;
        controller = new PostController({
          node,
          nav: new DummyNavController(),
          identity: w.protagonist,
          cockpit: new Cockpit(node, {identity: w.protagonist}),
        });
        await controller.navExplore();
        await new Promise((resolve) => setTimeout(resolve, 1000));  // posts will currently often only be learned through emit and not through the getAll-generator :(
        controller.contentAreaView.show();
      });

      // TODO BUGBUG Fails to display user name and I don't know why
      it.skip('should display my own root posts', async () => {
        expectDisplayed(w.own, { author: w.protagonist });
      });

      it("should display my direct subscription's posts", async () => {
        expectDisplayed(w.directUnreplied, { author: w.directSub });
      });

      it("should display indirect subscription's posts", async () => {
        expectDisplayed(w.indirectUnreplied, { author: w.indirectSub });
        expectDisplayed(w.thirdUnreplied, { author: w.thirdLevelSub });
      });

      it("should display my own replies to direct subscription's posts", async () => {
        expectDisplayed(w.directOwn, { author: w.protagonist });
      });

      it("should display my own replies to indirect subscription's posts", async () => {
        expectDisplayed(w.indirectOwn, { author: w.protagonist });
        expectDisplayed(w.thirdOwn, { author: w.protagonist });
      });

      it("should display my subscription's replies to my own posts", async () => {
        expectDisplayed(w.ownDirect, { author: w.directSub });
        expectDisplayed(w.ownIndirect, { author: w.indirectSub });
        expectDisplayed(w.ownThird, { author: w.thirdLevelSub });
      });

      it("should display my subscription's replies to my subscription's posts", async () => {
        expectDisplayed(w.directThird, { author: w.thirdLevelSub });
      });

      it('should show root posts by non-subscribed users', async () => {
        expectDisplayed(w.unrelatedUnanswered, { author: w.unrelatedId });
      });

      it('should show replies by non-subscribed users', async () => {
        expectDisplayed(w.ownUnrelatedUnanswered, { author: w.unrelatedId });
      });

      it('should show posts by non-subscribed users if subscribed users answered them', async () => {
        // expectDisplayed(w.ownUnrelatedAnswered, { author: w.unrelatedId });
        // TODO BUGBUG: currently unable to resolve the non-subscribed author;
        //              will display as unknown user
        expectDisplayed(w.ownUnrelatedAnswered);
      });

      it('should show posts by non-subscribed users if I answered them', async () => {
        // expectDisplayed(w.unrelatedAnsweredByProtagonist, { author: w.unrelatedId });
        // TODO BUGBUG: currently unable to resolve the non-subscribed author;
        //              will display as unknown user
        expectDisplayed(w.unrelatedAnsweredByProtagonist);
      });

      it("should show my subscription's replies to non-subscribed users", async () => {
        expectDisplayed(w.unrelatedSub, { author: w.directSub });
        expectDisplayed(w.ownUnrelatedSub, { author: w.directSub });
      });

      it("should show my own replies to non-subscribed users", async () => {
        expectDisplayed(w.unrelatedOwn, { author: w.protagonist });
      });

      // TODO do we actually want that?
      it("should NOT display replies to unavailable posts", async () => {
        expectNotDisplayed(w.subUnavailableIndirect);
      });
    });  // Explore
  });  // showing the correct posts

  describe('other correctness tests', () => {
    it.todo('does not show the same post multiple times');
    it.todo('shows embedded images');
  });

  describe('displaying post author', () => {
    it.todo('does not fail if an author Identity has no screen name');
    it.todo('will truncate overly long screen names');
  });

});


//###
// Helper functions
//###

interface ExpectDisplayedOptions {
  author?: Identity;
  replyto?: CubeKey|string;
}
function expectDisplayed(post: Veritable, options: ExpectDisplayedOptions = {}) {
  // first, do we need to check if this is a reply?
  // if it's a reply, it should be nested under the original post
  let containing: HTMLElement;
  if (options.replyto) {
    containing = document.querySelector(`.verityPost[data-cubekey="${keyVariants(options.replyto).keyString}"]`);
  } else {
    containing = document.body;
  }

  expect(containing).not.toBeNull();
  // fetch post li
  const postLi: HTMLElement = containing.querySelector(`.verityPost[data-cubekey="${post.getKeyStringIfAvailable()}"]`);
  expect(postLi).not.toBeNull();

  // check post content / text
  const payload = post.getFirstField(FieldType.PAYLOAD).valueString;
  const content: HTMLParagraphElement = postLi.querySelector(".verityPostContent");
  expect(content).not.toBeNull();
  expect(content.textContent).toBe(payload);

  // check post author name
  const authorField: HTMLElement = postLi.querySelector(".verityCubeAuthor");
  expect(authorField).not.toBeNull();
  if (options.author) expect(authorField.textContent).toBe(options.author.name);
}

function expectNotDisplayed(post: Veritable) {
  // fetch post li
  const postLi: HTMLElement = document.querySelector(`.verityPost[data-cubekey="${post.getKeyStringIfAvailable()}"]`);
  expect(postLi).toBe(null);
}
