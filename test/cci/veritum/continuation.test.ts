import type { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { cciCube } from "../../../src/cci/cube/cciCube";
import { MediaTypes, FieldLength, FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";
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
      const payloadMacrofield = VerityField.Payload(tooLong);
      macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

      // just assert our macro Cube looks like what we expect
      expect(macroCube.fieldCount).toEqual(4);
      expect(macroCube.fields.all[0].type).toEqual(FieldType.TYPE);
      expect(macroCube.fields.all[1].type).toEqual(FieldType.PAYLOAD);
      expect(macroCube.fields.all[2].type).toEqual(FieldType.DATE);
      expect(macroCube.fields.all[3].type).toEqual(FieldType.NONCE);

      // run the test
      const splitCubes: cciCube[] =
        await Continuation.Split(macroCube, { requiredDifficulty: 0 });

      expect(splitCubes.length).toEqual(2);

      // expect first Cube to be filled to the brim
      expect(splitCubes[0].getFieldLength()).toEqual(1024);
      expect(splitCubes[0].bytesRemaining()).toBe(0);

      // expect the first chunk to contain all fields
      expect(splitCubes[0].fields.all[0].type).toEqual(FieldType.TYPE);
      expect(splitCubes[0].fields.all[1].type).toEqual(FieldType.RELATES_TO);
      expect(splitCubes[0].fields.all[2].type).toEqual(FieldType.PAYLOAD);
      expect(splitCubes[0].fields.all[3].type).toEqual(FieldType.DATE);
      expect(splitCubes[0].fields.all[4].type).toEqual(FieldType.NONCE);
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
      const rel = Relationship.fromField(splitCubes[0].fields.all[1]);
      expect(rel.type).toBe(RelationshipType.CONTINUED_IN);
      expect(rel.remoteKey).toEqual(await splitCubes[1].getKey());

      // Expect the second chunk to contain all positional fields a Cube needs,
      // plus the second part of the payload. Chunks are automatically padded up,
      // so expect a CCI_END marker and some padding as well.
      expect(splitCubes[1].fields.all[0].type).toEqual(FieldType.TYPE);
      expect(splitCubes[1].fields.all[1].type).toEqual(FieldType.PAYLOAD);
      expect(splitCubes[1].fields.all[2].type).toEqual(FieldType.CCI_END);
      expect(splitCubes[1].fields.all[3].type).toEqual(FieldType.PADDING);
      expect(splitCubes[1].fields.all[4].type).toEqual(FieldType.DATE);
      expect(splitCubes[1].fields.all[5].type).toEqual(FieldType.NONCE);

      // Expect the second chunk to contain exactly the amount of payload
      // that didn't fit the first one.
      expect(splitCubes[1].fields.all[1].value.length).toEqual(
        payloadMacrofield.value.length - expectedFirstChunkPayloadLength);
    });


    it('respects the maximum chunk size', async () => {
      const veritum = new Veritum({
        cubeType: CubeType.FROZEN,
        fields: VerityField.Payload(tooLong),
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
      chunks[0].removeField(chunks[0].getFirstField(FieldType.PADDING));
      chunks[0].removeField(chunks[0].getFirstField(FieldType.CCI_END));
      chunks[1].removeField(chunks[1].getFirstField(FieldType.PADDING));
      chunks[1].removeField(chunks[1].getFirstField(FieldType.CCI_END));

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
        fields: VerityField.Payload(tooLong),
        requiredDifficulty: 0,
      });

      // prepare a chunk transformation callback
      const missingLatinProficiency = "I can't understand you, you have no subtitles!";
      const transformer: (chunk: cciCube) => void = (chunk: cciCube) => {
        chunk.insertFieldBeforeBackPositionals(VerityField.Description(
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
        const addedField = chunk.getFirstField(FieldType.DESCRIPTION);
        expect(addedField?.valueString).toEqual(missingLatinProficiency);
      }
    })
  });  // manual splitting

  describe('round-trip tests', () => {
    describe('splitting a single large field', () => {
      it('splits and restores a single overly large payload field requiring two chunks', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(tooLong);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // run the test: split, then recombine
        const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toEqual(2);
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert that payload was correctly restored
        // TODO: get rid of manipulateFields() call and direct Array method calls
        expect(recombined.manipulateFields().get(FieldType.PAYLOAD).length).toEqual(1);
        const restoredPayload = recombined.getFirstField(FieldType.PAYLOAD);
        expect(restoredPayload.valueString).toEqual(tooLong);
      });

      it('splits and restores a single extremely large payload field requiring more than chunks', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const payloadMacrofield = VerityField.Payload(farTooLong);
        macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

        // run the test: split, then recombine
        const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toBeGreaterThan(11);
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert all CONTINUED_IN relationships are present and in correct order
        let refs: Relationship[] = [];
        for (const cube of splitCubes) {
          refs = [...refs, ...cube.fields.getRelationships(RelationshipType.CONTINUED_IN)];
        }
        expect(refs.length).toBe(splitCubes.length - 1);
        for (let i=0; i < refs.length; i++) {
          expect(refs[i].type).toEqual(RelationshipType.CONTINUED_IN);
          expect(refs[i].remoteKey).toEqual(await splitCubes[i+1].getKey());
        }

        // assert that payload was correctly restored
        // TODO: get rid of manipulateFields() call and direct Array method calls
        expect(recombined.manipulateFields().get(FieldType.PAYLOAD).length).toEqual(1);
        const restoredPayload = recombined.getFirstField(FieldType.PAYLOAD);
        expect(restoredPayload.valueString).toEqual(farTooLong);
      });
    });

    describe('splitting an array of multiple fields', () => {
      it('splits and restores a long array of small fixed-length fields', async () => {
        const numFields = 500;
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const manyFields: VerityField[] = [];
        // add numFields media type fields, with content alternating between two options
        for (let i=0; i < numFields; i++) {
          if (i%2 == 0) manyFields.push(VerityField.MediaType(MediaTypes.TEXT));
          else manyFields.push(VerityField.MediaType(MediaTypes.JPEG));
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
          targetFieldsInSplit += cube.fields.get(FieldType.MEDIA_TYPE).length;
        }
        expect(targetFieldsInSplit).toEqual(numFields);


        // recombine the chunks
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert that payload was correctly restored
        // TODO: get rid of manipulateFields() call and direct Array method calls
        const manyRestoredFields = recombined.manipulateFields().get(FieldType.MEDIA_TYPE);
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
        const manyFields: VerityField[] = [];
        // add many DESCRIPTION fields, using a running number as content
        for (let i=0; i < numFields; i++) {
          manyFields.push(VerityField.Description(i.toString()));
        }
        for (const field of manyFields) {
          macroCube.insertFieldBeforeBackPositionals(field);
        }

        // split the Cube
        const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});

        // Run some tests on the chunks: ensure that the total number of target
        // fields in the split is correct.
        // Note: In this test, the number of split fields in the chunks must be
        // equal to the number of input fields, as the test fields we created are
        // very small an thus ineligible for intra-field splitting.
        let targetFieldsInSplit = 0;
        for (const cube of splitCubes) {
          targetFieldsInSplit +=
            Array.from(cube.getFields(FieldType.DESCRIPTION)).length;
        }
        expect(targetFieldsInSplit).toEqual(numFields);

        // recombine the chunks
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert that payload was correctly restored
        const manyRestoredFields: VerityField[] =
          Array.from(recombined.getFields(FieldType.DESCRIPTION));
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
        const manyFields: VerityField[] = [];
        // add many fields
        for (let i=0; i < numFields; i++) {
          if (i%4 === 0) {
            // make every four fields a fixed length one
            manyFields.push(VerityField.MediaType(MediaTypes.TEXT));
          } else if (i%4 === 1 || i%4 === 2) {
            // make half of the fields variable length and long, and have them
            // be adjacent to each other
            manyFields.push(VerityField.Payload(tooLong));
          } else {
            // make one in every four fields variable length and short
            manyFields.push(VerityField.Description("Hic cubus stultus est"));
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
            FieldType.MEDIA_TYPE,
            FieldType.PAYLOAD,
            FieldType.DESCRIPTION,
          ]).length;
        }
        expect(targetFieldsInSplit).toBeGreaterThan(numFields);  // account for splits

        // recombine the chunks
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert that payload was correctly restored
        const manyRestoredFields = Array.from(recombined.getFields([
          FieldType.MEDIA_TYPE,
          FieldType.PAYLOAD,
          FieldType.DESCRIPTION,
        ]));
        expect(manyRestoredFields.length).toEqual(numFields);
        for (let i=0; i < numFields; i++) {
          expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
        }
      });

      it('splits and restores two chunks worth of medium sized variable-length fields', async () => {
        // Craft a Vertium that should require two Cubes
        const veritum = new Veritum();
        for (let i=0; i<10; i++) {
          const text = `Hoc est ${i}-um experimentale campus. Valde gravem informationem continet, nec amittendam nec cum aliis campis confundendam.`
          const field = VerityField.Payload(text);
          veritum.appendField(field);
        }

        // split the Cube
        const splitCubes: cciCube[] = await Continuation.Split(veritum, {requiredDifficulty: 0});
        expect(splitCubes).toHaveLength(2);

        // recombine
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert correctness
        const payloadFields: VerityField[] = Array.from(recombined.getFields(FieldType.PAYLOAD));
        expect(payloadFields).toHaveLength(10);

        for (let i=0; i<10; i++) {
          const field = payloadFields[i];
          expect(field.valueString).toEqual(`Hoc est ${i}-um experimentale campus. Valde gravem informationem continet, nec amittendam nec cum aliis campis confundendam.`);
        }
      });

      it('preserves all CCI relationship except CONTINUED_IN', async () => {
        // prepare macro Cube
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.MENTION, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
        macroCube.insertFieldBeforeBackPositionals(VerityField.Payload(tooLong));
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.MENTION, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
        macroCube.insertFieldBeforeBackPositionals(VerityField.RelatesTo(
          new Relationship(RelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));

        // run the test: split, then recombine
        const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
        expect(splitCubes.length).toEqual(2);
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert that payload was correctly restored
        // TODO: get rid of manipulateFields() call and direct Array method calls
        expect(recombined.manipulateFields().get(FieldType.PAYLOAD).length).toEqual(1);
        const restoredPayload = recombined.getFirstField(FieldType.PAYLOAD);
        expect(restoredPayload.valueString).toEqual(tooLong);

        // assert that the number of RELATES_TO fields is the number of
        // non-CONTINUED_IN relationships
        // TODO: get rid of manipulateFields() call and direct Array method calls
        const restoredRelatesTo = recombined.manipulateFields().get(FieldType.RELATES_TO);
        expect(restoredRelatesTo.length).toEqual(4);
        expect(Relationship.fromField(restoredRelatesTo[0]).type).toEqual(RelationshipType.MYPOST);
        expect(Relationship.fromField(restoredRelatesTo[1]).type).toEqual(RelationshipType.MENTION);
        expect(Relationship.fromField(restoredRelatesTo[2]).type).toEqual(RelationshipType.MYPOST);
        expect(Relationship.fromField(restoredRelatesTo[3]).type).toEqual(RelationshipType.MENTION);
      });
    });

    describe('edge cases', () => {
      it('produces a valid result even if Cube did not need splitting in the first place', async () => {
        // prepare a "macro" Cube that's not actually macro
        const macroCube = cciCube.Create({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
        });
        const manyFields: VerityField[] = [
          VerityField.ContentName("Cubus Stultus"),
          VerityField.Description("Hic cubus stultus est"),
          new VerityField(FieldType.AVATAR, Buffer.alloc(0)),
          VerityField.Payload("Hic cubus adhuc stultus est"),
          VerityField.MediaType(MediaTypes.TEXT),
          VerityField.Username("Cubus Stultus"),
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
            FieldType.CONTENTNAME,
            FieldType.DESCRIPTION,
            FieldType.AVATAR,
            FieldType.PAYLOAD,
            FieldType.MEDIA_TYPE,
            FieldType.USERNAME,
          ]).length;
        }
        expect(targetFieldsInSplit).toEqual(manyFields.length);  // account for splits

        // recombine the chunks
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // assert that payload was correctly restored
        const manyRestoredFields = Array.from(recombined.getFields([
          FieldType.CONTENTNAME,
          FieldType.DESCRIPTION,
          FieldType.AVATAR,
          FieldType.PAYLOAD,
          FieldType.MEDIA_TYPE,
          FieldType.USERNAME,
        ]));
        expect(manyRestoredFields.length).toEqual(manyFields.length);
        for (let i=0; i < manyFields.length; i++) {
          expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
        }
      });

      it('will correctly split Veritables containing multiple copies of the same variable size field object', async () => {
        const veritum = new Veritum();
        const text = "Campus importantis cuius Veritum saepius repetit"
        const field = VerityField.Payload(text);
        for (let i=0; i<30; i++) {
          veritum.insertFieldBeforeBackPositionals(field);
        }

        // verify test setup
        const preTestFields = Array.from(veritum.getFields(FieldType.PAYLOAD))
        expect(preTestFields).toHaveLength(30);
        for (const field of preTestFields) {
          expect(field.valueString).toEqual(text);
        }

        // split and recombine
        const splitCubes: cciCube[] = await Continuation.Split(veritum, {requiredDifficulty: 0});
        const recombined: Veritum = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

        // verify result
        const postTestFields = Array.from(veritum.getFields(FieldType.PAYLOAD))
        expect(postTestFields).toHaveLength(30);
        for (const field of postTestFields) {
          expect(field.valueString).toEqual(text);
        }
      });
    });

    describe('fuzzing tests', () => {
      for (let fuzzingRepeat=0; fuzzingRepeat<10; fuzzingRepeat++) {
        it('splits and restores random oversized Cubes (fuzzing test)', async() => {
          const eligibleFieldTypes: number[] = [
            FieldType.PAYLOAD,
            FieldType.CONTENTNAME,
            FieldType.DESCRIPTION,
            FieldType.RELATES_TO,
            FieldType.USERNAME,
            FieldType.MEDIA_TYPE,
            FieldType.AVATAR,
          ];
          const numFields = Math.floor(Math.random() * 100);

          // prepare macro Cube
          const compareFields: VerityField[] = [];
          const macroCube = cciCube.Create({
            cubeType: CubeType.FROZEN,
            requiredDifficulty: 0,
          });
          for (let i=0; i < numFields; i++) {
            const chosenFieldType: number = eligibleFieldTypes[Math.floor(Math.random() * eligibleFieldTypes.length)];
            const length: number = FieldLength[chosenFieldType] ?? Math.floor(Math.random() * 3000);
            let val: Buffer;
            if (chosenFieldType === FieldType.RELATES_TO) {
              val = VerityField.RelatesTo(new Relationship(RelationshipType.REPLY_TO, Buffer.alloc(NetConstants.CUBE_KEY_SIZE))).value;
            } else {
              val = Buffer.alloc(length);
              // fill val with random bytes
              for (let j = 0; j < length; j++) val[j] = Math.floor(Math.random() * 256);
            }
            const field = new VerityField(chosenFieldType, val);
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
});
