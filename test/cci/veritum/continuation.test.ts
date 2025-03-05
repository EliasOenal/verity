import type { NetworkManagerIf } from "../../../src/core/networking/networkManagerIf";
import { cciCube } from "../../../src/cci/cube/cciCube";
import { MediaTypes, FieldLength, FieldType } from "../../../src/cci/cube/cciCube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";
import { Split, Recombine } from "../../../src/cci/veritum/continuation";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { CubeKey, CubeType, HasNotify, HasSignature } from "../../../src/core/cube/cube.definitions";
import { CubeStoreOptions, CubeStore } from "../../../src/core/cube/cubeStore";
import { CubeRetriever } from "../../../src/core/networking/cubeRetrieval/cubeRetriever";
import { RequestScheduler } from "../../../src/core/networking/cubeRetrieval/requestScheduler";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { DummyNetworkManager } from "../../../src/core/networking/testingDummies/networkManagerDummy";
import { PeerDB } from "../../../src/core/peering/peerDB";

import { evenLonger, farTooLong, tooLong } from "../testcci.definitions";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { enumNums } from "../../../src/core/helpers/misc";

import sodium from 'libsodium-wrappers-sumo'
import { FieldEqualityMetric } from "../../../src/core/fields/baseFields";

describe('Continuation', () => {
  let privateKey: Buffer, publicKey: Buffer;
  const notificationKey: Buffer = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 333);
  const date = 148302000;  // viva Malta repubblika!

  beforeAll(async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_sign_keypair();
    publicKey = Buffer.from(keyPair.publicKey);
    privateKey = Buffer.from(keyPair.privateKey);
  });

  describe('manual Split() tests', () => {
    describe('splitting a single oversized payload field into two Cubes', async () => {
      let veritum: Veritum;
      let splitCubes: cciCube[];
      let payloadMacrofield: VerityField = VerityField.Payload(tooLong);

      const expectedFirstChunkPayloadLength = 1024  // Cube size
      - 1  // Type
      - 2  // two byte Payload TLV header (type and length)
      - 34 // RELATES_TO/CONTINUED_IN (1 byte type and 33 byte value)
      - 5  // Date
      - 4  // Nonce

      beforeAll(async () => {
        veritum = new Veritum({
          cubeType: CubeType.FROZEN,
          requiredDifficulty: 0,
          fields: [
            VerityField.Date(date),
            payloadMacrofield,
          ]
        });

        // just assert our macro Cube looks like what we expect
        const fields = Array.from(veritum.getFields());
        expect(veritum.fieldCount).toEqual(2);
        expect(fields[0].type).toEqual(FieldType.DATE);
        expect(fields[1].type).toEqual(FieldType.PAYLOAD);

        // run the test
        splitCubes = await Split(veritum, { requiredDifficulty: 0 });
      });

      it('splits the input into two chunk Cubes', () => {
        expect(splitCubes.length).toEqual(2);
      });

      it('fills the first Cube to the brim', () => {
        expect(splitCubes[0].getFieldLength()).toEqual(1024);
        expect(splitCubes[0].bytesRemaining()).toBe(0);
      });

      it('expect the first chunk to contain all fields', () => {
        expect(splitCubes[0].fields.all[0].type).toEqual(FieldType.TYPE);
        expect(splitCubes[0].fields.all[1].type).toEqual(FieldType.RELATES_TO);
        expect(splitCubes[0].fields.all[2].type).toEqual(FieldType.PAYLOAD);
        expect(splitCubes[0].fields.all[3].type).toEqual(FieldType.DATE);
        expect(splitCubes[0].fields.all[4].type).toEqual(FieldType.NONCE);
        expect(splitCubes[0].fieldCount).toEqual(5);
      });

      it('expect the payload to have been split at the optimal point', () => {
        expect(splitCubes[0].fields.all[2].value.length).toEqual(expectedFirstChunkPayloadLength);
      });

      it('expect the first chunk to reference the second chunk', () => {
        const rel = Relationship.fromField(splitCubes[0].fields.all[1]);
        expect(rel.type).toBe(RelationshipType.CONTINUED_IN);
        expect(rel.remoteKey).toEqual(splitCubes[1].getKeyIfAvailable());
      });

      it('creates all required fields for the second chunk', () => {
        // Expect the second chunk to contain all positional fields a Cube needs,
        // plus the second part of the payload. Chunks are automatically padded up,
        // so expect a CCI_END marker and some padding as well.
        expect(splitCubes[1].fields.all[0].type).toEqual(FieldType.TYPE);
        expect(splitCubes[1].fields.all[1].type).toEqual(FieldType.PAYLOAD);
        expect(splitCubes[1].fields.all[2].type).toEqual(FieldType.CCI_END);
        expect(splitCubes[1].fields.all[3].type).toEqual(FieldType.PADDING);
        expect(splitCubes[1].fields.all[4].type).toEqual(FieldType.DATE);
        expect(splitCubes[1].fields.all[5].type).toEqual(FieldType.NONCE);
      });

      it('puts the correct amount of payload in the second chunk', () => {
        // Expect the second chunk to contain exactly the amount of payload
        // that didn't fit the first one.
        expect(splitCubes[1].fields.all[1].value.length).toEqual(
          payloadMacrofield.value.length - expectedFirstChunkPayloadLength);
      });

      it("retains the input Veritum's date in both chunks", () => {
        expect(splitCubes[0].getDate()).toEqual(date);
        expect(splitCubes[1].getDate()).toEqual(date);
      });
    });


    it('respects a caller-supplied maximum chunk size', async () => {
      const veritum = new Veritum({
        cubeType: CubeType.FROZEN,
        fields: VerityField.Payload(tooLong),
        requiredDifficulty: 0,
      });

      // run the test
      const chunks: cciCube[] =
        await Split(veritum, {
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
        await Split(veritum, {
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

  for (const cubeType of enumNums(CubeType)) {
    if (HasSignature[cubeType]) continue;  // signed Continuation not yet supported
    describe(`round-trip Split()-Recombine() tests using ${CubeType[cubeType]} Cubes`, () => {
      // note: we may want to remove this loop in the future as we have very similar
      //   tests one layer higher at the Veritum level and repeating those tests
      //   for all Cube types is kind of expensive, especially for multi-chunk
      //   signed types

      describe('splitting a single large field', () => {
        describe('split and restore a single overly large payload field requiring two chunks', () => {
          let veritum: Veritum;
          let recombined: Veritum;
          // let notifyKey: Buffer;

          beforeAll(async () => {
            // prepare fields
            const payloadMacrofield = VerityField.Payload(tooLong);
            const dateField = VerityField.Date(date);
            const notifyField = VerityField.Notify(notificationKey);

            const fields: VerityField[] = [dateField, payloadMacrofield];
            if (HasNotify[cubeType]) fields.push(notifyField);

            // prepare the input Veritum
            veritum = new Veritum({
              cubeType: cubeType,
              requiredDifficulty: 0,
              publicKey, privateKey,
              fields: fields,
            });

            // run the test: split, then recombine
            const splitCubes: cciCube[] = await Split(veritum, {requiredDifficulty: 0});
            expect(splitCubes.length).toEqual(2);
            recombined = Recombine(splitCubes, {requiredDifficulty: 0});
          });

          it('correctly restored the PAYLOAD', () => {
            expect(Array.from(recombined.getFields(FieldType.PAYLOAD))).toHaveLength(1);
            const restoredPayload = recombined.getFirstField(FieldType.PAYLOAD);
            expect(restoredPayload.valueString).toEqual(tooLong);
          });

          it('correclty restores the DATE', () => {
            expect(recombined.getFirstField(FieldType.DATE).value)
              .toEqual(veritum.getFirstField(FieldType.DATE).value);
          });

          if (HasNotify[cubeType]) it('correctly restores the NOTIFY field', () => {
            const notification = recombined.getFirstField(FieldType.NOTIFY);
            expect(notification.value.equals(notificationKey)).toBe(true);
          });
          else it('does not create any spurious NOTIFY field', () => {
            expect(recombined.getFirstField(FieldType.NOTIFY)).toBeUndefined();
          });

          it("restored veritum's fields and original's fields compare as equal", () => {
            // Note that we don't compare the Verita itself as they have different
            // compilation status
            expect(recombined.fieldsEqual(veritum, FieldEqualityMetric.IgnoreOrder)).toBe(true);
          });
        });  // split and restore a single overly large payload field requiring two chunks

        it('splits and restores a single extremely large payload field requiring more than two chunks', async () => {
          // prepare macro Cube
          const macroCube = cciCube.Create({
            cubeType: cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
          });
          const payloadMacrofield = VerityField.Payload(farTooLong);
          macroCube.insertFieldBeforeBackPositionals(payloadMacrofield);

          // run the test: split, then recombine
          const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
          expect(splitCubes.length).toBeGreaterThan(11);
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
            cubeType: cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
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
          const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});

          // run some tests on the chunks: ensure that the total number of target
          // fields in the split is correct
          let targetFieldsInSplit = 0;
          for (const cube of splitCubes) {
            targetFieldsInSplit += cube.fields.get(FieldType.MEDIA_TYPE).length;
          }
          expect(targetFieldsInSplit).toEqual(numFields);


          // recombine the chunks
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
            cubeType: cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
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
          const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});

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
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
            cubeType: cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
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
          const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});

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
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
          const veritum = new Veritum({
            cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
          });
          for (let i=0; i<10; i++) {
            const text = `Hoc est ${i}-um experimentale campus. Valde gravem informationem continet, nec amittendam nec cum aliis campis confundendam.`
            const field = VerityField.Payload(text);
            veritum.appendField(field);
          }

          // split the Cube
          const splitCubes: cciCube[] = await Split(veritum, {requiredDifficulty: 0});
          expect(splitCubes).toHaveLength(2);

          // recombine
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
            cubeType: cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
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
          const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
          expect(splitCubes.length).toEqual(2);
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
            cubeType: cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
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
          const splitCubes: cciCube[] = await Split(macroCube, {requiredDifficulty: 0});
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
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
          const veritum = new Veritum({
            cubeType,
            requiredDifficulty: 0,
            publicKey, privateKey,
          });
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
          const splitCubes: cciCube[] = await Split(veritum, {requiredDifficulty: 0});
          const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

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
            const numCciFields = Math.floor(Math.random() * 100);

            // prepare macro Cube
            const veritum = new Veritum({
              cubeType: cubeType,
              requiredDifficulty: 0,
              publicKey, privateKey,
              fields: VerityField.Date(date),
            });
            for (let i=0; i < numCciFields; i++) {
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
              veritum.insertFieldBeforeBackPositionals(field);
            }
            const originalFields = Array.from(veritum.getFields());

            // split and recombine the Veritum
            const splitCubes: cciCube[] = await Split(veritum, {requiredDifficulty: 0});
            const recombined: Veritum = Recombine(splitCubes, {requiredDifficulty: 0});

            // assert that payload was correctly restored
            const restoredFields = Array.from(recombined.getFields());
            expect(restoredFields.length).toEqual(veritum.fieldCount);
            // assert that all fields have been restored correctly
            for (let i = 0; i < veritum.fieldCount; i++) {
              expect(restoredFields[i].equals(originalFields[i])).toBe(true);
            }
          });
        }
      });
    });
  }  // round-trip tests (for each Cube type)


  describe('Recombine() edge cases', () => {
    it('returns an empty frozen Veritum when supplied no Chunks', () => {
      const recombined: Veritum = Recombine([]);
      expect(recombined).toBeInstanceOf(Veritum);
      expect(Array.from(recombined.getFields()).length).toBe(0);
      expect(recombined.cubeType).toBe(CubeType.FROZEN);
    });
  });
});
