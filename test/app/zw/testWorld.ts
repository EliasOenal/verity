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

export interface TestWorldOptions {
  subscriptions?: boolean;
  notifications?: boolean;
  cubeStore?: CubeStore;
}

export class TestWorld {
  cubeStore: CubeStore;
  private engine: ZwAnnotationEngine;
  identityOptions: IdentityOptions;

  protagonist: Identity;
  directSub: Identity;
  indirectSub: Identity;
  thirdLevelSub: Identity;
  unrelatedId: Identity;

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

  ready: Promise<void>;

  constructor(options: TestWorldOptions = {}) {
    // set default options
    options.subscriptions ??= true;
    options.notifications ??= true;

    this.identityOptions = { ...idTestOptions };
    if (options.notifications) {
      this.identityOptions.idmucNotificationKey = ZwConfig.NOTIFICATION_KEY;
    }

    this.cubeStore = options.cubeStore ?? new CubeStore(testCubeStoreParams);
    this.ready = (async () => {
      await this.cubeStore.readyPromise;
      this.createIdentities();
      if (options.subscriptions) this.makeSubscriptions();
      await this.makePosts();
      await this.storeIdentities();
    })();
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

  private createIdentities() {
    // Create Identities
    this.protagonist = new Identity(
      this.cubeStore,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 42),
      idTestOptions
    );
    this.protagonist.name = "protagonist";
    this.directSub = new Identity(
      this.cubeStore,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 43),
      idTestOptions
    );
    this.directSub.name = "directSub";
    this.indirectSub = new Identity(
      this.cubeStore,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44),
      idTestOptions
    );
    this.indirectSub.name = "indirectSub";
    this.thirdLevelSub = new Identity(
      this.cubeStore,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 45),
      idTestOptions
    );
    this.thirdLevelSub.name = "thirdLevelSub";
    this.unrelatedId = new Identity(
      this.cubeStore,
      Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 46),
      idTestOptions
    );
    this.unrelatedId.name = "unrelatedId";
  }

  private makeSubscriptions() {
    this.protagonist.addPublicSubscription(this.directSub.key);
    this.directSub.addPublicSubscription(this.indirectSub.key);
    this.indirectSub.addPublicSubscription(this.thirdLevelSub.key);
    // indirect sub is also subscribed to us, creating a circular subscription
    this.indirectSub.addPublicSubscription(this.protagonist.key);
  }

  private async makePosts() {
    // make posts:
    // - own post
    this.own = await makePost("Own post",
      { id: this.protagonist, requiredDifficulty: 0, store: this.cubeStore });
    // - reply to own post by direct sub
    this.ownDirect = await makePost("Reply to own post by direct sub",
      { id: this.directSub, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.cubeStore });
    // - reply to own post by indirect sub
    this.ownIndirect = await makePost("Reply to own post by indirect sub",
      { id: this.indirectSub, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.cubeStore });
    // - reply to own post by third level sub
    this.ownThird = await makePost("Reply to own post by third level sub",
      { id: this.thirdLevelSub, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.cubeStore });
    // - reply to own post by unrelated which will stay unanswered
    this.ownUnrelatedUnanswered = await makePost("Reply to own post by unrelated which will stay unanswered",
      { id: this.unrelatedId, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.cubeStore });
    // - reply to own post by unrelated which will be answered by sub
    this.ownUnrelatedAnswered = await makePost("Reply to own post by unrelated which will be answered by sub",
      { id: this.unrelatedId, requiredDifficulty: 0, replyto: await this.own.getKey(), store: this.cubeStore });
    // - sub's reply to unrelated's reply to own post
    this.ownUnrelatedSub = await makePost("Sub's reply to unrelated's reply to own post",
      { id: this.directSub, requiredDifficulty: 0, replyto: await this.ownUnrelatedAnswered.getKey(), store: this.cubeStore });

    // - posts by direct sub
    this.directUnreplied = await makePost("Post by direct sub",
      { id: this.directSub, requiredDifficulty: 0, store: this.cubeStore });
    this.directReplied = await makePost("Post by direct sub",
      { id: this.directSub, requiredDifficulty: 0, store: this.cubeStore });
    // - own reply
    this.directOwn = await makePost("Reply by protagonist",
      { id: this.protagonist, requiredDifficulty: 0, replyto: await this.directReplied.getKey(), store: this.cubeStore });
    // - reply by third level sub
    this.directThird = await makePost("Reply by third level sub",
      { id: this.thirdLevelSub, requiredDifficulty: 0, replyto: await this.directReplied.getKey(), store: this.cubeStore });

    // - posts by indirect sub
    this.indirectUnreplied = await makePost("Post by indirect sub",
      { id: this.indirectSub, requiredDifficulty: 0, store: this.cubeStore });
    this.indirectReplied = await makePost("Post by indirect sub",
      { id: this.indirectSub, requiredDifficulty: 0, store: this.cubeStore });
    // - own reply
    this.indirectOwn = await makePost("Reply by protagonist",
      { id: this.protagonist, requiredDifficulty: 0, replyto: await this.indirectReplied.getKey(), store: this.cubeStore });

    // - posts by third level sub
    this.thirdUnreplied = await makePost("Post by third level sub",
      { id: this.thirdLevelSub, requiredDifficulty: 0, store: this.cubeStore });
    this.thirdReplied = await makePost("Post by third level sub",
      { id: this.thirdLevelSub, requiredDifficulty: 0, store: this.cubeStore });
    // - own reply
    this.thirdOwn = await makePost("Reply by protagonist",
      { id: this.protagonist, requiredDifficulty: 0, replyto: await this.thirdReplied.getKey(), store: this.cubeStore });

    // - post by unrelated which will stay unanswered
    this.unrelatedUnanswered = await makePost("Post by unrelated which will stay unanswered",
      { id: this.unrelatedId, requiredDifficulty: 0, store: this.cubeStore });

    // - post by unrelated which will be answered by sub
    this.unrelatedAnsweredBySub = await makePost("Post by unrelated which will be answered by sub",
      { id: this.unrelatedId, requiredDifficulty: 0, store: this.cubeStore });
    // - sub's reply to unrelated
    this.unrelatedSub = await makePost("Sub's reply to unrelated",
      { id: this.directSub, requiredDifficulty: 0, replyto: await this.unrelatedAnsweredBySub.getKey(), store: this.cubeStore });

    // - post by unrelated which will have reply by protagonist
    this.unrelatedAnsweredByProtagonist = await makePost("Post by unrelated which will have reply by protagonist",
      { id: this.unrelatedId, requiredDifficulty: 0, store: this.cubeStore });
    // - protagonist's reply
    this.unrelatedOwn = await makePost("Protagonist's reply",
      { id: this.protagonist, requiredDifficulty: 0, replyto: await this.unrelatedAnsweredByProtagonist.getKey(), store: this.cubeStore });

    // - unavailable post by direct sub (note missing CubeStore reference)
    this.subUnavailable = await makePost("Unavailable post by direct sub",
      { id: this.directSub, requiredDifficulty: 0 });
    // - indirect's reply to unavailable post
    this.subUnavailableIndirect = await makePost("Indirect's reply to unavailable post",
      { id: this.indirectSub, requiredDifficulty: 0, replyto: await this.subUnavailable.getKey(), store: this.cubeStore });
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
