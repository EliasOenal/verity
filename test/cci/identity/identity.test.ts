import { CubeKey } from '../../../src/core/cube/cube.definitions';
import { CubeStore, CubeStoreOptions } from '../../../src/core/cube/cubeStore';
import { Cube } from '../../../src/core/cube/cube'

import { NetConstants, SupportedTransports } from '../../../src/core/networking/networkDefinitions';
import { NetworkManager, NetworkManagerOptions } from '../../../src/core/networking/networkManager';
import { CubeRetriever } from '../../../src/core/networking/cubeRetrieval/cubeRetriever';
import { NetworkPeer } from '../../../src/core/networking/networkPeer';

import { WebSocketAddress } from '../../../src/core/peering/addressing';
import { Peer } from '../../../src/core/peering/peer';
import { PeerDB } from '../../../src/core/peering/peerDB';

import { cciFieldType, MediaTypes } from '../../../src/cci/cube/cciCube.definitions';
import { cciFieldParsers, cciFields } from '../../../src/cci/cube/cciFields';
import { cciField } from '../../../src/cci/cube/cciField';
import { cciRelationshipType, cciRelationship } from '../../../src/cci/cube/cciRelationship';
import { cciCube, cciFamily } from '../../../src/cci/cube/cciCube';

import { Identity, IdentityOptions } from '../../../src/cci/identity/identity'
import { Avatar, AvatarScheme } from '../../../src/cci/identity/avatar';
import { IdentityPersistence } from '../../../src/cci/identity/identityPersistence';

import { makePost } from '../../../src/app/zw/model/zwUtil';

import sodium from 'libsodium-wrappers-sumo'

// maybe TODO: Some tests here use "ZW" stuff from the microblogging app
// which breaks the current layering.

