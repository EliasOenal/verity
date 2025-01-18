import type { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { cciCube } from "../../../src/cci/cube/cciCube";
import { MediaTypes, cciAdditionalFieldType, cciFieldLength, cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";
import { Continuation } from "../../../src/cci/veritum/continuation";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { CubeKey, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeStoreOptions, CubeStore } from "../../../src/core/cube/cubeStore";
import { CubeRetriever } from "../../../src/core/networking/cubeRetrieval/cubeRetriever";
import { RequestScheduler } from "../../../src/core/networking/cubeRetrieval/requestScheduler";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/networkManagerDummy";
import { PeerDB } from "../../../src/core/peering/peerDB";

import { evenLonger, farTooLong, tooLong } from "../testcci.definitions";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Continuation', () => {
  describe('manual splitting tests', () => {
    it('splits a single oversized payload field into two Cubes', async () => {
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(tooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // just assert our macro Cube looks like what we expect
      expect(macroCube.fieldCount).toEqual(4);
      expect(macroCube.fields.all[0].type).toEqual(cciFieldType.TYPE);
      expect(macroCube.fields.all[1].type).toEqual(cciFieldType.PAYLOAD);
      expect(macroCube.fields.all[2].type).toEqual(cciFieldType.DATE);
      expect(macroCube.fields.all[3].type).toEqual(cciFieldType.NONCE);

      // run the test
      const splitCubes: cciCube[] =
        await Continuation.Split(macroCube, { requiredDifficulty: 0 });

      expect(splitCubes.length).toEqual(2);

      // expect first Cube to be filled to the brim
      expect(splitCubes[0].getFieldLength()).toEqual(1024);
      expect(splitCubes[0].bytesRemaining()).toBe(0);

      // expect the first chunk to contain all fields
      expect(splitCubes[0].fields.all[0].type).toEqual(cciFieldType.TYPE);
      expect(splitCubes[0].fields.all[1].type).toEqual(cciFieldType.RELATES_TO);
      expect(splitCubes[0].fields.all[2].type).toEqual(cciFieldType.PAYLOAD);
      expect(splitCubes[0].fields.all[3].type).toEqual(cciFieldType.DATE);
      expect(splitCubes[0].fields.all[4].type).toEqual(cciFieldType.NONCE);
      expect(splitCubes[0].fieldCount).toEqual(5);

      // expect the payload to have been split at the optimal point
      const expectedFirstChunkPayloadLength = 1024  // Cube size
        - 1  // Type
        - 2  // two byte Payload TLV header (type and length)
        - 34 // RELATES_TO/CONTINUED_IN (1 byte type and 33 byte value)
        - 5  // Date
        - 4  // Nonce
      expect(splitCubes[0].fields.all[2].value.length).toEqual(expectedFirstChunkPayloadLength);

      // expect the first chunk to reference the second chunk
      const rel = cciRelationship.fromField(splitCubes[0].fields.all[1]);
      expect(rel.type).toBe(cciRelationshipType.CONTINUED_IN);
      expect(rel.remoteKey).toEqual(await splitCubes[1].getKey());

      // Expect the second chunk to contain all positional fields a Cube needs,
      // plus the second part of the payload. Chunks are automatically padded up,
      // so expect a CCI_END marker and some padding as well.
      expect(splitCubes[1].fields.all[0].type).toEqual(cciFieldType.TYPE);
      expect(splitCubes[1].fields.all[1].type).toEqual(cciFieldType.PAYLOAD);
      expect(splitCubes[1].fields.all[2].type).toEqual(cciFieldType.CCI_END);
      expect(splitCubes[1].fields.all[3].type).toEqual(cciFieldType.PADDING);
      expect(splitCubes[1].fields.all[4].type).toEqual(cciFieldType.DATE);
      expect(splitCubes[1].fields.all[5].type).toEqual(cciFieldType.NONCE);

      // Expect the second chunk to contain exactly the amount of payload
      // that didn't fit the first one.
      expect(splitCubes[1].fields.all[1].value.length).toEqual(
        payloadMacrofield.value.length - expectedFirstChunkPayloadLength);
    });


    it('respects the maximum chunk size', async () => {
      const veritum = new Veritum({
        cubeType: CubeType.FROZEN,
        fields: cciField.Payload(tooLong),
        requiredDifficulty: 0,
      });

      // run the test
      const chunks: cciCube[] =
        await Continuation.Split(veritum, {
          maxChunkSize: () => 500,
          requiredDifficulty: 0,
        });
      expect(chunks.length).toEqual(3);

      // Cube are automatically compiled which pads them back up --
      // so to check for correct chunk size, we first need to remove the
      // PADDING and CCI_END markers again
      chunks[0].removeField(chunks[0].getFirstField(cciFieldType.PADDING));
      chunks[0].removeField(chunks[0].getFirstField(cciFieldType.CCI_END));
      chunks[1].removeField(chunks[1].getFirstField(cciFieldType.PADDING));
      chunks[1].removeField(chunks[1].getFirstField(cciFieldType.CCI_END));

      // Expect the first two chunks to be filled exactly up to our
      // specified limit
      expect(chunks[0].getFieldLength()).toEqual(500);
      expect(chunks[0].bytesRemaining()).toEqual(524);
      expect(chunks[1].getFieldLength()).toEqual(500);
      expect(chunks[1].bytesRemaining()).toEqual(524);
    });

    it('calls the chunk transformation callback', async () => {
      // prepare veritum
      const veritum = new Veritum({
        cubeType: CubeType.FROZEN,
        fields: cciField.Payload(tooLong),
        requiredDifficulty: 0,
      });

      // prepare a chunk transformation callback
      const missingLatinProficiency = "I can't understand you, you have no subtitles!";
      const transformer: (chunk: cciCube) => void = (chunk: cciCube) => {
        chunk.insertFieldBeforeBackPositionals(cciField.Description(
          missingLatinProficiency
        ));
      }

      // run Split()
      const chunks: cciCube[] =
        await Continuation.Split(veritum, {
          maxChunkSize: () => 500,
          requiredDifficulty: 0,
          chunkTransformationCallback: transformer,
        });
      expect(chunks.length).toEqual(3);

      // Expect each chunk to have been transformed by our callback
      for (const chunk of chunks) {
        const addedField = chunk.getFirstField(cciFieldType.DESCRIPTION);
        expect(addedField?.valueString).toEqual(missingLatinProficiency);
      }
    })
  });  // manual splitting

  describe('round-trip tests', () => {
    it('splits and restores a single overly large payload field requiring two chunks', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(tooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // run the test: split, then recombine
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
      expect(splitCubes.length).toEqual(2);
      const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      // TODO: get rid of manipulateFields() call and direct Array method calls
      expect(recombined.manipulateFields().get(cciFieldType.PAYLOAD).length).toEqual(1);
      const restoredPayload = recombined.getFirstField(cciFieldType.PAYLOAD);
      expect(restoredPayload.valueString).toEqual(tooLong);
    });

    it('splits and restores a single extremely large payload field requiring more than chunks', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(farTooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // run the test: split, then recombine
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
      expect(splitCubes.length).toBeGreaterThan(11);
      const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert all CONTINUED_IN relationships are present and in correct order
      let refs: cciRelationship[] = [];
      for (const cube of splitCubes) {
        refs = [...refs, ...cube.fields.getRelationships(cciRelationshipType.CONTINUED_IN)];
      }
      expect(refs.length).toBe(splitCubes.length - 1);
      for (let i=0; i < refs.length; i++) {
        expect(refs[i].type).toEqual(cciRelationshipType.CONTINUED_IN);
        expect(refs[i].remoteKey).toEqual(await splitCubes[i+1].getKey());
      }

      // assert that payload was correctly restored
      // TODO: get rid of manipulateFields() call and direct Array method calls
      expect(recombined.manipulateFields().get(cciFieldType.PAYLOAD).length).toEqual(1);
      const restoredPayload = recombined.getFirstField(cciFieldType.PAYLOAD);
      expect(restoredPayload.valueString).toEqual(farTooLong);
    });

    it('splits and restores a long array of small fixed-length fields', async () => {
      const numFields = 500;
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const manyFields: cciField[] = [];
      // add numFields media type fields, with content alternating between two options
      for (let i=0; i < numFields; i++) {
        if (i%2 == 0) manyFields.push(cciField.MediaType(MediaTypes.TEXT));
        else manyFields.push(cciField.MediaType(MediaTypes.JPEG));
      }
      for (const field of manyFields) {
        macroCube.insertFieldBeforeBackPositionals(field);
      }

      // split the Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});

      // run some tests on the chunks: ensure that the total number of target
      // fields in the split is correct
      let targetFieldsInSplit = 0;
      for (const cube of splitCubes) {
        targetFieldsInSplit += cube.fields.get(cciFieldType.MEDIA_TYPE).length;
      }
      expect(targetFieldsInSplit).toEqual(numFields);


      // recombine the chunks
      const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      // TODO: get rid of manipulateFields() call and direct Array method calls
      const manyRestoredFields = recombined.manipulateFields().get(cciFieldType.MEDIA_TYPE);
      expect(manyRestoredFields.length).toEqual(numFields);
      for (let i=0; i < numFields; i++) {
        expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
      }
    });

    it('splits and restores a long array of small variable-length fields', async () => {
      const numFields = 500;
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const manyFields: cciField[] = [];
      // add 3000 DESCRIPTION fields, using a running number as content
      for (let i=0; i < numFields; i++) {
        manyFields.push(cciField.Description(i.toString()));
      }
      for (const field of manyFields) {
        macroCube.insertFieldBeforeBackPositionals(field);
      }

      // split the Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});

      // run some tests on the chunks: ensure that the total number of target
      // fields in the split is correct
      let targetFieldsInSplit = 0;
      for (const cube of splitCubes) {
        targetFieldsInSplit += cube.fields.get(cciFieldType.DESCRIPTION).length;
      }
      expect(targetFieldsInSplit).toEqual(numFields);

      // recombine the chunks
      const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      // TODO: get rid of manipulateFields() call and direct Array method calls
      const manyRestoredFields = recombined.manipulateFields().get(cciFieldType.DESCRIPTION);
      expect(manyRestoredFields.length).toEqual(numFields);
      for (let i=0; i < numFields; i++) {
        expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
      }
    });

    it('splits and restores a long array of different fields of different lengths', async () => {
      const numFields = 100;
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const manyFields: cciField[] = [];
      // add many fields
      for (let i=0; i < numFields; i++) {
        if (i%4 === 0) {
          // make every four fields a fixed length one
          manyFields.push(cciField.MediaType(MediaTypes.TEXT));
        } else if (i%4 === 1 || i%4 === 2) {
          // make half of the fields variable length and long, and have them
          // be adjacent to each other
          manyFields.push(cciField.Payload(tooLong));
        } else {
          // make one in every four fields variable length and short
          manyFields.push(cciField.Description("Hic cubus stultus est"));
        }
      }
      for (const field of manyFields) {
        macroCube.insertFieldBeforeBackPositionals(field);
      }

      // split the Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});

      // run some tests on the chunks: ensure that the total number of target
      // fields in the split is correct
      let targetFieldsInSplit = 0;
      for (const cube of splitCubes) {
        targetFieldsInSplit += cube.fields.get([
          cciFieldType.MEDIA_TYPE,
          cciFieldType.PAYLOAD,
          cciFieldType.DESCRIPTION,
        ]).length;
      }
      expect(targetFieldsInSplit).toBeGreaterThan(numFields);  // account for splits

      // recombine the chunks
      const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      const manyRestoredFields = Array.from(recombined.getFields([
        cciFieldType.MEDIA_TYPE,
        cciFieldType.PAYLOAD,
        cciFieldType.DESCRIPTION,
      ]));
      expect(manyRestoredFields.length).toEqual(numFields);
      for (let i=0; i < numFields; i++) {
        expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
      }
    });

    it('produces a valid result even if Cube did not need splitting in the first place', async () => {
      // prepare a "macro" Cube that's not actually macro
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      const manyFields: cciField[] = [
        cciField.ContentName("Cubus Stultus"),
        cciField.Description("Hic cubus stultus est"),
        new cciField(cciFieldType.AVATAR, Buffer.alloc(0)),
        cciField.Payload("Hic cubus adhuc stultus est"),
        cciField.MediaType(MediaTypes.TEXT),
        cciField.Username("Cubus Stultus"),
      ];
      for (const field of manyFields) {
        macroCube.insertFieldBeforeBackPositionals(field);
      }

      // split the Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
      expect(splitCubes.length).toBe(1);

      // run some tests on the chunks: ensure that the total number of target
      // fields in the split is correct
      let targetFieldsInSplit = 0;
      for (const cube of splitCubes) {
        targetFieldsInSplit += cube.fields.get([
          cciFieldType.CONTENTNAME,
          cciFieldType.DESCRIPTION,
          cciFieldType.AVATAR,
          cciFieldType.PAYLOAD,
          cciFieldType.MEDIA_TYPE,
          cciFieldType.USERNAME,
        ]).length;
      }
      expect(targetFieldsInSplit).toEqual(manyFields.length);  // account for splits

      // recombine the chunks
      const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      const manyRestoredFields = Array.from(recombined.getFields([
        cciFieldType.CONTENTNAME,
        cciFieldType.DESCRIPTION,
        cciFieldType.AVATAR,
        cciFieldType.PAYLOAD,
        cciFieldType.MEDIA_TYPE,
        cciFieldType.USERNAME,
      ]));
      expect(manyRestoredFields.length).toEqual(manyFields.length);
      for (let i=0; i < manyFields.length; i++) {
        expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
      }
    });

    it('preserves all CCI relationship except CONTINUED_IN', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create({
        cubeType: CubeType.FROZEN,
        requiredDifficulty: 0,
      });
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MENTION, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.insertFieldBeforeBackPositionals(cciField.Payload(tooLong));
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MENTION, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));

      // run the test: split, then recombine
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
      expect(splitCubes.length).toEqual(2);
      const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      // TODO: get rid of manipulateFields() call and direct Array method calls
      expect(recombined.manipulateFields().get(cciFieldType.PAYLOAD).length).toEqual(1);
      const restoredPayload = recombined.getFirstField(cciFieldType.PAYLOAD);
      expect(restoredPayload.valueString).toEqual(tooLong);

      // assert that the number of RELATES_TO fields is the number of
      // non-CONTINUED_IN relationships
      // TODO: get rid of manipulateFields() call and direct Array method calls
      const restoredRelatesTo = recombined.manipulateFields().get(cciFieldType.RELATES_TO);
      expect(restoredRelatesTo.length).toEqual(4);
      expect(cciRelationship.fromField(restoredRelatesTo[0]).type).toEqual(cciRelationshipType.MYPOST);
      expect(cciRelationship.fromField(restoredRelatesTo[1]).type).toEqual(cciRelationshipType.MENTION);
      expect(cciRelationship.fromField(restoredRelatesTo[2]).type).toEqual(cciRelationshipType.MYPOST);
      expect(cciRelationship.fromField(restoredRelatesTo[3]).type).toEqual(cciRelationshipType.MENTION);
    });

    for (let fuzzingRepeat=0; fuzzingRepeat<10; fuzzingRepeat++) {
      it('splits and restores random oversized Cubes (fuzzing test)', async() => {
        const eligibleFieldTypes: cciAdditionalFieldType[] = [
          cciFieldType.PAYLOAD,
          cciFieldType.CONTENTNAME,
          cciFieldType.DESCRIPTION,
          cciFieldType.RELATES_TO,
          cciFieldType.USERNAME,
          cciFieldType.MEDIA_TYPE,
          cciFieldType.AVATAR,
        ];
        const numFields = Math.floor(Math.random() * 100);

        // prepare macro Cube
        const compareFields: cciField[] = [];
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        for (let i=0; i < numFields; i++) {
          const chosenFieldType: cciAdditionalFieldType = eligibleFieldTypes[Math.floor(Math.random() * eligibleFieldTypes.length)];
          const length: number = cciFieldLength[chosenFieldType] ?? Math.floor(Math.random() * 3000);
          let val: Buffer;
          if (chosenFieldType === cciFieldType.RELATES_TO) {
            val = cciField.RelatesTo(new cciRelationship(cciRelationshipType.REPLY_TO, Buffer.alloc(NetConstants.CUBE_KEY_SIZE))).value;
          } else {
            val = Buffer.alloc(length);
            // fill val with random bytes
            for (let j = 0; j < length; j++) val[j] = Math.floor(Math.random() * 256);
          }
          const field = new cciField(chosenFieldType, val);
          macroCube.insertFieldBeforeBackPositionals(field);
          compareFields.push(field);
        }

        // split and recombinethe Cube
        const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert that payload was correctly restored
        const restoredFields = recombined.manipulateFields().all;
        expect(restoredFields.length).toEqual(numFields);
        // assert that all fields have been restored correctly
        for (let i = 0; i < numFields; i++) {
          const field = restoredFields[i];
          expect(field.type).toEqual(compareFields[i].type);
          expect(field.value).toEqual(compareFields[i].value);
        }
      });
    }
  });
});



// Putting CubeRetriever's Continuation-related here as we may split the
// feature out of CubeRetriever in the future.

describe('CubeRetriever Continuation-related features', () => {
  const cubeStoreOptions: CubeStoreOptions = {
    inMemory: true,
    enableCubeRetentionPolicy: false,
    requiredDifficulty: 0,
  };
  let cubeStore: CubeStore;
  let networkManager: NetworkManagerIf;
  let scheduler: RequestScheduler;
  let retriever: CubeRetriever;

  beforeEach(async () => {
    cubeStore = new CubeStore(cubeStoreOptions);
    await cubeStore.readyPromise;
    networkManager = new DummyNetworkManager(cubeStore, new PeerDB());
    scheduler = new RequestScheduler(networkManager);
    retriever = new CubeRetriever(cubeStore, scheduler);
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
        splitCubes[0].getKeyIfAvailable(), undefined, {timeout: 1000000000})) {
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
