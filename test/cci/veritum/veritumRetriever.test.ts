import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';
import { VerityField } from '../../../src/cci/cube/verityField';
import { Recombine, Split } from '../../../src/cci/veritum/continuation';
import { Veritum } from '../../../src/cci/veritum/veritum';
import { VeritumRetriever } from '../../../src/cci/veritum/veritumRetriever';
import { CubeType, CubeKey } from '../../../src/core/cube/cube.definitions';
import { CubeStoreOptions, CubeStore } from '../../../src/core/cube/cubeStore';
import { CubeRequestOptions, RequestScheduler } from '../../../src/core/networking/cubeRetrieval/requestScheduler';
import { NetworkManagerIf } from '../../../src/core/networking/networkManagerIf';
import { DummyNetworkManager } from '../../../src/core/networking/testingDummies/dummyNetworkManager';
import { DummyNetworkPeer } from '../../../src/core/networking/testingDummies/dummyNetworkPeer';
import { PeerDB } from '../../../src/core/peering/peerDB';
import { tooLong, evenLonger, farTooLong } from '../testcci.definitions';
import { CubeRetriever } from '../../../src/core/networking/cubeRetrieval/cubeRetriever';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { FieldEqualityMetric } from '../../../src/core/fields/baseFields';
import { Cube } from '../../../src/core/cube/cube';
import { Veritable } from '../../../src/core/cube/veritable.definition';

import sodium from 'libsodium-wrappers-sumo'

