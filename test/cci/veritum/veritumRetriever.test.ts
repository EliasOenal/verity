import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { cciFieldType } from '../../../src/cci/cube/cciCube.definitions';
import { cciField } from '../../../src/cci/cube/cciField';
import { Continuation } from '../../../src/cci/veritum/continuation';
import { Veritum } from '../../../src/cci/veritum/veritum';
import { VeritumRetriever } from '../../../src/cci/veritum/veritumRetriever';
import { CubeType, CubeKey } from '../../../src/core/cube/cube.definitions';
import { CubeStoreOptions, CubeStore } from '../../../src/core/cube/cubeStore';
import { CubeRequestOptions, RequestScheduler } from '../../../src/core/networking/cubeRetrieval/requestScheduler';
import { NetworkManagerIf } from '../../../src/core/networking/networkManagerIf';
import { DummyNetworkManager } from '../../../src/core/networking/testingDummies/networkManagerDummy';
import { PeerDB } from '../../../src/core/peering/peerDB';
import { tooLong, evenLonger, farTooLong } from '../testcci.definitions';
import { CubeRetriever } from '../../../src/core/networking/cubeRetrieval/cubeRetriever';

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

  beforeEach(async () => {
    cubeStore = new CubeStore(cubeStoreOptions);
    await cubeStore.readyPromise;
    networkManager = new DummyNetworkManager(cubeStore, new PeerDB());
    scheduler = new RequestScheduler(networkManager);
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
    it('yields a single chunk already in store', async () => {
      // prepare test data
      const cube: cciCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        fields: [
          cciField.Payload("Hoc non est cadena continuationis"),
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
      expect(chunks[0].getFirstField(cciFieldType.PAYLOAD).valueString).toEqual("Hoc non est cadena continuationis");
    });

    it('yields a single chunk arriving after the request', async () => {
      // prepare test data
      const cube: cciCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        fields: [
          cciField.Payload("Hoc non est cadena continuationis"),
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
      expect(chunks[0].getFirstField(cciFieldType.PAYLOAD).valueString).toEqual("Hoc non est cadena continuationis");
    });

    it('yields a 2-chunk continuation already in store', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(tooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // split the macro Cube and add all parts to the store
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
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
      const recombined: Veritum = Continuation.Recombine(chunks, {requiredDifficulty: 0});
      expect(recombined.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(tooLong);
    });

    it('yields a 2-chunk continuation arriving in correct order after the request', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(tooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // split the macro Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
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
      const recombined: Veritum = Continuation.Recombine(chunks, {requiredDifficulty: 0});
      expect(recombined.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(tooLong);
    });


    // TODO: This test sporadically fails on my machine and I don't know why :(
    it('yields a 2-chunk continuation arriving in reverse order after the request', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(tooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // split the macro Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
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
      const recombined: Veritum = Continuation.Recombine(chunks, {requiredDifficulty: 0});
      expect(recombined.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(tooLong);
    });

    it('yields a three-chunk continuation already in store', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(evenLonger);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // split the macro Cube and add all parts to the store
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
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
      const recombined: Veritum = Continuation.Recombine(chunks, {requiredDifficulty: 0});
      expect(recombined.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(evenLonger);
    });



    it('yields a more-than-5-chunk continuation arriving in sequence', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(farTooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // split the macro Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
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
      const recombined: Veritum = Continuation.Recombine(chunks, {requiredDifficulty: 0});
      expect(recombined.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(farTooLong);
    });


    it('yields a more-than-5-chunk continuation already in store', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(farTooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // split the macro Cube and add all parts to the store
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
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
      const recombined: Veritum = Continuation.Recombine(chunks, {requiredDifficulty: 0});
      expect(recombined.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(farTooLong);
    });

    it.todo('yields a random continuation arriving in random order (fuzzing test)');
    it.todo('terminates on circular references');
  });
});
