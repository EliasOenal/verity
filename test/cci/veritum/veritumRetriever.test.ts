import { ArrayFromAsync } from '../../../src/core/helpers/misc';
import { CubeType, CubeKey, NotificationKey } from '../../../src/core/cube/cube.definitions';
import { Cube } from '../../../src/core/cube/cube';
import { Veritable } from '../../../src/core/cube/veritable.definition';
import { CubeStore } from '../../../src/core/cube/cubeStore';

import { NetConstants } from '../../../src/core/networking/networkDefinitions';
import { CubeRequestOptions, RequestScheduler } from '../../../src/core/networking/cubeRetrieval/requestScheduler';
import { NetworkManagerIf } from '../../../src/core/networking/networkManagerIf';
import { DummyNetworkManager } from '../../../src/core/networking/testingDummies/dummyNetworkManager';
import { DummyNetworkPeer } from '../../../src/core/networking/testingDummies/dummyNetworkPeer';
import { CubeRetriever } from '../../../src/core/networking/cubeRetrieval/cubeRetriever';

import { PeerDB } from '../../../src/core/peering/peerDB';

import { cciCube } from '../../../src/cci/cube/cciCube';
import { FieldType } from '../../../src/cci/cube/cciCube.definitions';
import { RelationshipType } from '../../../src/cci/cube/relationship';
import { VerityField } from '../../../src/cci/cube/verityField';
import { Recombine, Split } from '../../../src/cci/veritum/continuation';
import { RetrievalFormat } from '../../../src/cci/veritum/veritum.definitions';
import { Veritum } from '../../../src/cci/veritum/veritum';
import { MetadataEnhancedRetrieval, ResolveRelsRecursiveResult, ResolveRelsResult } from '../../../src/cci/veritum/veritumRetrievalUtil';
import { VeritumRetriever } from '../../../src/cci/veritum/veritumRetriever';

import { tooLong, evenLonger, farTooLong, testCciOptions } from '../testcci.definitions';

