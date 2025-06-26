import type { CubeKey, NotificationKey } from '../../../src/core/cube/cube.definitions';

import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { Identity } from '../../../src/cci/identity/identity';
import { IdentityStore } from '../../../src/cci/identity/identityStore';
import { notifyingIdentities } from '../../../src/cci/identity/identityGenerators';

import { testCciOptions } from '../testcci.definitions';

import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { DummyNetworkManager } from '../../../src/core/networking/testingDummies/dummyNetworkManager';
import { DummyNetworkPeer } from '../../../src/core/networking/testingDummies/dummyNetworkPeer';
import { RequestScheduler } from '../../../src/core/networking/cubeRetrieval/requestScheduler';
import { CubeRetriever } from '../../../src/core/networking/cubeRetrieval/cubeRetriever';
import { NetworkManagerIf } from '../../../src/core/networking/networkManagerIf';
import { PeerDB } from '../../../src/core/peering/peerDB';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { IdentityOptions } from '../../../src/cci/identity/identity.definitions';

import sodium from 'libsodium-wrappers-sumo'
import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('IdentityUtil', () => {
  describe('notifyingIdentities()', () => {
    describe('from local store', () => {
      // In these tests, Identites are already present both as Cubes in the
      // local CubeStore as well as as Identity objects in the local IdentityStore.
      let cubeStore: CubeStore;
      let notifying1: Identity, notifying2: Identity, notifying3: Identity;
      let irrelevant: Identity, nonNotifying: Identity;

      const notificationKey: NotificationKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42) as NotificationKey;
      const irrelevantKey: NotificationKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 99) as NotificationKey;

      let result: Identity[];

      beforeAll(async () => {
        await sodium.ready;
        cubeStore = new CubeStore(testCciOptions);
        await cubeStore.readyPromise;

        // prepare test Identities

        const identityStore: IdentityStore = new IdentityStore(cubeStore);
        const identityOptions: IdentityOptions = {
          ...testCciOptions,
          identityStore,
        };

        const masterKey1: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 11);
        notifying1 = new Identity(cubeStore, masterKey1, {
          ...identityOptions,
          idmucNotificationKey: notificationKey,
        });

        const masterKey2: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 22);
        notifying2 = new Identity(cubeStore, masterKey2, {
          ...identityOptions,
          idmucNotificationKey: notificationKey,
        });

        const masterKey3: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 33);
        notifying3 = new Identity(cubeStore, masterKey3, {
          ...identityOptions,
          idmucNotificationKey: notificationKey,
        });

        const masterKey4: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 44);
        irrelevant = new Identity(cubeStore, masterKey4, {
          ...identityOptions,
          idmucNotificationKey: irrelevantKey,
        });

        const masterKey5: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 55);
        nonNotifying = new Identity(cubeStore, masterKey5, identityOptions);

        await Promise.all([
          notifying1.store(),
          notifying2.store(),
          notifying3.store(),
          irrelevant.store(),
          nonNotifying.store(),
        ]);

        // run test
        const gen = notifyingIdentities(cubeStore, notificationKey, identityStore);
        // save results to array for ease of testing
        result = await ArrayFromAsync(gen);
      });

      afterAll(async () => {
        await notifying1.identityStore.shutdown();
        await cubeStore.shutdown();
      });

      it('will yield three matching notifying Identities', () => {
        expect(result.length).toBe(3);
        // Checking for exact object match as we already have those Identity
        // objects in local store.
        // notifyingIdentites() should not re-instantiate them.
        expect(result).toContain(notifying1);
        expect(result).toContain(notifying2);
        expect(result).toContain(notifying3);
      });

      it('will not yield the non-notifying Identity', () => {
        expect(result).not.toContain(nonNotifying);
        expect(result.some(id =>
          id.key.equals(nonNotifying.key)
        )).toBe(false);
      });

      it('will not yield the non-matching notifying Identity', () => {
        expect(result).not.toContain(irrelevant);
        expect(result.some(id =>
          id.key.equals(irrelevant.key)
        )).toBe(false);
      });
    });  // from local CubeStore



    describe('retrieving over the wire', () => {
      for (const subscribeMode of [true]) describe(subscribeMode? 'subscribe mode' : 'regular one-off requests', () => {
        let cubeStore: CubeStore;
        let networkManager: NetworkManagerIf;
        let scheduler: RequestScheduler;
        let retriever: CubeRetriever;
        let peer: DummyNetworkPeer;

        let notifying1: Identity, notifying2: Identity;
        let n1Bin: Buffer, n2Bin: Buffer;
        const notificationKey: NotificationKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 42) as NotificationKey;

        const result: Identity[] = [];

        beforeAll(async () => {
          // Prepare a minimal node with dummy networking components
          await sodium.ready;
          cubeStore = new CubeStore(testCciOptions);
          await cubeStore.readyPromise;
          networkManager = new DummyNetworkManager(cubeStore, new PeerDB());
          peer = new DummyNetworkPeer(networkManager, undefined, cubeStore);
          networkManager.outgoingPeers = [peer];
          scheduler = new RequestScheduler(networkManager, {
            ...testCciOptions,
            requestTimeout: 1000,
          });
          retriever = new CubeRetriever(cubeStore, scheduler);

          // Prepare test Identities
          // This is happening "remotely", thus we use a different CubeStore
          // as well as a different IdentityStore
          const creationCs = new CubeStore(testCciOptions);
          const creationIs = new IdentityStore(creationCs);
          const identityOptions: IdentityOptions = {
            ...testCciOptions,
            identityStore: creationIs,
          };

          const masterKey1: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 71);
          notifying1 = new Identity(creationCs, masterKey1, {
            ...identityOptions,
            idmucNotificationKey: notificationKey,
          });

          const masterKey2: Buffer = Buffer.alloc(sodium.crypto_sign_SEEDBYTES, 22);
          notifying2 = new Identity(creationCs, masterKey2, {
            ...identityOptions,
            idmucNotificationKey: notificationKey,
          });

          let n1muc: cciCube, n2muc: cciCube;
          await Promise.all([
            notifying1.marshall().then(muc => n1muc = muc),
            notifying2.marshall().then(muc => n2muc = muc),
          ]);
          n1Bin = await n1muc!.getBinaryData();
          n2Bin = await n2muc!.getBinaryData();

          // run test
          const retrievalIs = new IdentityStore(cubeStore)
          const gen = notifyingIdentities(
            retriever, notificationKey, retrievalIs, {
              subscribe: subscribeMode,
          });
          // save results to array for ease of testing
          (async () => { for await (const id of gen) result.push(id) })();

          // simulate some network latency
          await new Promise(resolve => setTimeout(resolve, 100));

          // have the notifying Identity root Cubes arrive:
          // in one-off mode, they have to arrive all at once...
          if (!subscribeMode) await scheduler.handleCubesDelivered([n1Bin, n2Bin], peer);
          // ... while in subscribe mode, they are allowed to trickle in over time
          if (subscribeMode) {
            await scheduler.handleCubesDelivered([n1Bin], peer);
            await new Promise(resolve => setTimeout(resolve, 100));
            await scheduler.handleCubesDelivered([n2Bin], peer);
          }

          // TODO BUGBUG FIXME crashes in CubeStore's LevelDB without this delay
          // (while the effect of this bug looks serious, it's still low priority
          // because it is most certainly caused by shutting down the components
          // too early, which is a pathological case)
          await new Promise(resolve => setTimeout(resolve, 100));
        });

        afterAll(async () => {
          await notifying1.identityStore.shutdown();
          await cubeStore.shutdown();
          await networkManager.shutdown();
          await scheduler.shutdown();
        });

        it('yields the two notifying Identities', () => {
          expect(result.length).toBe(2);
          expect(result.some(id =>
            id.key.equals(notifying1.key)
          )).toBe(true);
          expect(result.some(id =>
            id.key.equals(notifying2.key)
          )).toBe(true);

          // Note: This simulates a "remote" test, so the Identities need to
          //   have been reinstantiated. They cannot be the exact same objects
          //   as on creation.
          expect(result).not.toContain(notifying1);
          expect(result).not.toContain(notifying2);
        });
      });  // subscribe mode / regular one-off requests
    });  // retrieving over the wire
  });  // notifyingIdentities()
});  // identityUtil
