import { Cube } from "../../../src/core/cube/cube";
import { CubeInfo } from "../../../src/core/cube/cubeInfo";
import { CubeStore, CubeStoreOptions } from "../../../src/core/cube/cubeStore";

import { cciCube } from "../../../src/cci/cube/cciCube";
import { Identity, IdentityOptions } from "../../../src/cci/identity/identity";

import { ZwAnnotationEngine, SubscriptionRequirement } from "../../../src/app/zw/model/zwAnnotationEngine";
import { makePost } from "../../../src/app/zw/model/zwUtil";

import { testCubeStoreParams, idTestOptions } from "../../cci/testcci.definitions";

import sodium from "libsodium-wrappers-sumo";
import { Buffer } from 'buffer';
import { ZwConfig } from "../../../src/app/zw/model/zwConfig";
import { NotifyingIdentityEmitter } from "../../../src/app/zw/model/notifyingIdentityEmitter";
import { VeritumRetriever } from "../../../src/cci/veritum/veritumRetriever";

export interface TestWorldOptions {
  subscriptions?: boolean;
  notifications?: boolean;
  cubeStore?: CubeStore;
}

export class TestWorld {
  cubeStore: CubeStore;
  retriever: VeritumRetriever;
  private engine: ZwAnnotationEngine;
  identityOptions: IdentityOptions;

  posts: TestWordPostSet[] = [];

  protagonist: Identity;
  directSub: Identity;
  indirectSub: Identity;
  thirdLevelSub: Identity;
  unrelatedId: Identity;

  constructor(private options: TestWorldOptions = {}) {
    // set default options
    this.options.subscriptions ??= true;
    this.options.notifications ??= true;

    this.identityOptions = { ...idTestOptions };
    if (this.options.notifications) {
      this.identityOptions.idmucNotificationKey = ZwConfig.NOTIFICATION_KEY;
    }

    this.cubeStore = options.cubeStore ?? new CubeStore(testCubeStoreParams);
    this.retriever = new VeritumRetriever(this.cubeStore);
  }

  async setup(): Promise<void> {
    await this.cubeStore.readyPromise;
    this.createIdentities();
    if (this.options.subscriptions) this.makeSubscriptions();
    this.posts = [new TestWordPostSet(this, "")];
    await this.posts[0].makePosts();
    await this.storeIdentities();
  }

  /** For unit testing only, not to be used for integration/UI tests */
  async setFullWot(): Promise<void> {
    await this.protagonist.setSubscriptionRecursionDepth(1337); // go DEEP!
    this.engine = new ZwAnnotationEngine(
      this.protagonist,
      this.cubeStore,
      SubscriptionRequirement.subscribedReply,
      undefined,
      true,  // auto-learn MUCs (to be able to display authors when available)
      true,  // no need to filter anonymous posts as they won't be fed anyway
    );
  }

  /** For unit testing only, not to be used for integration/UI tests */
  async setExplore(): Promise<void> {
    const reEmitter = new NotifyingIdentityEmitter(this.cubeStore, this.protagonist.options.identityStore);
    this.engine = new ZwAnnotationEngine(
      reEmitter,
      this.cubeStore,
      SubscriptionRequirement.none,
      undefined,
      true,  // auto-learn MUCs (to be able to display authors when available)
      true,  // no need to filter anonymous posts as they won't be fed anyway
    );
  }

  /** For unit testing only, not to be used for integration/UI tests */
  async displayble(post: Cube | CubeInfo): Promise<boolean> {
    if (post instanceof Cube) post = await post.getCubeInfo();
    return this.engine.isCubeDisplayable(post);
  }

