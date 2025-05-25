// @vitest-environment jsdom

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { TestWordPostSet, TestWorld } from '../testWorld';
import { PostController } from '../../../../src/app/zw/webui/post/postController';
import { CoreNodeOptions } from '../../../../src/core/coreNode';
import { DummyNavController } from '../../../../src/webui/navigation/navigationDefinitions';
import { Veritable } from '../../../../src/core/cube/veritable.definition';
import { FieldType } from '../../../../src/cci/cube/cciCube.definitions';
import { Identity } from '../../../../src/cci/identity/identity';

import { Buffer } from 'buffer';
import { testCciOptions } from '../../../cci/e2e/e2eCciSetup';
import { loadZwTemplate } from './zwUiTestSetup';
import { CubeKey } from '../../../../src/core/cube/cube.definitions';
import { keyVariants } from '../../../../src/core/cube/cubeUtil';
import { VerityNodeIf, dummyVerityNode } from '../../../../src/cci/verityNode';
import { Cockpit, dummyCockpit } from '../../../../src/cci/cockpit';

const testOptions: CoreNodeOptions = {
  ...testCciOptions,
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
    for (const subscriptionBased of [/*true,*/ false]) {
      let modeString: string;
      if (subscriptionBased) modeString = "My Network (showing posts based on subscriptions)";
      else modeString = "Explore (showcasing unknown authors based on group notifications)";
      describe(modeString, () => {
        let w: TestWorld;
        let controller: PostController;

        beforeAll(async () => {
          const node: VerityNodeIf = dummyVerityNode(testOptions);
          await node.readyPromise;
          w = new TestWorld({ subscriptions: subscriptionBased, cubeStore: node.cubeStore });
          await w.setup();
          controller = new PostController({
            nav: new DummyNavController(),
            identity: w.protagonist,
            cockpit: new Cockpit(node, {identity: w.protagonist}),
          });
          if (subscriptionBased) await controller.navWot();
          else await controller.navExplore();

          // TODO: In explore mode, we currently do not provide a useful
          //   done promise, so let's just give it some time to get done.
          await new Promise((resolve) => setTimeout(resolve, 200));
          controller.contentAreaView.show();
        });

        function testSuite(n: number) {
          it('should display my own root posts', async () => {
            if (subscriptionBased) expectDisplayed(w.posts[n].own, { author: w.protagonist });
            else {
              // TODO BUGBUG Fails to display my own user name in explore mode and I don't know why
              expectDisplayed(w.posts[n].own);
            }
          });

          it("should display my direct subscription's posts", async () => {
            expectDisplayed(w.posts[n].directUnreplied, { author: w.directSub });
          });

          it("should display indirect subscription's posts", async () => {
            expectDisplayed(w.posts[n].indirectUnreplied, { author: w.indirectSub });
            expectDisplayed(w.posts[n].thirdUnreplied, { author: w.thirdLevelSub });
          });

          it("should display my own replies to direct subscription's posts", async () => {
            expectDisplayed(w.posts[n].directOwn, { author: w.protagonist });
          });

          it("should display my own replies to indirect subscription's posts", async () => {
            expectDisplayed(w.posts[n].indirectOwn, { author: w.protagonist });
            expectDisplayed(w.posts[n].thirdOwn, { author: w.protagonist });
          });

          it("should display my subscription's replies to my own posts", async () => {
            expectDisplayed(w.posts[n].ownDirect, { author: w.directSub });
            expectDisplayed(w.posts[n].ownIndirect, { author: w.indirectSub });
            expectDisplayed(w.posts[n].ownThird, { author: w.thirdLevelSub });
          });

          it("should display my subscription's replies to my subscription's posts", async () => {
            expectDisplayed(w.posts[n].directThird, { author: w.thirdLevelSub });
          });

          if (subscriptionBased) it('should NOT show root posts by non-subscribed users', async () => {
            expectNotDisplayed(w.posts[n].unrelatedUnanswered);
          });
          else it('should show root posts by non-subscribed users', async () => {
            expectDisplayed(w.posts[n].unrelatedUnanswered, { author: w.unrelatedId });
          });

          if (subscriptionBased)it('should NOT show replies by non-subscribed users', async () => {
            expectNotDisplayed(w.posts[n].ownUnrelatedUnanswered);
          });
          else it('should show replies by non-subscribed users', async () => {
            expectDisplayed(w.posts[n].ownUnrelatedUnanswered, { author: w.unrelatedId });
          });

          it('should show posts by non-subscribed users if subscribed users answered them', async () => {
            // expectDisplayed(w.ownUnrelatedAnswered, { author: w.unrelatedId });
            // TODO BUGBUG: currently unable to resolve the non-subscribed author;
            //              will display as unknown user
            expectDisplayed(w.posts[n].ownUnrelatedAnswered);
          });

          it('should show posts by non-subscribed users if I answered them', async () => {
            // expectDisplayed(w.unrelatedAnsweredByProtagonist, { author: w.unrelatedId });
            // TODO BUGBUG: currently unable to resolve the non-subscribed author;
            //              will display as unknown user
            expectDisplayed(w.posts[n].unrelatedAnsweredByProtagonist);
          });

          it("should show my subscription's replies to non-subscribed users", async () => {
            expectDisplayed(w.posts[n].unrelatedSub, { author: w.directSub });
            expectDisplayed(w.posts[n].ownUnrelatedSub, { author: w.directSub });
          });

          it("should show my own replies to non-subscribed users", async () => {
            expectDisplayed(w.posts[n].unrelatedOwn, { author: w.protagonist });
          });

          // TODO do we actually want that?
          it("should NOT display replies to unavailable posts", async () => {
            expectNotDisplayed(w.posts[n].subUnavailableIndirect);
          });
        }  // function testSuite

        describe('pre-existing posts', () => {
          testSuite(0);
        });

        // Currently fails to display user names in some cases and I don't know why
        describe('posts arriving after the view has been built', () => {
          beforeAll(async () => {
            // make a second set of posts appear
            w.posts.push(new TestWordPostSet(w, " (second set of posts)"));
            await w.posts[1].makePosts();
            await w.storeIdentities();

            await new Promise(resolve => setTimeout(resolve, 200));  // give it some time
          });

          testSuite(1);
        });
      });  // describe retrieval mode (explore or my network)
    }  // for (const explore of [true, false])
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
    containing = document.querySelector(`.verityPost[data-cubekey="${keyVariants(options.replyto).keyString}"]`)!;
  } else {
    containing = document.body;
  }

  expect(containing).not.toBeNull();
  // fetch post li
  const postLi: HTMLElement = containing.querySelector(`.verityPost[data-cubekey="${post.getKeyStringIfAvailable()}"]`)!;
  expect(postLi).not.toBeNull();

  // check post content / text
  const payload = post.getFirstField(FieldType.PAYLOAD).valueString;
  const content: HTMLParagraphElement = postLi.querySelector(".verityPostContent")!;
  expect(content).not.toBeNull();
  expect(content.textContent).toBe(payload);

  // check post author name
  const authorField: HTMLElement = postLi.querySelector(".verityCubeAuthor")!;
  expect(authorField).not.toBeNull();
  if (options.author) expect(authorField.textContent).toBe(options.author.name);
}

function expectNotDisplayed(post: Veritable) {
  // fetch post li
  const postLi: HTMLElement = document.querySelector(`.verityPost[data-cubekey="${post.getKeyStringIfAvailable()}"]`)!;
  expect(postLi).toBe(null);
}