describe('Identity', () => {
  const reducedDifficulty = 0;  // no hash cash for testing
  let idTestOptions: IdentityOptions;
  let testCubeStoreParams: CubeStoreOptions;
  let cubeStore: CubeStore;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    idTestOptions = {
      minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
      requiredDifficulty: reducedDifficulty,
      argonCpuHardness: 1,  // == crypto_pwhash_OPSLIMIT_MIN (sodium not ready)
      argonMemoryHardness: 8192, // == sodium.crypto_pwhash_MEMLIMIT_MIN (sodium not ready)
    };
    testCubeStoreParams = {
      inMemory: true,
      enableCubeCache: false,
      enableCubeRetentionPolicy: false,
      requiredDifficulty: 0,
      family: cciFamily,
    };
    cubeStore = new CubeStore(testCubeStoreParams);
    await cubeStore.readyPromise;
  });

  describe('own posts', () => {
    it('restores its post list recursively', async () => {
      const TESTPOSTCOUNT = 50;  // 50 keys are more than guaranteed not to fit in the MUC
      const testPostKeys: string[] = [];

      const original: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      original.name = "Probator memoriae tabellae";
      const idkey = original.publicKey;

      for (let i=0; i<TESTPOSTCOUNT; i++) {
        const post: cciCube = await makePost("I got " + (i+1).toString() + " important things to say", undefined, original, reducedDifficulty);
        const key: CubeKey = post.getKeyIfAvailable();
        expect(key).toBeDefined();
        const keyString: string = post.getKeyStringIfAvailable();
        expect(keyString).toBeDefined();
        testPostKeys.push(keyString);
        await cubeStore.addCube(post);
      }
      expect(original.posts.length).toEqual(TESTPOSTCOUNT);
      expect(testPostKeys.length).toEqual(TESTPOSTCOUNT);

      await original.store();
      const muc: cciCube = original.muc;
      await cubeStore.addCube(muc);

      const restored: Identity = await Identity.Construct(cubeStore, await cubeStore.getCube(idkey) as cciCube)
      expect(restored.posts.length).toEqual(TESTPOSTCOUNT);
      for (let i=0; i<restored.posts.length; i++) {
        const restoredPostKey: string = restored.posts[i].toString('hex');
        expect(restoredPostKey).toHaveLength(NetConstants.CUBE_KEY_SIZE*2);  // *2 due to string representation
        expect(testPostKeys).toContain(restoredPostKey);
      }
    }, 5000);

    it('will not fail on circular post references', async() => {
      // Note that unlike regular posts, at least one of those has to be a MUC.
      // With regular posts, circular references are impossible as you'd need
      // to know both post's keys to create the reference, but creating the
      // reference will change the key.
      // We do however still want the Identity module to withstand such nonsense
      // and also to allow applications to use MUCs as posts, hence this test.
      const postKeyPair = sodium.crypto_sign_keypair();
      const postPubKey: Buffer = Buffer.from(postKeyPair.publicKey);
      const postPrivKey: Buffer = Buffer.from(postKeyPair.privateKey);
      // Prepare the first post which will later complete the circular reference
      const postA: cciCube = cciCube.MUC(postPubKey, postPrivKey, {
        requiredDifficulty: reducedDifficulty,
        fields: [
          cciField.Application(("Test")),
          cciField.MediaType(MediaTypes.TEXT),
          cciField.Payload("Per mentionem ad aliam tabulam, circulum mentionis creo"),
          // post reference can only be added later as we don't know the key yet
        ]
      });
      const keyA: CubeKey = postA.getKeyIfAvailable();  // MUC keys are always available
      // Craft the second post
      const postB: cciCube = cciCube.Frozen({
        requiredDifficulty: reducedDifficulty,
        fields: [
          cciField.Application(("Test")),
          cciField.MediaType(MediaTypes.TEXT),
          cciField.Payload("Hoc est ordinarius tabulae mentionem"),
          cciField.RelatesTo(new cciRelationship(
            cciRelationshipType.MYPOST, keyA)),
        ]
      });
      const keyB: CubeKey = await postB.getKey();  // implicitly compiles postB
      await cubeStore.addCube(postB);
      // complete circular reference
      postA.fields.insertFieldBeforeBackPositionals(
        cciField.RelatesTo(new cciRelationship(
          cciRelationshipType.MYPOST, keyB)));
      await postA.compile();
      await cubeStore.addCube(postA);
      // Now craft an Identity MUC referring to postB
      const idKeyPair = sodium.crypto_sign_keypair();
      const idPubKey: Buffer = Buffer.from(idKeyPair.publicKey);
      const idPrivKey: Buffer = Buffer.from(idKeyPair.privateKey);
      const idMuc: cciCube = cciCube.MUC(idPubKey, idPrivKey, {
        requiredDifficulty: reducedDifficulty,
        fields: [
          cciField.Application("ID"),
          cciField.Username("Usor confusus"),
          cciField.RelatesTo(new cciRelationship(
            cciRelationshipType.MYPOST, keyB)),
        ]
      });
      await idMuc.compile();
      await cubeStore.addCube(idMuc);
      // verify we have indeed created a circular reference
      expect(idMuc.fields.getFirstRelationship(
        cciRelationshipType.MYPOST).remoteKey).toEqual(keyB);
      expect(postB.fields.getFirstRelationship(
        cciRelationshipType.MYPOST).remoteKey).toEqual(keyA);
      expect(postA.fields.getFirstRelationship(
        cciRelationshipType.MYPOST).remoteKey).toEqual(keyB);
      // now try an Identity restore from this MUC
      const restored: Identity =
        await Identity.Construct(cubeStore, idMuc, idTestOptions);
      // restored Identity should correctly list two posts, A and B
      expect(restored.posts).toHaveLength(2);
      expect(restored.posts).toContainEqual(keyA);
      expect(restored.posts).toContainEqual(keyB);
    });

    // recursion depth limit not implemented yet
    it.todo('will not recurse deeper than the specified limit while restoring post list');
  });

  describe('subscription recommendations', ()  => {
    it('correctly identifies authors as subscribed or not subscribed', async () => {
      const subject: Identity = await Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor novarum interessantiarum";

      // Create 10 subscribed and 10 non-subscribed authors
      const TESTSUBCOUNT = 10;
      const subscribed: CubeKey[] = [];
      const nonsubscribed: CubeKey[] = [];

      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
          cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        other.name = "Figurarius subscriptus numerus " + i;
        other.muc.setDate(0);  // skip waiting period for the test
        other.store();
        subscribed.push(other.key);
        subject.addSubscriptionRecommendation(other.key);
        expect(subject.subscriptionRecommendations[i].equals(other.key)).toBeTruthy();
      }
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
          cubeStore, "non implicatus "+i, "secretum"+i, idTestOptions);
        other.name = "Persona non implicata " + i;
        other.muc.setDate(0);  // skip waiting period for the test
        other.store();
        nonsubscribed.push(other.key);
      }

      // verify subscription status
      for (let i=0; i<TESTSUBCOUNT; i++) {
        expect(subject.isSubscribed(subscribed[i])).toBeTruthy();
        expect(subject.isSubscribed(nonsubscribed[i])).toBeFalsy();
      }
    });

    it('preserves extension MUC keys and does not update unchanged MUCs when adding subscriptions', async () => {
      // Create a subject. First subscribe 40 authors, then add one more.
      const TESTSUBCOUNT = 40;
      const subject: Identity = await Identity.Create(
        cubeStore, "subscriptor", "clavis mea", idTestOptions);
      subject.name = "Subscriptor consuentus novarum interessantiarum";
      for (let i=0; i<TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
          cubeStore, "figurarius"+i, "clavis"+i, idTestOptions);
        other.name = "Figurarius " + i + "-tus";
        other.muc.setDate(0);  // skip waiting period for the test
        other.store();
        subject.addSubscriptionRecommendation(other.key);
        expect(subject.subscriptionRecommendations[i].equals(other.key)).toBeTruthy();
      }
      subject.muc.setDate(0);  // hack, just for the test let's not wait 5s for the MUC update
      const muc: cciCube = await subject.store();

      // Good, 40 added. Now let's have a look at the extension MUCs.
      const firstExtensionMuc: cciCube = subject.subscriptionRecommendationIndices[0];
      const firstExtensionMucKey: CubeKey = firstExtensionMuc.getKeyIfAvailable();
      expect(firstExtensionMucKey).toBeInstanceOf(Buffer);
      const firstExtensionMucHash: Buffer = firstExtensionMuc.getHashIfAvailable();
      expect(firstExtensionMucHash).toBeInstanceOf(Buffer);

      const secondExtensionMuc: cciCube = subject.subscriptionRecommendationIndices[1];
      const secondExtensionMucKey: CubeKey = secondExtensionMuc.getKeyIfAvailable();
      expect(secondExtensionMucKey).toBeInstanceOf(Buffer);
      const secondExtensionMucHash: Buffer = secondExtensionMuc.getHashIfAvailable();
      expect(secondExtensionMucHash).toBeInstanceOf(Buffer);

      // Now add one more subscription
      const plusone: Identity = await Identity.Create(
        cubeStore, "adiectus", "secretum", idTestOptions);
      plusone.name = "Figurarius adiectus"
      plusone.muc.setDate(0);  // accelerate test
      plusone.store();
      subject.addSubscriptionRecommendation(plusone.key);
      subject.muc.setDate(0);  // accelarate test
      await subject.store();

      // Extension MUC keys should not have changed.
      // First extension MUC hash should not have changed either,
      // but the second one's must have.
      const firstExtensionMucAfterChange: cciCube = subject.subscriptionRecommendationIndices[0];
      const firstExtensionMucKeyAfterChange: CubeKey = firstExtensionMucAfterChange.getKeyIfAvailable();
      expect(firstExtensionMucKeyAfterChange).toBeInstanceOf(Buffer);
      const firstExtensionMucHashAfterChange: Buffer = firstExtensionMucAfterChange.getHashIfAvailable();
      expect(firstExtensionMucHashAfterChange).toBeInstanceOf(Buffer);
      expect(firstExtensionMucKeyAfterChange.equals(firstExtensionMucKey)).toBeTruthy();
      // expect(firstExtensionMucHashAfterChange.equals(firstExtensionMucHash)).toBeTruthy();  // TODO fix -- the first extension should not have been re-sculpted since it's subscription content has not changed and it's relationship to the changed second extension MUC has not changed either (as MUC keys don't change)

      const secondExtensionMucAfterChange: cciCube = subject.subscriptionRecommendationIndices[1];
      const secondExtensionMucKeyAfterChange: CubeKey = secondExtensionMucAfterChange.getKeyIfAvailable();
      expect(secondExtensionMucKeyAfterChange).toBeInstanceOf(Buffer);
      const secondExtensionMucHashAfterChange: Buffer = secondExtensionMucAfterChange.getHashIfAvailable();
      expect(secondExtensionMucHashAfterChange).toBeInstanceOf(Buffer);
      expect(secondExtensionMucKeyAfterChange.equals(secondExtensionMucKey)).toBeTruthy();
      expect(secondExtensionMucHashAfterChange.equals(secondExtensionMucHash)).toBeFalsy();
    });

    it("correctly saves and restores recommended subscriptions to and from extension MUCs", async () => {
      // Create a subject and subscribe 40 other authors
      const TESTSUBCOUNT = 40;
      const subject: Identity = await Identity.Create(
        cubeStore,
        "subscriptor",
        "clavis mea",
        idTestOptions
      );
      subject.name = "Subscriptor novarum interessantiarum";
      for (let i = 0; i < TESTSUBCOUNT; i++) {
        const other: Identity = await Identity.Create(
          cubeStore,
          "figurarius" + i,
          "clavis" + i,
          idTestOptions
        );
        other.name = "Figurarius " + i + "-tus";
        other.muc.setDate(0); // skip waiting period for the test
        other.store();
        subject.addSubscriptionRecommendation(other.key);
        expect(
          subject.subscriptionRecommendations[i].equals(other.key)
        ).toBeTruthy();
      }
      subject.muc.setDate(0); // hack, just for the test let's not wait 5s for the MUC update
      const muc: cciCube = await subject.store();

      // Master MUC stored in CubeStore?
      const recovered_muc: cciCube = await cubeStore.getCube(subject.key) as cciCube;
      expect(recovered_muc).toBeInstanceOf(cciCube);

      // First subscription recommendation index saved in MUC?
      const fields: cciFields = recovered_muc.fields as cciFields;
      expect(fields).toBeInstanceOf(cciFields);
      const rel: cciRelationship = fields.getFirstRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX
      );
      expect(rel.remoteKey).toBeInstanceOf(Buffer);
      expect(
        rel.remoteKey.equals(
          subject.subscriptionRecommendationIndices[0].getKeyIfAvailable()
        )
      ).toBeTruthy();
      // First subscription recommendation index saved in CubeStore?
      const firstIndexCube: cciCube = await cubeStore.getCube(
        rel.remoteKey
      ) as cciCube;
      expect(firstIndexCube).toBeInstanceOf(cciCube);
      // First subscription recommendation index contains for subscription recommendation?
      expect(firstIndexCube.fields).toBeInstanceOf(cciFields);
      expect(firstIndexCube.fields.length).toBeGreaterThan(1);
      expect(
        firstIndexCube.fields
          .getFirstRelationship(cciRelationshipType.SUBSCRIPTION_RECOMMENDATION)
          .remoteKey.equals(subject.subscriptionRecommendations[0])
      ).toBeTruthy();

      // Second subscription recommendation index referred from first one?
      const secondIndexRel: cciRelationship =
        firstIndexCube.fields.getFirstRelationship(
          cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX
        );
      expect(secondIndexRel).toBeInstanceOf(cciRelationship);
      const secondIndexCube: cciCube = await cubeStore.getCube(
        secondIndexRel.remoteKey
      ) as cciCube;
      expect(secondIndexCube).toBeInstanceOf(cciCube);

      // let's put it all together:
      // all subscription recommendations correctly restored?
      const restored: Identity = await Identity.Construct(cubeStore, muc);
      expect(restored.subscriptionRecommendations.length).toEqual(TESTSUBCOUNT);
      for (let i = 0; i < TESTSUBCOUNT; i++) {
        const othermuc = await cubeStore.getCube(
          restored.subscriptionRecommendations[i]
        ) as cciCube;
        expect(othermuc).toBeInstanceOf(cciCube);
        const restoredother: Identity = await Identity.Construct(cubeStore, othermuc);
        expect(restoredother.name).toEqual("Figurarius " + i + "-tus");
      }
    }, 5000);

    it.todo('will not fail on circular subscription recommendation index cubes');
  });  // describe subscription recommendations

  describe('remote updates', () => {
    it('will preserve posts written, users subscribed to as well as name and avatar changes performed on another device', async() => {
      // create an Identity
      const id: Identity = await Identity.Create(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      // make a post and set some user attributes
      id.name = "Dominus plurium apparatorum";
      id.avatar = new Avatar("1234567890", AvatarScheme.MULTIAVATAR);
      await cubeStore.addCube(await makePost(
        "Hoc est scriptum in computatore domi meae",
        undefined, id, reducedDifficulty));
      await id.store();
      // expect everything to be saved correctly
      expect(id.name).toEqual("Dominus plurium apparatorum")
      expect(id.avatar.seedString).toEqual("1234567890");
      expect(id.posts.length).toBe(1);
      expect((await cubeStore.getCube(id.posts[0])).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf8')).toEqual(
          "Hoc est scriptum in computatore domi meae");

      // re-instantiate same identity
      const secondDeviceId: Identity = await Identity.Load(
        cubeStore, "usor probationis", "clavis probationis", idTestOptions);
      // expect all data to have loaded correctly
      expect(secondDeviceId.name).toEqual("Dominus plurium apparatorum")
      expect(secondDeviceId.avatar.seedString).toEqual("1234567890");
      expect(secondDeviceId.posts.length).toBe(1);
      expect((await cubeStore.getCube(secondDeviceId.posts[0])).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf8')).toEqual(
          "Hoc est scriptum in computatore domi meae");
      // perform changes
      await cubeStore.addCube(await makePost(
        "Hoc scriptum est in telefono mobili meo",
        undefined, secondDeviceId, reducedDifficulty));
      secondDeviceId.name = "Dominus plurium apparatorum qui nunc iter agit";
      secondDeviceId.avatar = new Avatar("cafebabe42", AvatarScheme.MULTIAVATAR);
      await secondDeviceId.store();
      // expect all changes to be saved correctly
      expect(secondDeviceId.name).toEqual("Dominus plurium apparatorum qui nunc iter agit")
      expect(secondDeviceId.avatar.seedString).toEqual("cafebabe42");
      expect(secondDeviceId.posts.length).toBe(2);
      expect((await cubeStore.getCube(secondDeviceId.posts[1])).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf8')).toEqual(
          "Hoc est scriptum in computatore domi meae");
      expect((await cubeStore.getCube(secondDeviceId.posts[0])).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf8')).toEqual(
          "Hoc scriptum est in telefono mobili meo");

      await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

      // expect all changes to have synced to the the first "device"
      // (= original Identity instance)
      expect(id.name).toEqual("Dominus plurium apparatorum qui nunc iter agit")
      expect(id.avatar.seedString).toEqual("cafebabe42");
      expect(id.posts.length).toBe(2);
      expect((await cubeStore.getCube(id.posts[0])).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf8')).toEqual(
          "Hoc est scriptum in computatore domi meae");
      expect((await cubeStore.getCube(id.posts[1])).fields.getFirst(
        cciFieldType.PAYLOAD).value.toString('utf8')).toEqual(
          "Hoc scriptum est in telefono mobili meo");
    });

    // this still fails as we currently don't actively attempt to merge
    // conflicting MUC versions
    it.skip('will merge posts on conflicting remote updates', async() => {
      const masterKey: Buffer = Buffer.from(
        sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES, 'uint8array'));

      // create Identity
      const leftId: Identity =
        await Identity.Construct(cubeStore, masterKey, idTestOptions);
      const commonPostKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(1);
      leftId.rememberMyPost(commonPostKey);
      const leftOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(2);
      leftId.rememberMyPost(leftOnlyKey);
      expect(leftId.posts).toHaveLength(2);
      expect(leftId.posts.some(key => key.equals(commonPostKey))).toBeTruthy();
      expect(leftId.posts.some(key => key.equals(leftOnlyKey))).toBeTruthy();
      const leftMuc: cciCube = await leftId.makeMUC();
      await cubeStore.addCube(leftMuc);

      // create conflicting Identity (this might e.g. happen on another device)
      const anotherCubeStore = new CubeStore(testCubeStoreParams);
      const rightId: Identity =
        await Identity.Construct(anotherCubeStore, masterKey, idTestOptions);
      rightId.rememberMyPost(commonPostKey);
      const rightOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(3);
      rightId.rememberMyPost(rightOnlyKey);
      expect(rightId.posts).toHaveLength(2);
      expect(rightId.posts.some(key => key.equals(commonPostKey))).toBeTruthy();
      expect(rightId.posts.some(key => key.equals(leftOnlyKey))).toBeFalsy();
      expect(rightId.posts.some(key => key.equals(rightOnlyKey))).toBeTruthy();
      const rightMuc: cciCube = await rightId.makeMUC();

      // merge right to left by adding right's MUC to left's CubeStore
      await cubeStore.addCube(rightMuc);
      expect(leftId.posts).toHaveLength(3);
      expect(leftId.posts.some(key => key.equals(commonPostKey))).toBeTruthy();
      expect(leftId.posts.some(key => key.equals(leftOnlyKey))).toBeTruthy();
      expect(leftId.posts.some(key => key.equals(rightOnlyKey))).toBeTruthy();
    });

    it('should not apply remote changes when explicitly not subscribed', async() => {
      const masterKey: Buffer = Buffer.from(
        sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES, 'uint8array'));
      idTestOptions.subscribeRemoteChanges = false;

      // create Identity
      const leftId: Identity =
        await Identity.Construct(cubeStore, masterKey, idTestOptions);
      const commonPostKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(1);
      leftId.rememberMyPost(commonPostKey);
      const leftOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(2);
      leftId.rememberMyPost(leftOnlyKey);
      expect(leftId.posts).toHaveLength(2);
      expect(leftId.posts.some(key => key.equals(commonPostKey))).toBeTruthy();
      expect(leftId.posts.some(key => key.equals(leftOnlyKey))).toBeTruthy();
      const leftMuc: cciCube = await leftId.makeMUC();
      await cubeStore.addCube(leftMuc);

      // create conflicting Identity (this might e.g. happen on another device)
      const anotherCubeStore = new CubeStore(testCubeStoreParams);
      const rightId: Identity =
        await Identity.Construct(anotherCubeStore, masterKey, idTestOptions);
      rightId.rememberMyPost(commonPostKey);
      const rightOnlyKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(3);
      rightId.rememberMyPost(rightOnlyKey);
      expect(rightId.posts).toHaveLength(2);
      expect(rightId.posts.some(key => key.equals(commonPostKey))).toBeTruthy();
      expect(rightId.posts.some(key => key.equals(leftOnlyKey))).toBeFalsy();
      expect(rightId.posts.some(key => key.equals(rightOnlyKey))).toBeTruthy();
      const rightMuc: cciCube = await rightId.makeMUC();

      // merge right to left by adding right's MUC to left's CubeStore
      await cubeStore.addCube(rightMuc);
      expect(leftId.posts).toHaveLength(2);
      expect(leftId.posts.some(key => key.equals(commonPostKey))).toBeTruthy();
      expect(leftId.posts.some(key => key.equals(leftOnlyKey))).toBeTruthy();
      expect(leftId.posts.some(key => key.equals(rightOnlyKey))).toBeFalsy();
    });
  });

  describe('remote Identity reconstruction', () => {
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

    beforeEach(async() => {
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
      const np: NetworkPeer =
        local.connect(new Peer(new WebSocketAddress("localhost", 18102)));
      await np.onlinePromise;
    });

    afterEach(async() => {
      await Promise.all([local.shutdown(), remote.shutdown()]);
    });

    it('will correctly reconstruct an Identity created on another node even when operating as a light node', async() => {
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
          subject.forgetMyPost(await post.getKey());
          post.setDate(1715279573 + i);  // now you know when this test was written!
          subject.rememberMyPost(await post.getKey());
          await remote.cubeStore.addCube(post);
          testPostKeys.push(await post.getKeyString());
        }
        expect(subject.posts.length).toEqual(TESTPOSTCOUNT);

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
          subscribed.addSubscriptionRecommendation(subsubscribed.key);
          subscribed.muc.setDate(0);  // skip waiting period for the test
          await subscribed.store();
          expect(subscribed.subscriptionRecommendations[0].
            equals(subsubscribed.key)).toBeTruthy();

          // subject subscribes to subscribed
          subject.addSubscriptionRecommendation(subscribed.key);
          expect(subject.subscriptionRecommendations[i].
            equals(subscribed.key)).toBeTruthy();
        }
        // just double-check this worked
        expect(subject.subscriptionRecommendations.length).toBe(TESTSUBCOUNT);

        // store the subject
        subject.muc.setDate(0);  // hack, just for the test let's not wait 5s for the MUC update
        const muc: cciCube = await subject.store();

        // just some sanity checks
        expect(await local.cubeStore.getNumberOfStoredCubes()).toBe(0);
        expect(await remote.cubeStore.getNumberOfStoredCubes()).toBeGreaterThan(
          TESTPOSTCOUNT + TESTSUBCOUNT);
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
        expect(restored.posts.length).toBe(TESTPOSTCOUNT);
        expect(testPostKeys.length).toBe(TESTPOSTCOUNT);
        for (let i=0; i<TESTPOSTCOUNT; i++) {
          expect(testPostKeys).toContain(restored.posts[i].toString('hex'));
        }

        // verify all subscriptions have been restored correctly
        expect(restored.subscriptionRecommendations.length).toBe(TESTSUBCOUNT);
        for (let i=0; i<testSubs.length; i++) {
          expect(restored.subscriptionRecommendations).toContainEqual(testSubs[i]);
        }

        // verify all indirect subscriptions are correctly recognized as within
        // this user's web of trust
        const restoredWot: CubeKey[] = await restored.recursiveWebOfSubscriptions(1);
        for (let i=0; i<testSubSubs.length; i++) {
          expect(restoredWot).toContainEqual(testSubSubs[i]);
        }
        // direct subscriptions are technically also part of our web of trust,
        // so let's quickly check for those, too
        for (let i=0; i<testSubs.length; i++) {
          expect(restoredWot).toContainEqual(testSubs[i]);
        }
      }
    }, 5000);
  });

  describe('local persistant storage', () => {
    let persistance: IdentityPersistence;
    let idTestOptions: IdentityOptions;

    beforeEach(async () => {
      // Open the DB and make sure it's empty
      persistance = await IdentityPersistence.Construct({dbName: "testidentity"});
      await persistance.deleteAll();
      const ids: Array<Identity> = await persistance.retrieve(cubeStore);
      expect(ids).toBeDefined();
      expect(ids.length).toEqual(0);
      idTestOptions = {
        minMucRebuildDelay: 1,  // allow updating Identity MUCs every second
        requiredDifficulty: reducedDifficulty,
        identityPersistence: persistance,
      }
    });

    afterEach(async () => {
      // Empty the DB and then close it
      await persistance.deleteAll();
      const ids: Array<Identity> = await persistance.retrieve(cubeStore);
      expect(ids).toBeDefined();
      expect(ids.length).toEqual(0);
      await persistance.close();
    });

    it('should store and retrieve an Identity locally', async () => {
      {  // expect DB to be empty at the beginning
        const ids: Array<Identity> = await persistance.retrieve(cubeStore);
        expect(ids.length).toEqual(0);
      }

      let idkey: CubeKey | undefined = undefined;
      {  // phase 1: create new identity and store it
        const id: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        idkey = id.key;
        expect(id.name).toBeUndefined();
        id.name = "Probator Identitatum";
        id.avatar = new Avatar("0102030405", AvatarScheme.MULTIAVATAR);

        const storePromise: Promise<Cube> = id.store();
        expect(storePromise).toBeInstanceOf(Promise<Cube>);
        await storePromise;
      }
      { // phase 2: retrieve, compare and delete the identity
        const restoredIdsPromise: Promise<Identity[]> = persistance.retrieve(cubeStore);
        expect(restoredIdsPromise).toBeInstanceOf(Promise<Identity[]>);
        const restoredIds: Array<Identity> = await restoredIdsPromise;
        expect(restoredIds.length).toEqual(1);
        const restoredId: Identity = restoredIds[0];
        expect(restoredId.name).toEqual("Probator Identitatum");
        expect(restoredId.key).toEqual(idkey);
        expect(restoredId.avatar.scheme).toEqual(AvatarScheme.MULTIAVATAR);
        expect(restoredId.avatar.seedString).toEqual("0102030405");
      }
    }, 5000);
  });  // local persistant storage tests

  describe('static helpers', () => {
    describe('Create', () => {
      it('should create a valid Identity', async () => {
        const original: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        expect(original.masterKey).toBeInstanceOf(Buffer);
        expect(original.key).toBeInstanceOf(Buffer);
        expect(original.privateKey).toBeInstanceOf(Buffer);
        expect(original.avatar.render().length).toBeGreaterThan(20);  // SVG
      });

      // Note: This test asserts key derivation (and avatar) stability.
      // It is at full hardness in order to automatically detect
      // any inconsitencies occurring on prod settings.
      it('should be stable, i.e. always create the same Identity including the same avatar for the same user/pass combo at full hardness', async () => {
        const id: Identity = await Identity.Create(
          cubeStore, "Identitas stabilis", "Clavis stabilis", {
            identityPersistence: undefined,
            requiredDifficulty: 0,  // this is just the hashcash level,
                                    // note argon settings have not been touched
        });
        // expected derivation results
        const expectedMasterkey = "d8eabeb1ab3592fc1dfcc9434e42db8d213c5312c2e9446dcb7915c11d9d65e3";
        const expectedPubkey = "cc5fe0e80bad6db35723f578aa57c074f9bc00866fa9d206686f25f542118ce2";
        const expectedPrivkey = "8fcc6cc84f67b8e753317c6f41d0637d6d45515463e01569e61994c3b6a28765cc5fe0e80bad6db35723f578aa57c074f9bc00866fa9d206686f25f542118ce2";
        const expectedAvatar = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMzEgMjMxIj48cGF0aCBkPSJNMzMuODMsMzMuODNhMTE1LjUsMTE1LjUsMCwxLDEsMCwxNjMuMzQsMTE1LjQ5LDExNS40OSwwLDAsMSwwLTE2My4zNFoiIHN0eWxlPSJmaWxsOiMwZGY7Ii8+PHBhdGggZD0ibTExNS41IDUxLjc1YTYzLjc1IDYzLjc1IDAgMCAwLTEwLjUgMTI2LjYzdjE0LjA5YTExNS41IDExNS41IDAgMCAwLTUzLjcyOSAxOS4wMjcgMTE1LjUgMTE1LjUgMCAwIDAgMTI4LjQ2IDAgMTE1LjUgMTE1LjUgMCAwIDAtNTMuNzI5LTE5LjAyOXYtMTQuMDg0YTYzLjc1IDYzLjc1IDAgMCAwIDUzLjI1LTYyLjg4MSA2My43NSA2My43NSAwIDAgMC02My42NS02My43NSA2My43NSA2My43NSAwIDAgMC0wLjA5OTYxIDB6IiBzdHlsZT0iZmlsbDojZmZjZThiOyIvPjxwYXRoIGQ9Im05MS45MiAxOTQuNDFhMTAxLjQ3IDEwMS40NyAwIDAgMSAyMy41OCAxNy4wOSAxMDEuNDcgMTAxLjQ3IDAgMCAxIDIzLjU4LTE3LjA5YzAuODkgMC4xOSAxLjc4IDAuMzggMi42NyAwLjU5YTExNC43OSAxMTQuNzkgMCAwIDEgMzggMTYuNSAxMTUuNTMgMTE1LjUzIDAgMCAxLTEyOC40NiAwIDExNC43OSAxMTQuNzkgMCAwIDEgMzgtMTYuNWMwLjg4LTAuMjEgMS43OC0wLjQgMi42Ny0wLjU5eiIgc3R5bGU9ImZpbGw6IzcwODkxMzsiLz48cGF0aCBkPSJtNzMuNjUgMTk5LjgyYzE2LjU5IDguMjMgMjguNzIgMTguOTEgMzQuMjcgMzAuOTNhMTE0Ljg2IDExNC44NiAwIDAgMS01Ni42NS0xOS4yNSAxMTUuMDYgMTE1LjA2IDAgMCAxIDIyLjM4LTExLjY4eiIgc3R5bGU9ImZpbGw6I2ZkZWExNDsiLz48cGF0aCBkPSJtNjAuNjMgMjA1Ljg1YzEyLjM1IDUuOTQgMjEuOTMgMTMuNDQgMjcuNTkgMjEuOTFhMTE0LjcgMTE0LjcgMCAwIDEtMzYuOTUtMTYuMjZxNC41My0zIDkuMzYtNS42NXoiIHN0eWxlPSJmaWxsOiM3MDg5MTM7Ii8+PHBhdGggZD0ibTE1Ny4zNSAxOTkuODJjLTE2LjYgOC4yMy0yOC43MiAxOC45MS0zNC4yNyAzMC45M2ExMTQuODYgMTE0Ljg2IDAgMCAwIDU2LjY1LTE5LjI1IDExNS4wNiAxMTUuMDYgMCAwIDAtMjIuMzgtMTEuNjh6IiBzdHlsZT0iZmlsbDojZmRlYTE0OyIvPjxwYXRoIGQ9Im0xNzAuMzcgMjA1Ljg1Yy0xMi4zNSA1Ljk0LTIxLjkzIDEzLjQ0LTI3LjU5IDIxLjkxYTExNC43IDExNC43IDAgMCAwIDM2Ljk1LTE2LjI2cS00LjUzLTMtOS4zNi01LjY1eiIgc3R5bGU9ImZpbGw6IzcwODkxMzsiLz48cGF0aCBkPSJtMTI0LjIyIDEzLjYxYy0xOS43ODMgMC0zNi45NDUgOC4wODg3LTM5LjY5NSAyNC4xMDYtMTUuMzMyIDAuMjM1MzktMzEuODMxIDIuNzcxMi00MS42NjMgMTUuNzgyLTYuMDIzOCA3Ljk2MDQtNy4wNDAyIDE5LjkwMS02Ljg0NzYgMzEuNzI0IDAuNDYwMDcgMjguNTAzIDEwLjc0MiA2NC4yMjgtNC4zMDEyIDg5LjcxNCAxNi41ODQgNS43Nzc3IDQzLjA4NiAxMC43NDIgNzMuNTkgMTEuNjYydi04LjY1NThjLTEuODUxLTAuMzUzMDgtMy42NTkyLTAuNzgxMDUtNS40MzUzLTEuMjczMi0zMC45NTMtOC40NjMyLTUwLjY3Mi0zNi42MzUtNDcuMjU5LTY4LjY2OSAxLjU1MTQtMTAuNjAzIDQuNjIyMS0xOS42NjUgMTAuMDI1LTI3LjY5IDUuMzgxOC03Ljk5MjUgMTMuMjY3LTE1LjcxNyAyMy44OTItMjEuNDEgMC40MDY1OCAwLjcyNzU3IDEuOTkwMSAzLjU4NDMgMi40MDc0IDQuMzAxMiA3LjUwMDMgMTIuNzc1IDE3Ljk4NiAyMy44NDkgMzMuMTU3IDI2Ljg2NiAxMi40MzMgMi40NjA5IDIzLjg0OSAzLjQ2NjYgMzYuMzQ2IDEuMTU1NSA0LjI1ODQtMC43ODEwNiAxMC42NjctMi4zOTY3IDE0Ljg1MS0yLjQxODEgMTQuODYxIDMzLjQwNC0xLjA4MDYgNzUuMDM1LTQwLjY2OCA4Ny40NTctMi4yMjU1IDAuNzA2MTYtNC41MjU4IDEuMzE2LTYuODkwNCAxLjgxODkgMCAyLjcwNy0wLjA0MjggNS42NDkzLTAuMDY0MiA4LjUyNzQgMjMuNjAzLTAuNzI3NTcgNDguNjgyLTQuMDQ0NCA3Mi44NzQtMTEuMjM0LTE4LjUyMS0zMi4xNTIgMC44MTMxNS04OS4wODMtMTAuMDM2LTEyMS40Ni05LjA3MzEtMjYuOTczLTM4Ljg1LTQwLjMxNS02NC4yODItNDAuMzA1eiIgc3R5bGU9ImZpbGw6IzAwMDsiLz48cGF0aCBkPSJtMzMuMTQ3IDE3Mi4zMmMtMi42NTM1IDUuMTE0My02LjA4OCA5Ljk1MDQtMTAuMSAxMi40MTEgNy44NDI3IDEwLjQ1MyAxNy4zODcgMTkuNTE2IDI4LjI1NyAyNi43ODEgMTYuMDM4LTEwLjczMSAzNS42MjktMTcuMDU1IDU0LTE4LjYwNnYtOS4wMDg5Yy0zMC4wNjUtMC45NDE1NS01Ni4xMDgtNS44ODQ3LTcyLjE1Ny0xMS41Nzd6bTE2NC4wNiAwLjU1NjM3Yy0yMy43MzEgNy4wNzIzLTQ4LjM2MSAxMC4zMjUtNzEuNTI1IDExLjA0Mi0wLjAzMjEgMy4xMjQyLTAuMDUzNSA2LjIzNzctMC4wMTA3IDkuMDUxNyAxOS4yMjcgMS43MjI2IDM3LjkwOCA3Ljg1MzQgNTMuOTg5IDE4LjU0MiAwLjAxMDcgMCAwLjAxMDcgMCAwLjAyMTQgMC4wMTA3IDEwLjczMS03LjE2ODYgMjAuMTc5LTE2LjA4MSAyNy45NTgtMjYuMzc0LTQuMjc5OC0yLjM5NjctNy44MzItNi45NjUzLTEwLjQzMi0xMi4yNzJ6IiBzdHlsZT0iZmlsbDpub25lOyIvPjxwYXRoIGQ9Im01MC4wMiA0Ni41Yy0yLjkyOTcgMS45MTQzLTYuMTMxMyAzLjg4MjYtMTAuMTU0IDcuOTgwNS0xNC4wOTEgMTQuMzU5LTE2LjE0NSAyNy43MDEtNi4xNDA2IDQ0LjAxOCA0LjIwNDkgNi44NTgzIDYuMTQxNCAxMy43MDYtMC4yNDYwOSAyMC41LTcuNzE0MyA4LjE5NTctMjEuNTU5IDQuMjkxMi0yMS41MzcgMTYuMDYxIDAuMDIxNCA4LjYxMyAxNS4wNjMgNy45MTc4IDIyLjUzMSAxMy45ODQgMy43NjYyIDMuMDcwNyA1LjA4MzYgOC4zOTkyIDIuMDY2NCAxMi41MDgtNC4yMTU2IDUuNzQ1Ni0xNi4wMDYgNy4zNzE1LTIyLjYyOSA4LjkzMzYgNS44ODExIDEwLjg0MyAxMy40NSAyMC42MzggMjIuMzU1IDI5LjAzM2wwLjAwMzkgMC4wMjM0IDAuMDA1OS0wLjAxMzdjMmUtMyAyZS0zIDAuMDAzOCA0ZS0zIDAuMDA1OSA2ZS0zIDAuMDAzNC0wLjAxMTIgMC4wMDYzLTAuMDIxOSAwLjAwOTgtMC4wMzMyIDE0Ljc3NS0xMi4yMTggMjAuMjY4LTIwLjk2NSA0OS40NjEtMjguNDM0LTE3LjQwNC0xMC4yNTgtMzAuNjgtMjcuMTIyLTI0LjE0My0zNS4zNCA0LjQxMjMtNS41NDQ0IDUuNjYxMi03Ljg2MzMgNi40MDYyLTEyLjA3OCAyLjM1ODItMTMuMzM5LTEwLjIwOC0yMi4zMzUtOS4yMzYzLTMyLjcxNSAxLjk0MzItOC4yMzQ2IDExLjM3OS0xMS4xNzMgMTYuOTQ3LTE1LjExNSA1LjQ1NzctMy45MDgyIDkuODAxNC04Ljc2OTUgMTAuNzk5LTE2LjkxOC0xMy41NTgtNC44ODk2LTE3LjYwOS01Ljg2MTctMzYuNTA2LTEyLjR6bTE0MC44NyAxOS4zNTdjLTMuNDQwNC0wLjkxMjQzLTIzLjMxMSAxMjIuNDMgNC40MTIxIDEzMy4xNCA4Ljk2NjEtOC41ODA5IDE2LjU1Mi0xOC41ODQgMjIuNDA0LTI5LjY1OCAwLTAuMzEwMjktMjUuMTMzLTMuOTkyMi0yNS45NzktMTQuMDE4LTAuMTA2OTktMS4xNzY5IDAuMTE4MjItMS40ODU1IDAuODY3MTgtMi41MDIgNi42NzY0LTkuMjEyMiAzMC43MTYtMTEuNDE2IDI5LjY0Ni0yMy40OTYtMC4yNzgxOC0zLjE1NjMtNC4xNjE3LTUuMjMzNC02Ljc0MDItNi40NTMxLTEyLjE1NS01Ljc2Ny0zMi45NDItOS42NDk0LTE1LjAzMS0yNC41NDMgOS4yMTIyLTcuMzUwNSAxMC40My04LjQzMjMgMC41OTc2Ni0xNC42OTEtOS40NTgzLTYuMDIzOC05LjM5NC0xMS45OTMtOS43NTc4LTE2LjMyNi0wLjA3NjctMC45MzAzNS0wLjIyMDg5LTEuNDAwMy0wLjQxOTkyLTEuNDUzMXoiIHN0eWxlPSJmaWxsOm5vbmU7Ii8+PHBhdGggZD0ibTEzMy44MyAzOS45MDljLTExLjMzIDEuMzkzLTkuNTQ5MiAxNi4yMDQtMmUtMyAxNi42NDMtNC41MTAyIDEwLjcxNyA5LjAxNjUgMTYuMTgxIDE0LjQ0MSA4LjMxMjUgNi41NjIgOC42NzY1IDE4LjU5NiAwLjk0NzUxIDE0LjQ1Ny04LjMxMjUgMTEuNzE4LTEuNTM4MSA5LjI3NjktMTYuMDk5IDAtMTYuNjQzIDQuNTAzLTEwLjg2Ny05LjQ4ODMtMTYuMTAxLTE0LjQ1Ny04LjMzMDEtNi44ODMyLTkuMDQxMS0xOC41MDktMC40NzMyMS0xNC40MzkgOC4zMzAxeiIgc3R5bGU9ImZpbGw6I0ZGQ0MwMDsiLz48cGF0aCBkPSJtMTUzLjg2IDQ4LjIyMmMwLTMuMDUyOC0yLjUxODQtNS41NjQ4LTUuNTc5MS01LjU2NDgtMy4wNzgzIDAtNS41NzkzIDIuNTEyLTUuNTc5MyA1LjU2NDggMCAzLjA3MDMgMi41MDEgNS41NjQ4IDUuNTc5MyA1LjU2NDggMy4wNjA2IDAgNS41NzkxLTIuNDk0NiA1LjU3OTEtNS41NjQ4eiIgc3R5bGU9ImZpbGw6cmVkOyIvPjxwYXRoIGQ9Im03OC43MyAxMTFhMTAuOSAxMC45IDAgMCAxIDE1LjE5IDBtNDMuMTYgMGExMC45IDEwLjkgMCAwIDEgMTUuMTkgMCIgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLXdpZHRoOjYuMTk5OXB4O3N0cm9rZTojMDAwOyIvPjxwYXRoIGQ9Im03OS44MDQgMTIzLjc0aDcuMDdtNTcuMjczIDBoNy4wNSIgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLXdpZHRoOjUuOTk5OHB4O3N0cm9rZTojMDA3MmZmOyIvPjxwYXRoIGQ9Im0xMjIuODMgMTUxLjg4YTEwLjQ5IDEwLjQ4OSAwIDAgMS0xNC42NiAwIiBzdHlsZT0iZmlsbDpub25lO3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2Utd2lkdGg6Ni4xOTk2cHg7c3Ryb2tlOiMwMDA7Ii8+PC9zdmc+";
        // logger.trace("Masterkey: " + id.masterKey.toString('hex'));
        // logger.trace("Pubkey: " + id.muc.publicKey.toString('hex'));
        // logger.trace("Privkey: " + id.muc.privateKey.toString('hex'));
        // logger.trace("Avatar: " + id.avatar.render());
        expect(id.masterKey.toString('hex')).toEqual(expectedMasterkey);
        expect(id.muc.publicKey.toString('hex')).toEqual(expectedPubkey);
        expect(id.muc.privateKey.toString('hex')).toEqual(expectedPrivkey);
        expect(id.avatar.render()).toEqual(expectedAvatar);
      });
    });

    describe("Load", () => {
      it("returns undefined when MUC is unavailable", () => {
        const doesNotExist = Identity.Load(cubeStore, "Usor absens",
          "quis curat de clavis usoris non existentis?");
        expect(doesNotExist).toBeUndefined;
      });

      it('correctly restores an existing Identity', async () => {
        // create an Identity
        const original: Identity = await Identity.Create(
          cubeStore, "usor probationis", "clavis probationis", idTestOptions);
        // make lots of custom changes
        original.name = "Sum usor frequens, semper redeo"
        original.avatar.random();

        // make a post
        expect(original.posts.length).toEqual(0);
        const post = await makePost("Habeo res importantes dicere",
          undefined, original, reducedDifficulty);
        await cubeStore.addCube(post);
        expect(original.posts.length).toEqual(1);

        // remember individual values and customizations
        const masterkey = original.masterKey.toString('hex');
        const pubkey = original.muc.publicKey.toString('hex');
        const privkey = original.muc.privateKey.toString('hex');
        const chosenAvatar: string = original.avatar.seedString;
        const myPostKey: CubeKey = original.posts[0];

        // store Identity
        await original.store();

        // restore Identity
        const restored: Identity = await Identity.Load(cubeStore,
          "usor probationis", "clavis probationis", idTestOptions);

        // assert all values custom changes still present
        expect(restored.name).toEqual("Sum usor frequens, semper redeo");
        expect(restored.masterKey.toString('hex')).toEqual(masterkey);
        expect(restored.muc.publicKey.toString('hex')).toEqual(pubkey);
        expect(restored.muc.privateKey.toString('hex')).toEqual(privkey);
        expect(restored.avatar.seedString).toEqual(chosenAvatar);
        expect(restored.posts.length).toEqual(1);
        expect(restored.posts[0]).toEqual(myPostKey);
      });
    });
  });  // static helpers
});