  createIdentities() {
    // Create Identities
    this.protagonist = new Identity(
      this.retriever,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42),
      this.identityOptions,
    );
    this.protagonist.name = "protagonist";
    this.directSub = new Identity(
      this.retriever,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43),
      this.identityOptions,
    );
    this.directSub.name = "directSub";
    this.indirectSub = new Identity(
      this.retriever,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44),
      this.identityOptions,
    );
    this.indirectSub.name = "indirectSub";
    this.thirdLevelSub = new Identity(
      this.retriever,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 45),
      this.identityOptions,
    );
    this.thirdLevelSub.name = "thirdLevelSub";
    this.unrelatedId = new Identity(
      this.retriever,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 46),
      this.identityOptions,
    );
    this.unrelatedId.name = "unrelatedId";
  }

  makeSubscriptions() {
    this.protagonist.addPublicSubscription(this.directSub.key);
    this.directSub.addPublicSubscription(this.indirectSub.key);
    this.indirectSub.addPublicSubscription(this.thirdLevelSub.key);
    // indirect sub is also subscribed to us, creating a circular subscription
    this.indirectSub.addPublicSubscription(this.protagonist.key);
  }

  private storeIdentities(): Promise<void> {
    const promises: Promise<cciCube>[] = [];
    // store Identities
    promises.push(this.protagonist.store());
    promises.push(this.directSub.store());
    promises.push(this.indirectSub.store());
    promises.push(this.thirdLevelSub.store());
    promises.push(this.unrelatedId.store());

    return Promise.all(promises).then();
  }
}

export class TestWordPostSet {
  own: Cube;
  ownDirect: Cube;
  ownIndirect: Cube;
  ownThird: Cube;
  ownUnrelatedUnanswered: Cube;
  ownUnrelatedAnswered: Cube;
  ownUnrelatedSub: Cube;

  directUnreplied: Cube;

  directReplied: Cube;
  directOwn: Cube;
  directThird: Cube;

  indirectUnreplied: Cube;

  indirectReplied: Cube;
  indirectOwn: Cube;

  thirdUnreplied: Cube;
  thirdReplied: Cube;
  thirdOwn: Cube;

  unrelatedUnanswered: Cube;

  unrelatedAnsweredBySub: Cube;
  unrelatedSub: Cube;

  unrelatedAnsweredByProtagonist: Cube;
  unrelatedOwn: Cube;

  subUnavailable: Cube;
  subUnavailableIndirect: Cube;

  constructor(
    private w: TestWorld,
    readonly suffix: string = "",
  ) {
  }

