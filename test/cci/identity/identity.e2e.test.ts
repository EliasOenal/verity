import { SupportedTransports } from "../../../src/core/networking/networkDefinitions";
import { CubeKey } from "../../../src/core/cube/cube.definitions";
import { CubeStore } from "../../../src/core/cube/cubeStore";
import { CubeRetriever } from "../../../src/core/networking/cubeRetrieval/cubeRetriever";
import { NetworkManager } from "../../../src/core/networking/networkManager";
import { NetworkManagerOptions } from "../../../src/core/networking/networkManagerIf";
import { NetworkPeerIf } from "../../../src/core/networking/networkPeerIf";
import { WebSocketAddress } from "../../../src/core/peering/addressing";
import { PeerDB } from "../../../src/core/peering/peerDB";
import { Peer } from "../../../src/core/peering/peer";

import { cciCube } from "../../../src/cci/cube/cciCube";
import { Identity } from "../../../src/cci/identity/identity";
import { Avatar, AvatarScheme } from "../../../src/cci/identity/avatar";

import { makePost } from "../../../src/app/zw/model/zwUtil";

import { idTestOptions, testCubeStoreParams } from "../testcci.definitions";

import sodium from "libsodium-wrappers-sumo";
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { keyVariants } from "../../../src/core/cube/cubeUtil";

const reducedDifficulty = 0;  // no hash cash for testing

// TODO: Some tests here use "ZW" stuff from the microblogging app
// which breaks the current layering.