describe('VeritumRetriever', () => {
  const cubeStoreOptions: CubeStoreOptions = {
    inMemory: true,
    enableCubeRetentionPolicy: false,
    requiredDifficulty: 0,
  };
  let cubeStore: CubeStore;
  let networkManager: NetworkManagerIf;
  let scheduler: RequestScheduler;
  let retriever: VeritumRetriever<CubeRequestOptions>;
  let peer: DummyNetworkPeer;

  beforeEach(async () => {
    await sodium.ready;

    cubeStore = new CubeStore(cubeStoreOptions);
    await cubeStore.readyPromise;

    networkManager = new DummyNetworkManager(cubeStore, new PeerDB());
    peer = new DummyNetworkPeer(networkManager, undefined, cubeStore);
    networkManager.outgoingPeers = [peer];

    scheduler = new RequestScheduler(networkManager, { requestTimeout: 200 });
    const cubeRetriever = new CubeRetriever(cubeStore, scheduler);
    retriever = new VeritumRetriever(cubeRetriever);
  });

  afterEach(async () => {
    await cubeStore.shutdown();
    await networkManager.shutdown();
    await scheduler.shutdown();
    await retriever.shutdown();
  });

  describe('getContinuationChunks()', () => {
    describe('chunks already in store', () => {
      it('yields a single chunk already in store', async () => {
        // prepare test data
        const cube: cciCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          fields: [
            VerityField.Payload("Hoc non est cadena continuationis"),
          ],
          requiredDifficulty: 0,
        });
        await cubeStore.addCube(cube);
        expect(cube.getKeyIfAvailable()).toBeDefined();

        // fire the request
        const chunks: cciCube[] = [];
        for await (const chunk of retriever.getContinuationChunks(cube.getKeyIfAvailable())) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBe(1);
        expect(chunks[0].getKeyIfAvailable()).toBeDefined();
        expect(chunks[0].getKeyIfAvailable()).toEqual(cube.getKeyIfAvailable());
        expect(chunks[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual("Hoc non est cadena continuationis");
      });

      it('yields a 2-chunk continuation already in store', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(tooLong);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // split the macro Cube and add all parts to the store
        const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toBe(2);
        for (const cube of splitCubes) {
          await cubeStore.addCube(cube);
        }

        // fire the request
        const chunks: cciCube[] = [];
        for await (const chunk of retriever.getContinuationChunks(splitCubes[0].getKeyIfAvailable())) {
          chunks.push(chunk);
        }
        expect(chunks.length).toBe(2);

        // reassemble the chunks
        const recombined: Veritum = Recombine(chunks, {requiredDifficulty: 0});
        expect(recombined.getFirstField(FieldType.PAYLOAD).valueString).toEqual(tooLong);
      });

      it('yields a three-chunk continuation already in store', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(evenLonger);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // split the macro Cube and add all parts to the store
        const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toBe(3);
        for (const cube of splitCubes) {
          await cubeStore.addCube(cube);
        }

        // fire the request
        const chunks: cciCube[] = [];
        for await (const chunk of retriever.getContinuationChunks(splitCubes[0].getKeyIfAvailable())) {
          chunks.push(chunk);
        }
        expect(chunks.length).toBe(splitCubes.length);

        // reassemble the chunks
        const recombined: Veritum = Recombine(chunks, {requiredDifficulty: 0});
        expect(recombined.getFirstField(FieldType.PAYLOAD).valueString).toEqual(evenLonger);
      });

      it('yields a more-than-5-chunk continuation already in store', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(farTooLong);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // split the macro Cube and add all parts to the store
        const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toBeGreaterThan(5);
        for (const cube of splitCubes) {
          await cubeStore.addCube(cube);
        }

        // fire the request
        const chunks: cciCube[] = [];
        for await (const chunk of retriever.getContinuationChunks(splitCubes[0].getKeyIfAvailable())) {
          chunks.push(chunk);
        }
        expect(chunks.length).toBe(splitCubes.length);

        // reassemble the chunks
        const recombined: Veritum = Recombine(chunks, {requiredDifficulty: 0});
        expect(recombined.getFirstField(FieldType.PAYLOAD).valueString).toEqual(farTooLong);
      });
    });  // chunks already in store


    describe('chunks arriving in correct order', () => {
      it('yields a single chunk arriving after the request', async () => {
        // prepare test data
        const cube: cciCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          fields: [
            VerityField.Payload("Hoc non est cadena continuationis"),
          ],
          requiredDifficulty: 0,
        });
        await cube.compile();
        expect(cube.getKeyIfAvailable()).toBeDefined();

        // fire the request
        const chunks: cciCube[] = [];
        const gen: AsyncGenerator<cciCube> = retriever.getContinuationChunks(cube.getKeyIfAvailable());
        gen.next().then((iteratorResult: IteratorResult<cciCube, boolean>) => {
          chunks.push(iteratorResult.value as cciCube);
          expect(iteratorResult.done).toBe(false);
          gen.next().then((iteratorResult: IteratorResult<cciCube, boolean>) => {
            console.error("check performed")
            expect(iteratorResult.done).toBe(true);
          })
        })

        // simulate arrival of chunk by adding it to CubeStore --
        // note this happens after the request has been fired
        await cubeStore.addCube(cube);

        await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

        expect(chunks.length).toBe(1);
        expect(chunks[0].getKeyIfAvailable()).toBeDefined();
        expect(chunks[0].getKeyIfAvailable()).toEqual(cube.getKeyIfAvailable());
        expect(chunks[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual("Hoc non est cadena continuationis");
      });

      it('yields a 2-chunk continuation arriving in correct order after the request', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(tooLong);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // split the macro Cube
        const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toBe(2);
        const continuationKey: CubeKey = await splitCubes[0].getKey();

        // fire the request
        const chunks: cciCube[] = [];
        cubeStore.addCube(splitCubes[0]);
        let i=1;
        for await (const chunk of retriever.getContinuationChunks(
          splitCubes[0].getKeyIfAvailable(), {timeout: 1000000000})) {
          chunks.push(chunk);
          cubeStore.addCube(splitCubes[i]);
          i++;
        }
        expect(chunks.length).toBe(splitCubes.length);
        const recombined: Veritum = Recombine(chunks, {requiredDifficulty: 0});
        expect(recombined.getFirstField(FieldType.PAYLOAD).valueString).toEqual(tooLong);
      });

      it('yields a more-than-5-chunk continuation arriving in sequence', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(farTooLong);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // split the macro Cube
        const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toBeGreaterThan(5);
        const continuationKey: CubeKey = await splitCubes[0].getKey();

        // fire the request
        const chunks: cciCube[] = [];
        // and while we're doing that, feed the chunks one by one
        await cubeStore.addCube(splitCubes[0]);
        let i=1;
        for await (const chunk of retriever.getContinuationChunks(continuationKey)) {
          chunks.push(chunk);
          await cubeStore.addCube(splitCubes[i]);
          i++;
        }
        expect(chunks.length).toBe(splitCubes.length);

        // reassemble the chunks
        const recombined: Veritum = Recombine(chunks, {requiredDifficulty: 0});
        expect(recombined.getFirstField(FieldType.PAYLOAD).valueString).toEqual(farTooLong);
      });

    });  // chunks arriving in correct order


    describe('chunks arriving out of order', () => {
    // TODO: This test sporadically fails on my machine and I don't know why :(
      it('yields a 2-chunk continuation arriving in reverse order after the request', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(tooLong);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // split the macro Cube
        const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toBe(2);
        const continuationKey: CubeKey = await splitCubes[0].getKey();

        // fire the request
        const chunks: cciCube[] = [];
        const gen: AsyncGenerator<cciCube> = retriever.getContinuationChunks(continuationKey);
        gen.next().then((iteratorResult: IteratorResult<cciCube, boolean>) => {
          chunks.push(iteratorResult.value as cciCube);
          expect(iteratorResult.done).toBe(false);

          gen.next().then((iteratorResult: IteratorResult<cciCube, boolean>) => {
            chunks.push(iteratorResult.value as cciCube);
            expect(iteratorResult.done).toBe(false);

            gen.next().then((iteratorResult: IteratorResult<cciCube, boolean>) => {
              expect(iteratorResult.done).toBe(true);
            });
          });
        });

        // simulate arrival of chunks by adding them to CubeStore --
        // note this happens after the request has been fired
        // and note the chunks are arriving in reverse order
        await cubeStore.addCube(splitCubes[1]);
        await new Promise(resolve => setTimeout(resolve, 100));  // give it some time
        await cubeStore.addCube(splitCubes[0]);
        await new Promise(resolve => setTimeout(resolve, 100));  // give it some time

        expect(chunks.length).toBe(2);
        const recombined: Veritum = Recombine(chunks, {requiredDifficulty: 0});
        expect(recombined.getFirstField(FieldType.PAYLOAD).valueString).toEqual(tooLong);
      });
    });  // chunks arriving out of order

    describe('error handling', () => {
      describe('missing chunks', () => {
        it('aborts if the first chunk is missing and returns an error', async () => {
          // prepare test data
          const notificationKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
          const veritum: Veritum = new Veritum({
            cubeType: CubeType.PIC_NOTIFY,
            fields: [
              VerityField.Payload(farTooLong),
              VerityField.Notify(notificationKey),
            ],
            requiredDifficulty: 0,
          });
          await veritum.compile();
          expect(veritum.getKeyIfAvailable()).toBeDefined();

          // fire the request
          const gen: AsyncGenerator<cciCube> = retriever.getContinuationChunks(veritum.getKeyIfAvailable());
          const chunks: cciCube[] = await ArrayFromAsync(gen);
          expect(chunks).toHaveLength(0);
          const returned = await gen.next();
          expect(returned.done).toBe(true);
        });

        it.todo('aborts if the second chunk is missing and returns an error');
        it.todo('aborts if the third chunk is missing and returns an error');
        it.todo('yields a random continuation arriving in random order (fuzzing test)');
        it.todo('terminates on circular references');
      });
    });
  });

  describe('getVeritum()', () => {
    it('retrieves a multi-Chunk Veritum already in store', async () => {
      const veritum: Veritum = new Veritum({
        cubeType: CubeType.PIC,
        fields: [
          VerityField.Payload(evenLonger),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        requiredDifficulty: 0,
      });
      for (const chunk of await veritum.compile()) cubeStore.addCube(chunk);
      const key: CubeKey = veritum.getKeyIfAvailable();

      const retrievedVeritum: Veritum = await retriever.getVeritum(key);
      expect(retrievedVeritum.equals(veritum, FieldEqualityMetric.IgnoreOrder)).toBe(true);
    });

    it.todo('tests regarding Verita not yet in local store');

    // TODO FIXME BUGBUG multi-Cube PIC Veritum handling still buggy :(
    it.todo('retrieves multi-Cube notification PICs');

    // multi-Cube signed Verita currently not supported; Github#634
    it.todo('retrieves multi-Cube notification MUCs');
    it.todo('retrieves multi-Cube notification PMUCs');
  });

  describe('getNotifications()', () => {
    it('retrieves a single-Cube notification PIC already in store', async () => {
      // sculpt a single-Cube notification and add it to the local CubeStore
      const latin = "Nuntius brevis succinctus nec plures cubos requirens";
      const recipientKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
      const notification: Veritum = new Veritum({
        cubeType: CubeType.FROZEN_NOTIFY,
        fields: [
          VerityField.Payload(latin),
          VerityField.Notify(recipientKey),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        requiredDifficulty: 0,
      });
      await notification.compile();
      for (const chunk of notification.chunks) await cubeStore.addCube(chunk);

      // verify test setup: assert Veritum compiled correctly
      const chunks: cciCube[] = Array.from(notification.chunks);
      expect(chunks).toHaveLength(1);
      const key: CubeKey = await notification.getKey();
      expect(key).toHaveLength(NetConstants.CUBE_KEY_SIZE);
      expect((await chunks[0].getKey()).equals(key)).toBe(true);
      expect(chunks[0].getFirstField(FieldType.NOTIFY).value.equals(recipientKey)).toBe(true);

      // verify test setup: assert Veritum is retrievable
      const testRetrieval: Veritum = await retriever.getVeritum(key);
      expect(testRetrieval.getFirstField(FieldType.PAYLOAD).valueString).toEqual(latin);

      // verify test setup: assert root notification Cube is retrievable
      const rootCubes: Veritable[] = await ArrayFromAsync(
        retriever.cubeRetriever.getNotifications(recipientKey));
      expect(rootCubes.length).toBe(1);
      expect(rootCubes[0] instanceof cciCube).toBe(true);
      expect(rootCubes[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(latin);
      expect((await rootCubes[0].getKey()).equals(key)).toBe(true);

      // run test
      const notifications: Veritum[] = await ArrayFromAsync(
        retriever.getNotifications(recipientKey));
      expect(notifications.length).toBe(1);
      expect(notifications[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(latin);
      expect((await notifications[0].getKey()).equals(key)).toBe(true);
    });

    it('retrieves a three-Cube frozen notification already in store', async () => {
      // sculpt a three-Cube notification and add it to the local CubeStore
      const recipientKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
      const notification: Veritum = new Veritum({
        cubeType: CubeType.FROZEN_NOTIFY,
        fields: [
          VerityField.Payload(evenLonger),
          VerityField.Notify(recipientKey),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        requiredDifficulty: 0,
      });
      await notification.compile();
      for (const chunk of notification.chunks) await cubeStore.addCube(chunk);

      // verify test setup: assert Veritum compiled correctly
      expect(Array.from(notification.chunks)).toHaveLength(3);
      const key: CubeKey = notification.getKeyIfAvailable();
      expect(key).toHaveLength(NetConstants.CUBE_KEY_SIZE);

      // verify test setup: assert Veritum is retrievable
      const testRetrieval: Veritum = await retriever.getVeritum(key);
      expect(testRetrieval.getFirstField(FieldType.PAYLOAD).valueString).toEqual(evenLonger);

      // verify test setup: assert root notification Cube is retrievable
      const rootCubes: Veritable[] = await ArrayFromAsync(
        retriever.cubeRetriever.getNotifications(recipientKey));
      expect(rootCubes.length).toBe(1);
      expect(rootCubes[0] instanceof cciCube).toBe(true);

      // run test
      const retrievedNotifications: Veritum[] = await ArrayFromAsync(
        retriever.getNotifications(recipientKey));
      expect(retrievedNotifications.length).toBe(1);
      expect(retrievedNotifications[0] instanceof Veritum).toBe(true);
      expect(Array.from(retrievedNotifications[0].chunks)).toHaveLength(3);
      expect(retrievedNotifications[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(evenLonger);
      // TODO reinstate line once restored Verita retain their NOTIFY, Github#689
      // expect(retrievedNotifications[0].equals(notification, FieldEqualityMetric.IgnoreOrder)).toBe(true);
    });

    // TODO fix -- does this actually have something to do with notifications
    //   or is it a general Veritum retrieval issue?
    it.skip('retrieves a a single Cube notification PIC arriving over the wire', async () => {
      // Sculpt a single-Cube MUC notification.
      // Note we don't add it to the store just yet, meaning it's not
      // locally available and has to be requested from the network.
      const recipientKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
      const short = "Nuntius brevis succinctus nec plures cubos requirens";
      const singleCube: Veritum = new Veritum({
        cubeType: CubeType.PIC_NOTIFY,
        fields: [
          VerityField.Payload(short),
          VerityField.Notify(recipientKey),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        requiredDifficulty: 0,
      });
      await singleCube.compile();
      const singleCubeBin: Buffer =
        Array.from(singleCube.chunks)[0].getBinaryDataIfAvailable();

      // Run test --
      // note we don't await the result just yet
      const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
        retriever.getNotifications(recipientKey));

      // wait a moment to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));

      // have the single Cube notification "arrive over the wire"
      scheduler.handleCubesDelivered([singleCubeBin], peer);

      // Notification has "arrived", so the retrieval promise should resolve
      const res: Veritable[] = await retrievalPromise;

      // Verify result
      expect(res.length).toBe(1);
      expect(res[0] instanceof Veritum).toBe(true);
      expect(res[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
      expect(res[0].getKeyIfAvailable().equals(singleCube.getKeyIfAvailable())).toBe(true);
    });

    // TODO fix -- does this actually have something to do with notifications
    //   or is it a general Veritum retrieval issue?
    it.skip('retrieves a a single Cube notification MUC arriving over the wire', async () => {
      // Sculpt a single-Cube MUC notification.
      // Note we don't add it to the store just yet, meaning it's not
      // locally available and has to be requested from the network.
      const recipientKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
      const short = "Nuntius brevis succinctus nec plures cubos requirens";
      const keyPair = sodium.crypto_sign_keypair();
      const singleCube: Veritum = new Veritum({
        cubeType: CubeType.MUC_NOTIFY,
        fields: [
          VerityField.Payload(short),
          VerityField.Notify(recipientKey),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        publicKey: Buffer.from(keyPair.publicKey),
        privateKey: Buffer.from(keyPair.privateKey),
        requiredDifficulty: 0,
      });
      await singleCube.compile();
      const singleCubeBin: Buffer =
        Array.from(singleCube.chunks)[0].getBinaryDataIfAvailable();

      // Run test --
      // note we don't await the result just yet
      const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
        retriever.getNotifications(recipientKey));

      // wait a moment to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));

      // have the single Cube notification "arrive over the wire"
      scheduler.handleCubesDelivered([singleCubeBin], peer);

      // Notification has "arrived", so the retrieval promise should resolve
      const res: Veritable[] = await retrievalPromise;

      // Verify result
      expect(res.length).toBe(1);
      expect(res[0] instanceof Veritum).toBe(true);
      expect(res[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
      expect(res[0].getKeyIfAvailable().equals(singleCube.getKeyIfAvailable())).toBe(true);
    });

    // TODO fix -- does this actually have something to do with notifications
    //   or is it a general Veritum retrieval issue?
    it.skip('retrieves a two-Cube frozen Notification arriving over the wire out of order', async () => {
      // Sculpt a two-Cube notification.
      // Note we don't add it to the store just yet, meaning they're not
      // locally available and have to be requested from the network.
      const recipientKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
      const twoCube: Veritum = new Veritum({
        cubeType: CubeType.FROZEN_NOTIFY,
        fields: [
          VerityField.Payload(tooLong),
          VerityField.Notify(recipientKey),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        requiredDifficulty: 0,
      });
      await twoCube.compile();
      const twoCubeChunks = Array.from(twoCube.chunks);
      const twoCubeChunk1Bin: Buffer = twoCubeChunks[0].getBinaryDataIfAvailable();
      const twoCubeChunk2Bin: Buffer = twoCubeChunks[1].getBinaryDataIfAvailable();

      // Run test --
      // note we don't await the result just yet
      const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
        retriever.getNotifications(recipientKey));

      // wait a moment to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));

      // have the second Cube of the two-Cube notification "arrive over the wire"
      // (testing out-of-order arrival)
      scheduler.handleCubesDelivered([twoCubeChunk2Bin], peer);

      // wait a moment to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));

      // have the first Cube of the two-Cube notification "arrive over the wire"
      scheduler.handleCubesDelivered([twoCubeChunk1Bin], peer);

      // All chunks have "arrived", so the retrieval promise should resolve
      const res: Veritable[] = await retrievalPromise;

      // Verify result
      expect(res.length).toBe(1);
      expect(res[0] instanceof Veritum).toBe(true);
      expect(res[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(tooLong);
      expect(res[0].getKeyIfAvailable().equals(twoCube.getKeyIfAvailable())).toBe(true);
    });


    // TODO fix -- does this actually have something to do with notifications
    //   or is it a general Veritum retrieval issue?
    it.skip('retrieves a two-Cube frozen Notification as well as a single Cube notification MUC arriving over the wire out of order', async () => {
      // Sculpt a two-Cube notification and a single-Cube notification.
      // Note we don't add those to the store just yet, meaning they're not
      // locally available and have to be requested from the network.
      const recipientKey: CubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42);
      const twoCube: Veritum = new Veritum({
        cubeType: CubeType.FROZEN_NOTIFY,
        fields: [
          VerityField.Payload(tooLong),
          VerityField.Notify(recipientKey),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        requiredDifficulty: 0,
      });
      await twoCube.compile();
      const twoCubeChunks = Array.from(twoCube.chunks);
      const twoCubeChunk1Bin: Buffer = twoCubeChunks[0].getBinaryDataIfAvailable();
      const twoCubeChunk2Bin: Buffer = twoCubeChunks[1].getBinaryDataIfAvailable();

      const short = "Nuntius brevis succinctus nec plures cubos requirens";
      const keyPair = sodium.crypto_sign_keypair();
      const singleCube: Veritum = new Veritum({
        cubeType: CubeType.MUC_NOTIFY,
        fields: [
          VerityField.Payload(short),
          VerityField.Notify(recipientKey),
          VerityField.Date(),  // add DATE explicitly just to simplify comparison
        ],
        publicKey: Buffer.from(keyPair.publicKey),
        privateKey: Buffer.from(keyPair.privateKey),
        requiredDifficulty: 0,
      });
      await singleCube.compile();
      const singleCubeBin: Buffer =
        Array.from(singleCube.chunks)[0].getBinaryDataIfAvailable();


      // Run test --
      // note we don't await the result just yet
      const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
        retriever.getNotifications(recipientKey));

      // wait a moment to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));

      // have the single Cube notification "arrive over the wire"
      scheduler.handleCubesDelivered([singleCubeBin], peer);

      // wait a moment to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));

      // have the second Cube of the two-Cube notification "arrive over the wire"
      // (testing out-of-order arrival)
      scheduler.handleCubesDelivered([twoCubeChunk2Bin], peer);

      // wait a moment to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));

      // have the first Cube of the two-Cube notification "arrive over the wire"
      scheduler.handleCubesDelivered([twoCubeChunk1Bin], peer);

      // All chunks have "arrived", so the retrieval promise should resolve
      const res: Veritable[] = await retrievalPromise;


      // Verify result
      expect(res.length).toBe(2);
      expect(res[0] instanceof Veritum).toBe(true);
      expect(res[1] instanceof Veritum).toBe(true);
      expect(res[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
      expect(res[1].getFirstField(FieldType.PAYLOAD).valueString).toEqual(tooLong);
      expect(res[0].getKeyIfAvailable().equals(singleCube.getKeyIfAvailable())).toBe(true);
      expect(res[1].getKeyIfAvailable().equals(twoCube.getKeyIfAvailable())).toBe(true);
    }, 1000000);

    it.todo('retrieves a three-Cube frozen notification of which the root Cube was already in store but the remaining two chunks had to be retrieved over the wire', async () => {
    });
  });
});