  async makePosts() {
    // make posts:
    // - own post
    this.own = await makePost("Own post" + this.suffix,
      { id: this.w.protagonist, requiredDifficulty: 0, store: this.w.cubeStore });
    // - reply to own post by direct sub
    this.ownDirect = await makePost("Reply to own post by direct sub" + this.suffix,
      { id: this.w.directSub, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.w.cubeStore });
    // - reply to own post by indirect sub
    this.ownIndirect = await makePost("Reply to own post by indirect sub" + this.suffix,
      { id: this.w.indirectSub, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.w.cubeStore });
    // - reply to own post by third level sub
    this.ownThird = await makePost("Reply to own post by third level sub" + this.suffix,
      { id: this.w.thirdLevelSub, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.w.cubeStore });
    // - reply to own post by unrelated which will stay unanswered
    this.ownUnrelatedUnanswered = await makePost("Reply to own post by unrelated which will stay unanswered" + this.suffix,
      { id: this.w.unrelatedId, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.w.cubeStore });
    // - reply to own post by unrelated which will be answered by sub
    this.ownUnrelatedAnswered = await makePost("Reply to own post by unrelated which will be answered by sub" + this.suffix,
      { id: this.w.unrelatedId, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.w.cubeStore });
    // - sub's reply to unrelated's reply to own post
    this.ownUnrelatedSub = await makePost("Sub's reply to unrelated's reply to own post" + this.suffix,
      { id: this.w.directSub, requiredDifficulty: 0, replyto: await this.ownUnrelatedAnswered.getKey(), store: this.w.cubeStore });

    // - posts by direct sub
    this.directUnreplied = await makePost("Post by direct sub" + this.suffix,
      { id: this.w.directSub, requiredDifficulty: 0, store: this.w.cubeStore });
    this.directReplied = await makePost("Post by direct sub" + this.suffix,
      { id: this.w.directSub, requiredDifficulty: 0, store: this.w.cubeStore });
    // - own reply
    this.directOwn = await makePost("Reply by protagonist" + this.suffix,
      { id: this.w.protagonist, requiredDifficulty: 0, replyto: await this.directReplied.getKey(), store: this.w.cubeStore });
    // - reply by third level sub
    this.directThird = await makePost("Reply by third level sub" + this.suffix,
      { id: this.w.thirdLevelSub, requiredDifficulty: 0, replyto: await this.directReplied.getKey(), store: this.w.cubeStore });

    // - posts by indirect sub
    this.indirectUnreplied = await makePost("Post by indirect sub" + this.suffix,
      { id: this.w.indirectSub, requiredDifficulty: 0, store: this.w.cubeStore });
    this.indirectReplied = await makePost("Post by indirect sub" + this.suffix,
      { id: this.w.indirectSub, requiredDifficulty: 0, store: this.w.cubeStore });
    // - own reply
    this.indirectOwn = await makePost("Reply by protagonist" + this.suffix,
      { id: this.w.protagonist, requiredDifficulty: 0, replyto: await this.indirectReplied.getKey(), store: this.w.cubeStore });

    // - posts by third level sub
    this.thirdUnreplied = await makePost("Post by third level sub" + this.suffix,
      { id: this.w.thirdLevelSub, requiredDifficulty: 0, store: this.w.cubeStore });
    this.thirdReplied = await makePost("Post by third level sub" + this.suffix,
      { id: this.w.thirdLevelSub, requiredDifficulty: 0, store: this.w.cubeStore });
    // - own reply
    this.thirdOwn = await makePost("Reply by protagonist" + this.suffix,
      { id: this.w.protagonist, requiredDifficulty: 0, replyto: await this.thirdReplied.getKey(), store: this.w.cubeStore });

    // - post by unrelated which will stay unanswered
    this.unrelatedUnanswered = await makePost("Post by unrelated which will stay unanswered" + this.suffix,
      { id: this.w.unrelatedId, requiredDifficulty: 0, store: this.w.cubeStore });

    // - post by unrelated which will be answered by sub
    this.unrelatedAnsweredBySub = await makePost("Post by unrelated which will be answered by sub" + this.suffix,
      { id: this.w.unrelatedId, requiredDifficulty: 0, store: this.w.cubeStore });
    // - sub's reply to unrelated
    this.unrelatedSub = await makePost("Sub's reply to unrelated" + this.suffix,
      { id: this.w.directSub, requiredDifficulty: 0, replyto: await this.unrelatedAnsweredBySub.getKey(), store: this.w.cubeStore });

    // - post by unrelated which will have reply by protagonist
    this.unrelatedAnsweredByProtagonist = await makePost("Post by unrelated which will have reply by protagonist" + this.suffix,
      { id: this.w.unrelatedId, requiredDifficulty: 0, store: this.w.cubeStore });
    // - protagonist's reply
    this.unrelatedOwn = await makePost("Protagonist's reply" + this.suffix,
      { id: this.w.protagonist, requiredDifficulty: 0, replyto: await this.unrelatedAnsweredByProtagonist.getKey(), store: this.w.cubeStore });

    // - unavailable post by direct sub (note missing CubeStore reference)
    this.subUnavailable = await makePost("Unavailable post by direct sub" + this.suffix,
      { id: this.w.directSub, requiredDifficulty: 0 });
    // - indirect's reply to unavailable post
    this.subUnavailableIndirect = await makePost("Indirect's reply to unavailable post" + this.suffix,
      { id: this.w.indirectSub, requiredDifficulty: 0, replyto: await this.subUnavailable.getKey(), store: this.w.cubeStore });
  }
}
