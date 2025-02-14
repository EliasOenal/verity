import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { cciCube } from '../../../src/cci/cube/cciCube';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';
import { VerityField } from '../../../src/cci/cube/verityField';
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
import { CubeField } from '../../../src/core/cube/cubeField';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { ArrayFromAsync } from '../../../src/core/helpers/misc';

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
        ],
        requiredDifficulty: 0,
      });
      for (const chunk of await veritum.compile()) cubeStore.addCube(chunk);
      const key: CubeKey = veritum.getKeyIfAvailable();

      const retrievedVeritum: Veritum = await retriever.getVeritum(key);
      expect(retrievedVeritum.equals(veritum)).toBe(true);
    });

    it.todo('retrieves multi-Cube notification PICs');
    it.todo('retrieves multi-Cube notification MUCs');
    it.todo('retrieves multi-Cube notification PMUCs');
  });
});