import sodium from 'libsodium-wrappers-sumo'

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('VeritumRetriever', () => {
  let cubeStore: CubeStore;
  let networkManager: NetworkManagerIf;
  let scheduler: RequestScheduler;
  let retriever: VeritumRetriever<CubeRequestOptions>;
  let peer: DummyNetworkPeer;

  beforeAll(async () => {
    await sodium.ready;
  });

  beforeEach(async () => {
    cubeStore = new CubeStore(testCciOptions);
    await cubeStore.readyPromise;

    networkManager = new DummyNetworkManager(cubeStore, new PeerDB());
    peer = new DummyNetworkPeer(networkManager, undefined, cubeStore);
    networkManager.outgoingPeers = [peer];

    scheduler = new RequestScheduler(networkManager, {
      ...testCciOptions,
      requestTimeout: 200,
    });
    const cubeRetriever = new CubeRetriever(cubeStore, scheduler);
    retriever = new VeritumRetriever(cubeRetriever);
  });

  afterEach(async () => {
    await cubeStore.shutdown();
    await networkManager.shutdown();
    await scheduler.shutdown();
    await retriever.shutdown();
  });

  describe('getCube()', () => {
    let cubeA: cciCube, cubeB: cciCube, cubeC: cciCube;

    beforeAll(async () => {
      cubeC = cciCube.Create({
        fields: [
          VerityField.Payload("Ultimus cubus in catena cuborum"),
          VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
        ],
        requiredDifficulty: 0,
      });
      const keyC = await cubeC.getKey();

      cubeB = cciCube.Create({
        fields: [
          VerityField.Payload("Secundus cubus in catena cuborum"),
          VerityField.RelatesTo(RelationshipType.REPLY_TO, keyC),
          VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
        ],
        requiredDifficulty: 0,
      });
      const keyB = await cubeB.getKey();

      cubeA = cciCube.Create({
        fields: [
          VerityField.Payload("Primus cubus in catena cuborum"),
          VerityField.RelatesTo(RelationshipType.REPLY_TO, keyB),
          VerityField.RelatesTo(RelationshipType.MYPOST, keyB),
          VerityField.RelatesTo(RelationshipType.MYPOST, keyC),
          VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
        ],
        requiredDifficulty: 0,
      });
      const keyA = await cubeA.getKey();
    });

    describe('base use case (getting a plain Cube)', () => {
      beforeEach(async () => {
        await cubeStore.addCube(cubeA);
      });

      it('retrieves a Cube', async () => {
        const result = await retriever.getCube(cubeA.getKeyIfAvailable());
        expect(result.equals(cubeA)).toEqual(true);
      });
    });

    describe('using option resolveRels (single layer)', () => {
      beforeEach(async () => {
        await Promise.all([
          cubeStore.addCube(cubeA), cubeStore.addCube(cubeB), cubeStore.addCube(cubeC)]);
      });

      it('retrieves a Cube and its direct relationships', async () => {
        // verify direct return type
        const resultPromise: Promise<ResolveRelsResult> =
          retriever.getCube(cubeA.getKeyIfAvailable(), { resolveRels: true });
        expect(resultPromise).toBeInstanceOf(Promise);

        // verify main result (Cube A) referenced correctly
        const result: ResolveRelsResult = await resultPromise;
        expect(result.main.equals(cubeA)).toBe(true);

        // verify REPLY_TO rel to Cube B resolved
        const replyPromise: Promise<Veritable> = result[RelationshipType.REPLY_TO][0];
        expect(replyPromise).toBeInstanceOf(Promise);
        const reply: Veritable = await replyPromise;
        expect(reply.equals(cubeB)).toBe(true);

        // verify MYPOST rel to Cube B resolved
        const postBPromise: Promise<Veritable> = result[RelationshipType.MYPOST][0];
        expect(postBPromise).toBeInstanceOf(Promise);
        const postB: Veritable = await postBPromise;
        expect(postB.equals(cubeB)).toBe(true);

        // verify MYPOST rel to Cube C resolved
        const postCPromise: Promise<Veritable> = result[RelationshipType.MYPOST][1];
        expect(postCPromise).toBeInstanceOf(Promise);
        const postC: Veritable = await postCPromise;
        expect(postC.equals(cubeC)).toBe(true);
      });
    });

    describe('using option resolveRels (recursive)', () => {
      beforeEach(async () => {
        await Promise.all([
          cubeStore.addCube(cubeA), cubeStore.addCube(cubeB), cubeStore.addCube(cubeC)]);
      });

      it('retrieves a Cube and its recursive relationships, limited to REPLY_TO rels', async() => {
        // verify direct return type
        const resultPromise: Promise<ResolveRelsRecursiveResult> =
          retriever.getCube(cubeA.getKeyIfAvailable(),
          { resolveRels: 'recursive', relTypes: [RelationshipType.REPLY_TO] });
        expect(resultPromise).toBeInstanceOf(Promise);

        // verify main result (Cube A) referenced correctly
        const result: ResolveRelsRecursiveResult = await resultPromise;
        expect(result.main.equals(cubeA)).toBe(true);

        // verify REPLY_TO rel to Cube B resolved
        const replyPromise: Promise<ResolveRelsRecursiveResult> = result[RelationshipType.REPLY_TO][0];
        expect(replyPromise).toBeInstanceOf(Promise);
        const reply: ResolveRelsRecursiveResult = await replyPromise;
        expect(reply.main.equals(cubeB)).toBe(true);

        // verify recursive REPLY_TO rel form Cube B to Cube C resolved
        const subreplyPromise: Promise<ResolveRelsRecursiveResult> = reply[RelationshipType.REPLY_TO][0];
        expect(subreplyPromise).toBeInstanceOf(Promise);
        const subreply: ResolveRelsRecursiveResult = await subreplyPromise;
        expect(subreply.main.equals(cubeC)).toBe(true);

        // verify direct MYPOST rel not resolved, as we opted out
        expect(result[RelationshipType.MYPOST]).toBeUndefined();

        // verify indirect MYPOST rel not resolved, as we opted out
        expect(reply[RelationshipType.MYPOST]).toBeUndefined();
      });
    });
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
          splitCubes[0].getKeyIfAvailable())) {
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


    // Note! Out of order arrival is really not expected to happen as the
    // requester only learns the second chunk's key upon receiving the first.
    // Also note that the only way we can test out-of-order arrival is by
    // sneaking in the second chunk directly through CubeStore, as a light
    // node's RequestScheduler would otherwise deny the chunk as it has not
    // (yet) been requested.
    it('yields a 2-chunk continuation sneaking in through CubeStore after the request, out of order', async () => {
      // Sculpt a two-Cube Veritum.
      // Note we don't add it to the store just yet, meaning it's not
      // locally available and has to be requested over the wire.
      const veritum = Veritum.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
        fields: VerityField.Payload(tooLong),
      });
      await veritum.compile();
      const key: CubeKey = veritum.getKeyIfAvailable();
      expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);

      const originalChunks = Array.from(veritum.chunks);
      expect(originalChunks).toHaveLength(2);
      expect(originalChunks[0].getKeyIfAvailable().equals(key)).toBe(true);
      expect(originalChunks[1].getKeyIfAvailable().length).toBe(NetConstants.CUBE_KEY_SIZE);
      expect(originalChunks[1].getKeyIfAvailable().equals(key)).toBe(false);

      // Run test --
      // note we don't await the result just yet
      const rGen: AsyncGenerator<cciCube> = retriever.getContinuationChunks(key);
      const chunkPromise: Promise<cciCube[]> = ArrayFromAsync(rGen);

      // simulate arrival of chunks by adding them to CubeStore --
      // note this happens after the request has been fired
      // and note the chunks are arriving in reverse order
      await new Promise(resolve => setTimeout(resolve, 50));  // give it some time
      await cubeStore.addCube(originalChunks[1]);
      await new Promise(resolve => setTimeout(resolve, 50));  // give it some time
      await cubeStore.addCube(originalChunks[0]);

      // All chunks have "arrived", so the retrieval promise should resolve
      const retrievedChunks: cciCube[] = await chunkPromise;

      // Verify result
      expect(retrievedChunks).toHaveLength(2);
      expect(retrievedChunks[0].equals(originalChunks[0])).toBe(true);
      // expect(retrievedChunks[1].equals(twoCubeChunks[1])).toBe(true);
      const restoredPayload: string =
        retrievedChunks[0].getFirstField(FieldType.PAYLOAD).valueString +
        retrievedChunks[1].getFirstField(FieldType.PAYLOAD).valueString;
      expect(restoredPayload).toEqual(tooLong);
    });

    describe('error handling', () => {
      describe('missing chunks', () => {
        it('aborts if the first chunk is missing and returns an error', async () => {
          // prepare test data
          const notificationKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as NotificationKey;
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
    describe('Plain Verita already in store', () => {
      it('retrieves a a single PIC Veritum already in store', async () => {
        const short = "Verita brevia unum tantum cubum exigunt";
        const veritum: Veritum = new Veritum({
          cubeType: CubeType.PIC,
          fields: [
            VerityField.Payload(short),
            VerityField.Date(),  // add DATE explicitly just to simplify comparison
          ],
          requiredDifficulty: 0,
        });
        await veritum.compile();
        const chunk: cciCube = Array.from(veritum.chunks)[0];
        await cubeStore.addCube(chunk);
        const key: CubeKey = await veritum.getKey();
        expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);

        // Run test
        const res: Veritable = await retriever.getVeritum(key);

        // Verify result
        expect(res instanceof Veritum).toBe(true);
        expect(res.getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
        expect((await res.getKey()).equals(veritum.getKeyIfAvailable())).toBe(true);
      });

      it('retrieves a three-chunk frozen Veritum already in store', async () => {
        const veritum: Veritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: [
            VerityField.Payload(evenLonger),
            VerityField.Date(),  // add DATE explicitly just to simplify comparison
          ],
          requiredDifficulty: 0,
        });
        await veritum.compile();
        const chunks: cciCube[] = Array.from(veritum.chunks);
        for (const chunk of chunks) cubeStore.addCube(chunk);
        const key: CubeKey = veritum.getKeyIfAvailable();

        const retrievedVeritum: Veritum = await retriever.getVeritum(key);
        expect(retrievedVeritum instanceof Veritum).toBe(true);
        expect(retrievedVeritum.cubeType).toBe(CubeType.FROZEN);
        expect(retrievedVeritum.getFirstField(FieldType.PAYLOAD).valueString).toEqual(evenLonger);
        expect(retrievedVeritum.equals(veritum)).toBe(true);
      });

      it('retrieves a three-chunk PIC Veritum already in store', async () => {
        const veritum: Veritum = new Veritum({
          cubeType: CubeType.PIC,
          fields: [
            VerityField.Payload(evenLonger),
            VerityField.Date(),  // add DATE explicitly just to simplify comparison
          ],
          requiredDifficulty: 0,
        });
        await veritum.compile();
        const chunks: cciCube[] = Array.from(veritum.chunks);
        for (const chunk of chunks) cubeStore.addCube(chunk);
        const key: CubeKey = veritum.getKeyIfAvailable();

        const retrievedVeritum: Veritum = await retriever.getVeritum(key);
        expect(retrievedVeritum instanceof Veritum).toBe(true);
        expect(retrievedVeritum.cubeType).toBe(CubeType.PIC);
        expect(retrievedVeritum.getFirstField(FieldType.PAYLOAD).valueString).toEqual(evenLonger);
        expect(retrievedVeritum.equals(veritum)).toBe(true);
      });
    });

    describe('Plain Verita retrieved over the wire', () => {
      it('retrieves a a single PIC Veritum arriving over the wire', async () => {
        // use longer timeout for this test
        scheduler.options.requestTimeout = 1000;

        // Sculpt a single-Cube PIC Veritum.
        // Note we don't add it to the store just yet, meaning it's not
        // locally available and has to be requested from the network.
        const short = "Verita brevia unum tantum cubum exigunt";
        const singleCube: Veritum = new Veritum({
          cubeType: CubeType.PIC,
          fields: [
            VerityField.Payload(short),
            VerityField.Date(),  // add DATE explicitly just to simplify comparison
          ],
          requiredDifficulty: 0,
        });
        await singleCube.compile();
        const singleCubeBin: Buffer =
          Array.from(singleCube.chunks)[0].getBinaryDataIfAvailable();
        const key: CubeKey = await singleCube.getKey();
        expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);

        // Run test --
        // note we don't await the result just yet
        const retrievalPromise: Promise<Veritable> = retriever.getVeritum(key);

        // Just for verification, also test a single Cube retrieval,
        // which for a single Cube Veritum is almost the same thing
        const cubePromise: Promise<Cube> = retriever.cubeRetriever.getCube(key);

        // wait a moment to simulate network latency
        await new Promise(resolve => setTimeout(resolve, 100));

        // have the single Cube notification "arrive over the wire"
        scheduler.handleCubesDelivered([singleCubeBin], peer);

        // test that the single Cube has correctly retrieved first
        const testCube: cciCube = await cubePromise as cciCube;
        expect(testCube).toBeDefined();
        expect(testCube instanceof cciCube).toBe(true);
        expect(testCube.cubeType).toBe(CubeType.PIC);
        expect(testCube.getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
        expect(testCube.getFirstField(FieldType.DATE)).toBeDefined();
        expect(testCube.getFirstField(FieldType.DATE).value.equals(
          singleCube.getFirstField(FieldType.DATE).value)).toBe(true);

        // Verify result: Assert that the Veritum has been reconstructed correctly
        const res: Veritable = await retrievalPromise;
        expect(res).toBeDefined();
        expect(res instanceof Veritum).toBe(true);
        expect(res.getFirstField(FieldType.PAYLOAD).valueString).toEqual(short);
        expect(res.getKeyIfAvailable().equals(singleCube.getKeyIfAvailable())).toBe(true);
      });


      // Note! The first chunk of a Veritum can never arrive "out of order"
      // as it is the one containing the references to further chunks; without
      // the first chunk, a client would not even know to request further ones.
      it('retrieves a three-Cube frozen PIC Veritum arriving over the wire out of order', async () => {
        // Sculpt a two-Cube Veritum.
        // Note we don't add it to the store just yet, meaning it's not
        // locally available and has to be requested over the wire.
        const veritum: Veritum = new Veritum({
          cubeType: CubeType.PIC,
          fields: [
            VerityField.Payload(evenLonger),
            VerityField.Date(),  // add DATE explicitly just to simplify comparison
          ],
          requiredDifficulty: 0,
        });
        await veritum.compile();
        const key: CubeKey = veritum.getKeyIfAvailable();
        expect(key.length).toBe(NetConstants.CUBE_KEY_SIZE);

        const originalChunks = Array.from(veritum.chunks);
        expect(originalChunks).toHaveLength(3);
        const twoCubeChunk1Bin: Buffer = originalChunks[0].getBinaryDataIfAvailable();
        const twoCubeChunk2Bin: Buffer = originalChunks[1].getBinaryDataIfAvailable();
        const twoCubeChunk3Bin: Buffer = originalChunks[2].getBinaryDataIfAvailable();

        // Run test --
        // note we don't await the result just yet
        const retrievalPromise: Promise<Veritum> = retriever.getVeritum(key);

        // wait a moment to simulate network latency
        await new Promise(resolve => setTimeout(resolve, 50));

        // have the first chunk "arrive over the wire"
        scheduler.handleCubesDelivered([twoCubeChunk1Bin], peer);

        // wait a moment to simulate network latency
        await new Promise(resolve => setTimeout(resolve, 50));

        // have the third chunk "arrive over the wire" (that's out of order)
        scheduler.handleCubesDelivered([twoCubeChunk2Bin], peer);

        // wait a moment to simulate network latency
        await new Promise(resolve => setTimeout(resolve, 50));

        // have the second chunk "arrive over the wire" (that's out of order)
        scheduler.handleCubesDelivered([twoCubeChunk3Bin], peer);

        // All chunks have "arrived", so the retrieval promise should resolve
        const res: Veritum = await retrievalPromise;

        // Verify result
        expect(res instanceof Veritum).toBe(true);
        expect(res.getFirstField(FieldType.PAYLOAD).valueString).toEqual(evenLonger);
        expect(res.getKeyIfAvailable().equals(veritum.getKeyIfAvailable())).toBe(true);
      });
    });

    describe('using option metadata (wrapping results in a metadata object)', () => {
      it('wraps the returned value in a metadata object', async() => {
        const val = Veritum.Create({
          fields: [
            VerityField.Payload("multa de me dicenda sunt"),
            VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
          ],
          requiredDifficulty: 0,
        });
        await val.compile();
        for (const chunk of val.chunks) await cubeStore.addCube(chunk);

        const res: MetadataEnhancedRetrieval<Veritum> =
          await retriever.getVeritum(val.getKeyIfAvailable(), {metadata: true});

        expect(res.main.getKeyStringIfAvailable()).toEqual(val.getKeyStringIfAvailable());
        expect(res.main.equals(val)).toBe(true);
        expect(res.isDone).toBe(true);
      });
    });

    describe('auto-resolving relationships', () => {
      let vA: Veritum, vB: Veritum, vC: Veritum;

      beforeAll(async () => {
        vC = Veritum.Create({
          fields: [
            VerityField.Payload("Ultimum veritum in catena veritatum"),
            VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
          ],
          requiredDifficulty: 0,
        });
        const keyC = await vC.getKey();

        vB = Veritum.Create({
          fields: [
            VerityField.Payload(evenLonger),
            VerityField.RelatesTo(RelationshipType.REPLY_TO, keyC),
            VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
          ],
          requiredDifficulty: 0,
        });
        const keyB = await vB.getKey();

        vA = Veritum.Create({
          fields: [
            VerityField.Payload("Breve veritum unum tantum cubum exigens"),
            VerityField.RelatesTo(RelationshipType.REPLY_TO, keyB),
            VerityField.RelatesTo(RelationshipType.MYPOST, keyB),
            VerityField.RelatesTo(RelationshipType.MYPOST, keyC),
            VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
          ],
          requiredDifficulty: 0,
        });
        const keyA = await vA.getKey();
      });

      beforeEach(async () => {
        await Promise.all([
          vA.compile().then(chunks => { for (const chunk of chunks) cubeStore.addCube(chunk) } ),
          vB.compile().then(chunks => { for (const chunk of chunks) cubeStore.addCube(chunk) } ),
          vC.compile().then(chunks => { for (const chunk of chunks) cubeStore.addCube(chunk) } ),
        ]);
      });

      describe('using option resolveRels=true (single layer)', () => {
        it('retrieves a Veritum and its direct relationships', async () => {
          // verify direct return type
          const resultPromise: Promise<ResolveRelsResult> =
            retriever.getVeritum(vA.getKeyIfAvailable(), { resolveRels: true });
          expect(resultPromise).toBeInstanceOf(Promise);

          // verify main result (Veritum A) referenced correctly
          const result: ResolveRelsResult = await resultPromise;
          expect(result.main.equals(vA)).toBe(true);

          // verify REPLY_TO rel to Veritum B resolved
          const replyPromise: Promise<Veritable> = result[RelationshipType.REPLY_TO][0];
          expect(replyPromise).toBeInstanceOf(Promise);
          const reply: Veritable = await replyPromise;
          expect(reply.equals(vB)).toBe(true);

          // verify MYPOST rel to Veritum B resolved
          const postBPromise: Promise<Veritable> = result[RelationshipType.MYPOST][0];
          expect(postBPromise).toBeInstanceOf(Promise);
          const postB: Veritable = await postBPromise;
          expect(postB.equals(vB)).toBe(true);

          // verify MYPOST rel to Veritum C resolved
          const postCPromise: Promise<Veritable> = result[RelationshipType.MYPOST][1];
          expect(postCPromise).toBeInstanceOf(Promise);
          const postC: Veritable = await postCPromise;
          expect(postC.equals(vC)).toBe(true);
        });

        it('returns an empty metadata object if the Veritum is not retrievable', async () => {
          const result: ResolveRelsResult =
            await retriever.getVeritum(
              Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as CubeKey, {
                resolveRels: true,
          });
          expect(result).toBeDefined();
          expect(result.main).toBeUndefined();
          expect(result.isDone).toBe(true);
          expect(result.allResolved).toBe(false);
          expect(result.resolutionFailure).toBe(true);
        });
      });  // using option resolveRels=true (single layer)

      describe("using option resolveRels='veritum' (recursive)", () => {
        it('retrieves a Veritum and its recursive relationships, limited to REPLY_TO rels', async() => {
          // verify direct return type
          const resultPromise: Promise<ResolveRelsRecursiveResult> =
            retriever.getVeritum(vA.getKeyIfAvailable(),
            { resolveRels: 'recursive', relTypes: [RelationshipType.REPLY_TO] });
          expect(resultPromise).toBeInstanceOf(Promise);

          // verify main result (Veritum A) referenced correctly
          const result: ResolveRelsRecursiveResult = await resultPromise;
          expect(result.main.equals(vA)).toBe(true);

          // verify REPLY_TO rel to Veritum B resolved
          const replyPromise: Promise<ResolveRelsRecursiveResult> = result[RelationshipType.REPLY_TO][0];
          expect(replyPromise).toBeInstanceOf(Promise);
          const reply: ResolveRelsRecursiveResult = await replyPromise;
          expect(reply.main.equals(vB)).toBe(true);

          // verify recursive REPLY_TO rel from Veritum B to Veritum C resolved
          const subreplyPromise: Promise<ResolveRelsRecursiveResult> = reply[RelationshipType.REPLY_TO][0];
          expect(subreplyPromise).toBeInstanceOf(Promise);
          const subreply: ResolveRelsRecursiveResult = await subreplyPromise;
          expect(subreply.main.equals(vC)).toBe(true);

          // verify direct MYPOST rel not resolved, as we opted out
          expect(result[RelationshipType.MYPOST]).toBeUndefined();

          // verify indirect MYPOST rel not resolved, as we opted out
          expect(reply[RelationshipType.MYPOST]).toBeUndefined();
        });

        it('returns an empty metadata object if the Veritum is not retrievable', async () => {
          const result: ResolveRelsRecursiveResult =
            await retriever.getVeritum(
              Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x42) as CubeKey, {
                resolveRels: 'recursive',
          });
          expect(result).toBeDefined();
          expect(result.main).toBeUndefined();
          expect(result.isDone).toBe(true);
          expect(result.allResolved).toBe(false);
          expect(result.resolutionFailure).toBe(true);
        });
      });  // using option resolveRels='veritum' (recursive)
    });  // using option resolveRels


    describe.todo('missing getVeritum() test cases', () => {
      it.todo('returns undefined if the second chunk of a two-chunk Veritum is unretrievable');
      // TODO FIXME BUGBUG multi-Cube PIC Veritum handling still buggy :(
      it.todo('retrieves multi-Cube notification PICs');
      // multi-Cube signed Verita currently not supported; Github#634
      it.todo('retrieves multi-Cube notification MUCs');
      it.todo('retrieves multi-Cube notification PMUCs');
    });
  });

  describe('getNotifications()', () => {
    describe('retrieval as Veritum', () => {
      describe('notifications already in store', () => {
        describe('plain Veritum retrieval (no metadata option)', () => {
          it('retrieves a single-Cube notification PIC already in store', async () => {
            // sculpt a single-Cube notification and add it to the local CubeStore
            const latin = "Nuntius brevis succinctus nec plures cubos requirens";
            const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x43) as NotificationKey;
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
            const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x44) as NotificationKey;
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

          it('retrieves two locally available single-Cube notifications', async () => {
            // Sculpt two single-Chunk notifications
            const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x45) as NotificationKey;

            const firstLatin = "Magni momenti nuntiatio";
            const first: Veritum = new Veritum({
              cubeType: CubeType.PIC_NOTIFY,
              fields: [
                VerityField.Payload(firstLatin),
                VerityField.Notify(recipientKey),
                VerityField.Date(),  // add DATE explicitly just to simplify comparison
              ],
              requiredDifficulty: 0,
            });
            await first.compile();
            const firstChunk: cciCube = Array.from(first.chunks)[0];
            await cubeStore.addCube(firstChunk);

            const secondLatin = "Haud minus magni momenti nuntiatio";
            const second: Veritum = new Veritum({
              cubeType: CubeType.PIC_NOTIFY,
              fields: [
                VerityField.Payload(secondLatin),
                VerityField.Notify(recipientKey),
                VerityField.Date(),  // add DATE explicitly just to simplify comparison
              ],
              requiredDifficulty: 0,
            });
            await second.compile();
            const secondChunk: cciCube = Array.from(second.chunks)[0];
            await cubeStore.addCube(secondChunk);

            // Run test --
            // note we don't await the result just yet
            const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
              retriever.getNotifications(recipientKey));
            const res: Veritable[] = await retrievalPromise;

            // Verify result
            expect(res.length).toBe(2);
            expect(res.every(v => v instanceof Veritum)).toBe(true);
            expect(res.some(v => v.equals(first))).toBe(true);
            expect(res.some(v => v.equals(second))).toBe(true);
          });
        });

        describe('using option metadata (wrapping results in a metadata object)', () => {
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x44) as NotificationKey;

          it('wraps the returned Notification in a metadata object', async() => {
            const val = Veritum.Create({
              fields: [
                VerityField.Payload("multa de me dicenda sunt"),
                VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
                VerityField.Notify(recipientKey),
              ],
              requiredDifficulty: 0,
            });
            await val.compile();
            for (const chunk of val.chunks) await cubeStore.addCube(chunk);

            const ress: MetadataEnhancedRetrieval<Veritum>[] = await ArrayFromAsync(
              retriever.getNotifications(recipientKey, {metadata: true}));
            expect(ress.length).toBe(1);
            const res: MetadataEnhancedRetrieval<Veritum> = ress[0];

            expect(res.main.equals(val)).toBe(true);
            expect(res.isDone).toBe(true);
          });
        });

        describe('auto-resolving relationships', () => {
          let vA: Veritum, vB: Veritum, vC: Veritum;
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x44) as NotificationKey;

          beforeAll(async () => {
            vC = Veritum.Create({
              fields: [
                VerityField.Payload("Ultimum veritum in catena veritatum"),
                VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
              ],
              requiredDifficulty: 0,
            });
            const keyC = await vC.getKey();

            vB = Veritum.Create({
              fields: [
                VerityField.Payload(evenLonger),
                VerityField.RelatesTo(RelationshipType.REPLY_TO, keyC),
                VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
              ],
              requiredDifficulty: 0,
            });
            const keyB = await vB.getKey();

            vA = Veritum.Create({
              fields: [
                VerityField.Payload("Breve veritum unum tantum cubum exigens"),
                VerityField.RelatesTo(RelationshipType.REPLY_TO, keyB),
                VerityField.RelatesTo(RelationshipType.MYPOST, keyB),
                VerityField.RelatesTo(RelationshipType.MYPOST, keyC),
                VerityField.Date(148302000),  // fixed date, thus fixed key for ease of testing
                VerityField.Notify(recipientKey),
              ],
              requiredDifficulty: 0,
            });
            const keyA = await vA.getKey();
          });

          beforeEach(async () => {
            await Promise.all([
              vA.compile().then(chunks => { for (const chunk of chunks) cubeStore.addCube(chunk) } ),
              vB.compile().then(chunks => { for (const chunk of chunks) cubeStore.addCube(chunk) } ),
              vC.compile().then(chunks => { for (const chunk of chunks) cubeStore.addCube(chunk) } ),
            ]);
          });

          describe('using option resolveRels=true (single layer)', () => {
            it('retrieves a Notification and its direct relationships', async () => {
              // fetch notification
              const ress: ResolveRelsResult<Veritum>[] = await ArrayFromAsync(
                retriever.getNotifications(recipientKey, {
                  metadata: true,
                  resolveRels: true,
                }
              ));
              expect(ress.length).toBe(1);
              const result: ResolveRelsResult<Veritum> = ress[0];
              expect(result.main.equals(vA)).toBe(true);

              // verify REPLY_TO rel to Veritum B resolved
              const replyPromise: Promise<Veritable> = result[RelationshipType.REPLY_TO][0];
              expect(replyPromise).toBeInstanceOf(Promise);
              const reply: Veritable = await replyPromise;
              expect(reply.equals(vB)).toBe(true);

              // verify MYPOST rel to Veritum B resolved
              const postBPromise: Promise<Veritable> = result[RelationshipType.MYPOST][0];
              expect(postBPromise).toBeInstanceOf(Promise);
              const postB: Veritable = await postBPromise;
              expect(postB.equals(vB)).toBe(true);

              // verify MYPOST rel to Veritum C resolved
              const postCPromise: Promise<Veritable> = result[RelationshipType.MYPOST][1];
              expect(postCPromise).toBeInstanceOf(Promise);
              const postC: Veritable = await postCPromise;
              expect(postC.equals(vC)).toBe(true);
            });
          });  // using option resolveRels=true (single layer)

          describe("using option resolveRels='veritum' (recursive)", () => {
            it('retrieves a Notification and its recursive relationships, limited to REPLY_TO rels', async() => {
              // fetch notification
              const ress: ResolveRelsRecursiveResult<Veritum>[] = await ArrayFromAsync(
                retriever.getNotifications(recipientKey, {
                  metadata: true,
                  resolveRels: 'recursive',
                  relTypes: [RelationshipType.REPLY_TO],
                }
              ));
              expect(ress.length).toBe(1);
              const result: ResolveRelsRecursiveResult<Veritum> = ress[0];
              expect(result.main.equals(vA)).toBe(true);

              // verify REPLY_TO rel to Veritum B resolved
              const replyPromise: Promise<ResolveRelsRecursiveResult> = result[RelationshipType.REPLY_TO][0];
              expect(replyPromise).toBeInstanceOf(Promise);
              const reply: ResolveRelsRecursiveResult = await replyPromise;
              expect(reply.main.equals(vB)).toBe(true);

              // verify recursive REPLY_TO rel from Veritum B to Veritum C resolved
              const subreplyPromise: Promise<ResolveRelsRecursiveResult> = reply[RelationshipType.REPLY_TO][0];
              expect(subreplyPromise).toBeInstanceOf(Promise);
              const subreply: ResolveRelsRecursiveResult = await subreplyPromise;
              expect(subreply.main.equals(vC)).toBe(true);

              // verify direct MYPOST rel not resolved, as we opted out
              expect(result[RelationshipType.MYPOST]).toBeUndefined();

              // verify indirect MYPOST rel not resolved, as we opted out
              expect(reply[RelationshipType.MYPOST]).toBeUndefined();
            });
          });  // using option resolveRels='veritum' (recursive)
        });  // using option resolveRels
      });  // notifications already in store

      describe('notifications retrieved over the wire', () => {
        it('retrieves a a single Cube notification PIC arriving over the wire', async () => {
          // Sculpt a single-Cube MUC notification.
          // Note we don't add it to the store just yet, meaning it's not
          // locally available and has to be requested from the network.
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x46) as NotificationKey;
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

        it('retrieves a a single Cube notification MUC arriving over the wire', async () => {
          // Sculpt a single-Cube MUC notification.
          // Note we don't add it to the store just yet, meaning it's not
          // locally available and has to be requested from the network.
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x47) as NotificationKey;
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


        it('retrieves a two-Cube frozen Notification arriving over the wire in order', async () => {
          // Sculpt a two-Cube notification.
          // Note we don't add it to the store just yet, meaning they're not
          // locally available and have to be requested from the network.
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x48) as NotificationKey;
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
          expect(twoCubeChunks).toHaveLength(2);
          const twoCubeChunk1Bin: Buffer = twoCubeChunks[0].getBinaryDataIfAvailable();
          const twoCubeChunk2Bin: Buffer = twoCubeChunks[1].getBinaryDataIfAvailable();

          // Run test --
          // note we don't await the result just yet
          const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
            retriever.getNotifications(recipientKey));

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 50));

          // have the first Cube of the two-Cube notification "arrive over the wire"
          scheduler.handleCubesDelivered([twoCubeChunk1Bin], peer);

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 50));

          // have the second Cube of the two-Cube notification "arrive over the wire"
          scheduler.handleCubesDelivered([twoCubeChunk2Bin], peer);

          // All chunks have "arrived", so the retrieval promise should resolve
          const res: Veritable[] = await retrievalPromise;

          // Verify result
          expect(res.length).toBe(1);
          expect(res[0] instanceof Veritum).toBe(true);
          expect(res[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(tooLong);
          expect(res[0].getKeyIfAvailable().equals(twoCube.getKeyIfAvailable())).toBe(true);
        });


        // Note! Out of order arrival is really not expected to happen as the
        // requester only learns the second chunk's key upon receiving the first.
        // Also note that the only way we can test out-of-order arrival is by
        // sneaking in the second chunk directly through CubeStore, as a light
        // node's RequestScheduler would otherwise deny the chunk as it has not
        // (yet) been requested.
        it('retrieves a two-Cube frozen Notification sneaking in out of order through CubeStore', async () => {
          // Sculpt a two-Cube notification.
          // Note we don't add it to the store just yet, meaning they're not
          // locally available and have to be requested from the network.
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x49) as NotificationKey;
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
          expect(twoCubeChunks).toHaveLength(2);

          // Run test --
          // note we don't await the result just yet
          const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
            retriever.getNotifications(recipientKey));

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 50));

          // have the second Cube of the two-Cube notification sneak in
          cubeStore.addCube(twoCubeChunks[1]);

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 50));

          // have the first Cube of the two-Cube notification "arrive over the wire"
          cubeStore.addCube(twoCubeChunks[0]);

          // All chunks have "arrived", so the retrieval promise should resolve
          const res: Veritable[] = await retrievalPromise;

          // Verify result
          expect(res.length).toBe(1);
          expect(res[0] instanceof Veritum).toBe(true);
          expect(res[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(tooLong);
          expect(res[0].getKeyIfAvailable().equals(twoCube.getKeyIfAvailable())).toBe(true);
        });

        it('retrieves two single-Cube notifications, arriving together after the request', async () => {
          // Sculpt two single-Chunk notifications
          // Note we don't add those to the store just yet, meaning they're not
          // locally available and have to be requested from the network.
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x50) as NotificationKey;

          const firstLatin = "Magni momenti nuntiatio";
          const first: Veritum = new Veritum({
            cubeType: CubeType.PIC_NOTIFY,
            fields: [
              VerityField.Payload(firstLatin),
              VerityField.Notify(recipientKey),
              VerityField.Date(148302000),  // fixed date, thus fixed key for ease of debugging
            ],
            requiredDifficulty: 0,
          });
          await first.compile();
          const firstChunk: cciCube = Array.from(first.chunks)[0];
          const firstBin: Buffer = firstChunk.getBinaryDataIfAvailable();
          expect(firstBin.length).toBe(NetConstants.CUBE_SIZE);

          const secondLatin = "Haud minus magni momenti nuntiatio";
          const second: Veritum = new Veritum({
            cubeType: CubeType.PIC_NOTIFY,
            fields: [
              VerityField.Payload(secondLatin),
              VerityField.Notify(recipientKey),
              VerityField.Date(148302000),  // fixed date, thus fixed key for ease of debugging
            ],
            requiredDifficulty: 0,
          });
          await second.compile();
          const secondChunk: cciCube = Array.from(second.chunks)[0];
          const secondBin: Buffer = secondChunk.getBinaryDataIfAvailable();
          expect(secondBin.length).toBe(NetConstants.CUBE_SIZE);


          // Run test --
          // note we don't await the result just yet
          const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
            retriever.getNotifications(recipientKey));

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 100));

          // have both notification "arrive over the wire" at once
          scheduler.handleCubesDelivered([firstBin, secondBin], peer);

          // All chunks have "arrived", so the retrieval promise should resolve
          const res: Veritable[] = await retrievalPromise;

          // Verify result
          expect(res.length).toBe(2);
          expect(res[0] instanceof Veritum).toBe(true);
          expect(res[1] instanceof Veritum).toBe(true);
          expect(res[0].getFirstField(FieldType.PAYLOAD).valueString).toEqual(firstLatin);
          expect(res[1].getFirstField(FieldType.PAYLOAD).valueString).toEqual(secondLatin);
          expect(res[0].getKeyIfAvailable().equals(first.getKeyIfAvailable())).toBe(true);
          expect(res[1].getKeyIfAvailable().equals(second.getKeyIfAvailable())).toBe(true);
        });


        // TODO BUGBUG FIXME:
        // Only one notification retrieved.
        // - It's the long one if both get delivered.
        // - It's the short one if only the short one gets delivered.
        it.skip('retrieves a two-Cube frozen Notification as well as a single Cube notification MUC arriving intertwined', async () => {
          scheduler.options.requestTimeout = 1000;  // use longer timeout for this test
          // Sculpt a two-Cube notification and a single-Cube notification.
          // Note we don't add those to the store just yet, meaning they're not
          // locally available and have to be requested from the network.
          const recipientKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0x51) as NotificationKey;
          const twoCube: Veritum = new Veritum({
            cubeType: CubeType.FROZEN_NOTIFY,
            fields: [
              VerityField.Payload(tooLong),
              VerityField.Notify(recipientKey),
              VerityField.Date(148302000),  // fixed date, thus fixed key for ease of debugging
            ],
            requiredDifficulty: 0,
          });
          await twoCube.compile();
          const twoCubeChunks = Array.from(twoCube.chunks);
          expect(twoCubeChunks).toHaveLength(2);
          const twoCubeChunk1Bin: Buffer = twoCubeChunks[0].getBinaryDataIfAvailable();
          const twoCubeChunk2Bin: Buffer = twoCubeChunks[1].getBinaryDataIfAvailable();
          expect(twoCubeChunk1Bin.length).toBe(NetConstants.CUBE_SIZE);
          expect(twoCubeChunk2Bin.length).toBe(NetConstants.CUBE_SIZE);

          const short = "Nuntius brevis succinctus nec plures cubos requirens";
          const keyPair = sodium.crypto_sign_keypair();
          const singleCube: Veritum = new Veritum({
            cubeType: CubeType.MUC_NOTIFY,
            fields: [
              VerityField.Payload(short),
              VerityField.Notify(recipientKey),
              VerityField.Date(148302000),  // fixed date, thus fixed key for ease of debugging
            ],
            publicKey: Buffer.from(keyPair.publicKey),
            privateKey: Buffer.from(keyPair.privateKey),
            requiredDifficulty: 0,
          });
          await singleCube.compile();
          const singleCubeBin: Buffer =
            Array.from(singleCube.chunks)[0].getBinaryDataIfAvailable();
          expect(singleCubeBin.length).toBe(NetConstants.CUBE_SIZE);

          // Run test --
          // note we don't await the result just yet
          const retrievalPromise: Promise<Veritable[]> = ArrayFromAsync(
            retriever.getNotifications(recipientKey));

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 100));

          // have the first Cube of the two-Cube notification "arrive over the wire"
          await scheduler.handleCubesDelivered([twoCubeChunk1Bin], peer);

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 100));

          // have the single Cube notification "arrive over the wire"
          await scheduler.handleCubesDelivered([singleCubeBin], peer);

          // wait a moment to simulate network latency
          await new Promise(resolve => setTimeout(resolve, 100));

          // have the second Cube of the two-Cube notification "arrive over the wire"
          // (testing out-of-order arrival)
          await scheduler.handleCubesDelivered([twoCubeChunk2Bin], peer);

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
        });

        it.todo('retrieves a three-Cube frozen notification of which the root Cube was already in store but the remaining two chunks had to be retrieved over the wire', async () => {
        });

        it.todo('returns undefined trying to retrieve a two-chunk notification over the wire of which the last chunk is not retrievable');

        it.todo('tests over the concurrency limit (i.e. more than 10 verita by default)')
      });  // notifications retrieved over the wire
    });  // retrieval as Veritum

    describe('retrieval as Cube', () => {
      describe('notifications already in store', () => {
        it('retrieves a single-Cube notification', async () => {
          const recipientKey: NotificationKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0xA1) as NotificationKey;
          const notification = cciCube.Create({
            cubeType: CubeType.PIC_NOTIFY,
            fields: [
              VerityField.Payload("Nuntius brevis succinctus nec plures cubos requirens"),
              VerityField.Date(148302000),  // fixed date, thus fixed key for ease of debugging
              VerityField.Notify(recipientKey),
            ],
            requiredDifficulty: 0,
          });
          await cubeStore.addCube(notification);

          const gen = retriever.getNotifications(recipientKey, { format: RetrievalFormat.Cube });
          const res: Veritable[] = await ArrayFromAsync(gen);
          expect(res.length).toBe(1);
          expect(res[0] instanceof cciCube).toBe(true);
          expect(res[0].equals(notification)).toBe(true);
        });

        it.todo('retrieves the first Chunk of a two-Cube notification Veritum');
      });  // notifications already in store

      describe.todo('notifications retrieved over the wire');
    });
  });  // getNotifications()

  describe('subscribeNotifications()', () => {
    describe('retrieval as Veritum', () => {
      it('can subscribe to notifications in Veritum format', async () => {
        const recipientKey: NotificationKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0xA2) as NotificationKey;

        // Create a test notification
        const notification: Veritum = new Veritum({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            VerityField.Payload("Subscription test notification"),
            VerityField.Date(),
            VerityField.Notify(recipientKey),
          ],
          requiredDifficulty: 0,
        });
        await notification.compile();

        // Start subscription
        const subscriptionGen = retriever.subscribeNotifications(recipientKey);

        // Simulate adding the notification after subscription starts
        setTimeout(async () => {
          await cubeStore.addCube(notification.chunks[0]);
        }, 50);

        // Get the first notification from subscription
        const iterator = subscriptionGen[Symbol.asyncIterator]();
        const result = await Promise.race([
          iterator.next(),
          new Promise(resolve => setTimeout(() => resolve({ value: undefined, done: true }), 1000))
        ]);

        expect(result.done).toBe(false);
        expect(result.value).toBeDefined();
        expect(result.value instanceof Veritum).toBe(true);

        // Clean up
        subscriptionGen.cancel();
      });
    });

    describe('retrieval as Cube', () => {
      it('can subscribe to notifications in Cube format', async () => {
        const recipientKey: NotificationKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 0xA3) as NotificationKey;

        // Create a test notification
        const notification = cciCube.Create({
          cubeType: CubeType.PIC_NOTIFY,
          fields: [
            VerityField.Payload("Subscription test notification as cube"),
            VerityField.Date(),
            VerityField.Notify(recipientKey),
          ],
          requiredDifficulty: 0,
        });

        // Start subscription with Cube format
        const subscriptionGen = retriever.subscribeNotifications(recipientKey, { format: RetrievalFormat.Cube });

        // Simulate adding the notification after subscription starts
        setTimeout(async () => {
          await cubeStore.addCube(notification);
        }, 50);

        // Get the first notification from subscription
        const iterator = subscriptionGen[Symbol.asyncIterator]();
        const result = await Promise.race([
          iterator.next(),
          new Promise(resolve => setTimeout(() => resolve({ value: undefined, done: true }), 1000))
        ]);

        expect(result.done).toBe(false);
        expect(result.value).toBeDefined();
        expect(result.value instanceof cciCube).toBe(true);

        // Clean up
        subscriptionGen.cancel();
      });
    });
  });  // subscribeNotifications()
});