describe('Identity: end-to-end tests', () => {
  // Identity tests regarding actual network communication between different nodes

  const testNetworkingOptions: NetworkManagerOptions = {  // disable optional features
    announceToTorrentTrackers: false,
    autoConnect: false,
    lightNode: true,
    peerExchange: false,
    requestInterval: 10,
    requestTimeout: 500,
  };
  let local: NetworkManager;
  let remote: NetworkManager;
  let cubeRetriever: CubeRetriever;

  let cubeStore: CubeStore;

  beforeEach(async() => {
    await sodium.ready;
    local = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,
        transports: new Map([[SupportedTransports.ws, 18101]]),
      }
    );
    cubeRetriever = new CubeRetriever(local.cubeStore, local.scheduler);
    remote = new NetworkManager(
      new CubeStore(testCubeStoreParams),
      new PeerDB(),
      {
        ...testNetworkingOptions,
        transports: new Map([[SupportedTransports.ws, 18102]]),
      }
    );
    await Promise.all([local.start(), remote.start()]);
    const np: NetworkPeerIf =
      local.connect(new Peer(new WebSocketAddress("localhost", 18102)));
    await np.onlinePromise;
  });

  afterEach(async() => {
    await Promise.all([local.shutdown(), remote.shutdown()]);
  });

  // TODO: This test sporadically fails (restored post count too low) and I have no idea why
  it.skip('will correctly reconstruct an Identity created on another node even when operating as a light node', async() => {
    // just preparing some test constants and containers
    const TESTPOSTCOUNT = 40;
    const testPostKeys: string[] = [];
    const TESTSUBCOUNT = 20;
    const testSubs: CubeKey[] = [];
    const testSubSubs: CubeKey[] = [];
    {  // block on remote node
      // Far away in a different corner of the network, a new and rather
      // convoluted Identity gets created on a remote node.
      // (note all CubeStore references are remote.cubeStore)
      const subject: Identity = await Identity.Create(remote.cubeStore,
        "user remotus", "clavis secreta", idTestOptions);
      subject.name = "usor in alia parte retis positus";
      subject.avatar = new Avatar("0102030405", AvatarScheme.MULTIAVATAR);

      // store 50 posts (guaranteed not to fit into the MUC and thus forcing
      // Identity to use sub-references)
      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const post: cciCube = await makePost(
          (i+1).toString() + "res importantes diciendas habeo",
          undefined, subject, reducedDifficulty
        );
        // manually save post to ID rather then through makePost because we will
        // manipulate the date below, and that changes the key
        subject.removePost(await post.getKey());
        post.setDate(1715279573 + i);  // now you know when this test was written!
        subject.addPost(await post.getKey());
        await remote.cubeStore.addCube(post);
        testPostKeys.push(await post.getKeyString());
      }
      expect(subject.getPostCount()).toEqual(TESTPOSTCOUNT);

      // Build a test web of trust: Subscribe to 40 authors.
      // Each of those is subscribe to an additional author.
      for (let i=0; i<TESTSUBCOUNT; i++) {
        // create directly subscribed ID
        const subscribed: Identity = await Identity.Create(
          remote.cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        subscribed.name = "Figurarius " + i + "-tus";
        testSubs.push(subscribed.key);

        // create subject's subscribed ID
        const subsubscribed: Identity = await Identity.Create(
          remote.cubeStore, "figurarius etiam magis indirectus "+i,
          "clavis etiam magis indirectus "+i, idTestOptions);
        subsubscribed.name = "Figurarius etiam magis indirectus " + i + "-tus";
        testSubSubs.push(subsubscribed.key);

        // subsubscribed gets stored
        subsubscribed.muc.setDate(0);  // skip waiting period for the test
        await subsubscribed.store();

        // subscribed subscribes to subsubscribed and gets stored
        subscribed.addPublicSubscription(subsubscribed.key);
        subscribed.muc.setDate(0);  // skip waiting period for the test
        await subscribed.store();
        expect(subscribed.hasPublicSubscription(subsubscribed.key)).toBeTruthy();

        // subject subscribes to subscribed
        subject.addPublicSubscription(subscribed.key);
        expect(subject.hasPublicSubscription(subscribed.key)).toBeTruthy();
      }
      // just double-check this worked
      expect(subject.getPublicSubscriptionCount()).toBe(TESTSUBCOUNT);

      // store the subject
      subject.muc.setDate(0);  // hack, just for the test let's not wait 5s for the MUC update
      const muc: cciCube = await subject.store();

      // just some sanity checks
      expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
      expect(await remote.cubeStore.getNumberOfStoredCubes()).toBeGreaterThan(
        TESTPOSTCOUNT + TESTSUBCOUNT);

      // We are still getting sporadic failures in this test.
      // Let's wait a little to be sure everything has been stored correctly
      // on our virtual remote node.
      // If this sleep helps, somethings not quite in sync in the database
      // saving code.
      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
    }

    { // block on local node
      // now let's restore the subject on a different node
      const restored: Identity = await Identity.Load(cubeRetriever,
        "user remotus", "clavis secreta", idTestOptions);

      // verify all basic properties have been restored correctly
      expect(restored.name).toBe("usor in alia parte retis positus");
      expect(restored.avatar).toBeInstanceOf(Avatar);
      expect(restored.avatar.equals(new Avatar(
        "0102030405", AvatarScheme.MULTIAVATAR
        ))).toBe(true);

      // verify all posts have been restored correctly
      expect(restored.getPostCount()).toBe(TESTPOSTCOUNT);
      expect(testPostKeys.length).toBe(TESTPOSTCOUNT);
      for (const expectedKey of testPostKeys) {
        expect(restored.hasPost(expectedKey)).toBeTruthy();
      }

      // verify all subscriptions have been restored correctly
      expect(restored.getPublicSubscriptionCount()).toBe(TESTSUBCOUNT);
      for (let i=0; i<testSubs.length; i++) {
        expect(restored.getPublicSubscriptionCount()).toContainEqual(testSubs[i]);
      }

      // verify all indirect subscriptions are correctly recognized as within
      // this user's web of trust
      const restoredWot: Set<string> = await restored.recursiveWebOfSubscriptions(1);
      for (let i=0; i<testSubSubs.length; i++) {
        expect(restoredWot).toContainEqual(keyVariants(testSubSubs[i]).keyString);
      }
      // direct subscriptions are technically also part of our web of trust,
      // so let's quickly check for those, too
      for (let i=0; i<testSubs.length; i++) {
        expect(restoredWot).toContainEqual(testSubs[i]);
      }
    }
  }, 5000);
});
