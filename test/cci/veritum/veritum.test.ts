import { cciCube, cciFamily } from "../../../src/cci/cube/cciCube";
import { MediaTypes, cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { Continuation } from "../../../src/cci/veritum/continuation";
import { Veritum } from "../../../src/cci/veritum/veritum";
import { coreCubeFamily } from "../../../src/core/cube/cube";
import { CubeType } from "../../../src/core/cube/cube.definitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import { tooLong } from "../testcci.definitions";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

const requiredDifficulty = 0;

describe('Veritum', () => {
  const applicationField = cciField.Application("contentum probationis non applicationis");
  const mediaTypeField = cciField.MediaType(MediaTypes.TEXT);
  const payloadField = cciField.Payload("Hoc veritum probatio est");

  describe('construction', () => {
    describe('FromChunks()', () => {
      // Note: Decryption tests in veritumEncryption.test.ts
      describe('decryption', () => {
        it.todo('write a concise test ensuring this correctly chains Recombine(), which is already well tested');
      });
    });

    describe('copy constructor', () => {
      it('copies all properties with default options', () => {
        const originalVeritum = new Veritum({cubeType: CubeType.FROZEN});
        const copiedVeritum = new Veritum(originalVeritum);

        expect(copiedVeritum.cubeType).toBe(originalVeritum.cubeType);
        expect(copiedVeritum.family).toBe(originalVeritum.family);
        expect(copiedVeritum.fieldParser).toBe(originalVeritum.fieldParser);
        expect(copiedVeritum.publicKey).toBe(originalVeritum.publicKey);
        expect(copiedVeritum.privateKey).toBe(originalVeritum.privateKey);
        expect(copiedVeritum.requiredDifficulty).toBe(originalVeritum.requiredDifficulty);
      });

      it('copies all fields from the original instance', () => {
        const originalVeritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: [applicationField, mediaTypeField, payloadField],
        });
        const copiedVeritum = new Veritum(originalVeritum);

        expect(copiedVeritum.fieldsEqual(originalVeritum)).toBe(true);
      });

      it('creates a copy that evaluates as equal to the original', () => {
        const originalVeritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: [applicationField, mediaTypeField, payloadField],
        });
        const copiedVeritum = new Veritum(originalVeritum);
        expect(copiedVeritum).toEqual(originalVeritum);
      });

      it('ensures the copied instance is independent of the original', () => {
        const originalVeritum = new Veritum({
          cubeType: CubeType.FROZEN,
          fields: [applicationField, mediaTypeField, payloadField],
        });
        const copiedVeritum = new Veritum(originalVeritum);

        // Modify the copied instance
        copiedVeritum.appendField(cciField.ContentName("original had no name"));

        // Ensure the original instance remains unchanged
        expect(originalVeritum.fieldsEqual(copiedVeritum)).toBe(false);
        expect(copiedVeritum.getFirstField(cciFieldType.CONTENTNAME)).toBeDefined();
        expect(originalVeritum.getFirstField(cciFieldType.CONTENTNAME)).toBeUndefined();
      });
    });
  });

  describe('cubeType getter', () => {
    it('returns the CubeType set on construction', () => {
      const veritum = new Veritum({cubeType: CubeType.PMUC_NOTIFY});
      expect(veritum.cubeType).toBe(CubeType.PMUC_NOTIFY);
    });
  });

  describe('family getter', () => {
    it('returns the family set on construction', () => {
      const veritum = new Veritum({ cubeType: CubeType.PIC, family: coreCubeFamily });
      expect(veritum.family).toBe(coreCubeFamily);
    });

    it('uses CCI family by default', () => {
      const veritum = new Veritum({ cubeType: CubeType.MUC });
      expect(veritum.family).toBe(cciFamily);
    });
  });

  describe('fieldParser getter', () => {
    it('returns the correct field parser for CCI PMUC Veritae', () => {
      const veritum = new Veritum({ cubeType: CubeType.PMUC });
      expect(veritum.fieldParser).toBe(cciFamily.parsers[CubeType.PMUC]);
    });
  });

  describe('getKeyIfAvailable() and getKeyStringIfAvailable()', () => {
    it('returns undefined for a non-compiled frozen veritable', () => {
      const veritum = new Veritum({cubeType: CubeType.FROZEN, fields: payloadField});
      expect(veritum.getKeyIfAvailable()).toBeUndefined();
      expect(veritum.getKeyStringIfAvailable()).toBeUndefined();
    });

    it('returns the Cube key for a single-Cube compiled Veritum', async() => {
      const veritum = new Veritum({
        cubeType: CubeType.FROZEN, fields: payloadField, requiredDifficulty});
      await veritum.compile();
      expect(veritum.getKeyIfAvailable()).toBeInstanceOf(Buffer);
      expect(veritum.getKeyIfAvailable()).toEqual(
        Array.from(veritum.compiled)[0].getKeyIfAvailable());
    });

    it('returns the first Cube\'s key for a multi-Cube compiled Veritum', async () => {
      const largePayloadField = cciField.Payload(Buffer.alloc(NetConstants.CUBE_SIZE * 2, 'a'));
      const veritum = new Veritum({
        cubeType: CubeType.FROZEN, fields: largePayloadField, requiredDifficulty,
      });

      const cubesIterable: Iterable<cciCube> = await veritum.compile();
      const compiled: cciCube[] = Array.from(cubesIterable);

      expect(compiled.length).toBeGreaterThan(1);
      const firstCubeKey = await compiled[0].getKey();
      expect(veritum.getKeyIfAvailable()).toEqual(firstCubeKey);
    });

    it('returns the public key for a MUC Veritum', () => {
      const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 0x42);
      const veritum = new Veritum({
        cubeType: CubeType.MUC, fields: payloadField, publicKey});
      expect(veritum.getKeyIfAvailable()).toBe(publicKey);
      expect(veritum.getKeyStringIfAvailable()).toEqual(publicKey.toString('hex'));
    });
  });

  describe('compile()', () => {
    // Note: encryption tests are in encryption.test.ts

    describe('splitting', () => {
      it('compiles a short frozen Veritum to a single Frozen Cube', async() => {
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN,fields: payloadField, requiredDifficulty});
        const cubesIterable: Iterable<cciCube> = await veritum.compile();
        expect(cubesIterable).toEqual(veritum.compiled);
        const compiled: cciCube[] = Array.from(cubesIterable);
        expect(compiled.length).toBe(1);
        expect(compiled[0].cubeType).toBe(CubeType.FROZEN);
        expect(compiled[0].getFirstField(cciFieldType.PAYLOAD)).toEqual(payloadField);
      });

      it('compiles a long frozen Veritum to multiple Frozen Cubes', async() => {
        const veritum = new Veritum({
          cubeType: CubeType.FROZEN, fields: cciField.Payload(tooLong), requiredDifficulty});
        await veritum.compile({requiredDifficulty});
        expect(veritum.compiled).toHaveLength(2);

        // expect both chunks to contain a (partial) PAYLOAD field
        // and the first chunk to contain a reference to the second
        expect(veritum.compiled[0].getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
        expect(veritum.compiled[1].getFirstField(cciFieldType.PAYLOAD)).toBeDefined();
        const refField: cciField = veritum.compiled[0].getFirstField(cciFieldType.RELATES_TO);
        const ref = cciRelationship.fromField(refField);
        expect(ref.type).toEqual(cciRelationshipType.CONTINUED_IN);
        expect(ref.remoteKey).toBeInstanceOf(Buffer);
        expect(ref.remoteKey).toEqual(veritum.compiled[1].getKeyIfAvailable());

        const restored = Continuation.Recombine(veritum.compiled);
        expect(restored.cubeType).toBe(CubeType.FROZEN);
        expect(restored.getFirstField(cciFieldType.PAYLOAD).valueString).toEqual(
          tooLong);
      });
    });  // compile() splitting tests
  });  // compile()

  describe('field handling methods', () => {
    describe('field retrieval and analysis methods', () => {
      describe('fieldsEqual()', () => {
        it('returns true for two Veritum instances with the same fields', () => {
          const veritum1 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const veritum2 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          expect(veritum1.fieldsEqual(veritum2)).toBe(true);
        });

        it('returns false for two Veritum instances with different fields', () => {
          const veritum1 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const veritum2 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          expect(veritum1.fieldsEqual(veritum2)).toBe(false);
        });

        it('returns false for two Veritum instances with different field values', () => {
          const differentPayloadField = cciField.Payload("Different payload");
          const veritum1 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const veritum2 = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, differentPayloadField],
          });
          expect(veritum1.fieldsEqual(veritum2)).toBe(false);
        });

        it('returns true for two Veritum instances with empty fields', () => {
          const veritum1 = new Veritum({ cubeType: CubeType.FROZEN });
          const veritum2 = new Veritum({ cubeType: CubeType.FROZEN });
          expect(veritum1.fieldsEqual(veritum2)).toBe(true);
        });
      });

      describe('fieldCount()', () => {
        it('returns the correct number of fields', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          expect(veritum.fieldCount).toBe(3);
        });
      });

      describe('byteLength()', () => {
        it('returns the correct byte length for a single field', () => {
          const veritum = new Veritum(
            {cubeType: CubeType.FROZEN, fields: payloadField });
          const expectedByteLength =
            payloadField.value.length +
            veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.byteLength).toBe(expectedByteLength);
        });

        it('returns the correct byte length for multiple fields', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const expectedByteLength =
            applicationField.value.length +
            mediaTypeField.value.length +
            payloadField.value.length +
            veritum.fieldParser.getFieldHeaderLength(applicationField.type) +
            veritum.fieldParser.getFieldHeaderLength(mediaTypeField.type) +
            veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.byteLength).toBe(expectedByteLength);
        });

        it('returns 0 for an empty field set', () => {
          const veritum = new Veritum({ cubeType: CubeType.FROZEN });
          expect(veritum.byteLength).toBe(0);
        });
      });

      describe('getFieldLength()', () => {
        it('returns the correct length for a single field', () => {
          const veritum = new Veritum({ cubeType: CubeType.FROZEN, fields: payloadField });
          const expectedLength = payloadField.value.length + veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.getFieldLength(payloadField)).toBe(expectedLength);
        });

        it('returns the correct length for multiple fields', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const expectedApplicationLength: number =
            applicationField.value.length +
            veritum.fieldParser.getFieldHeaderLength(applicationField.type);
          const expectedMediaTypeLength: number =
            mediaTypeField.value.length +
            veritum.fieldParser.getFieldHeaderLength(mediaTypeField.type);
          const expectedPayloadLength: number =
            payloadField.value.length +
            veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          const expectedTotalLength: number =
            expectedApplicationLength +
            expectedMediaTypeLength +
            expectedPayloadLength;

          expect(veritum.getFieldLength()).toBe(expectedTotalLength);
          expect(veritum.getFieldLength([applicationField])).toBe(
            expectedApplicationLength);
          expect(veritum.getFieldLength([applicationField, payloadField])).toBe(
            expectedApplicationLength + expectedPayloadLength);
          expect(veritum.getFieldLength([applicationField, payloadField, mediaTypeField])).toBe(
            expectedApplicationLength + expectedPayloadLength + expectedMediaTypeLength);
        });

        it('returns 0 for an empty field set', () => {
          const emptyVeritum = new Veritum({ cubeType: CubeType.FROZEN });
          expect(emptyVeritum.getFieldLength()).toBe(0);

          const nonEmptyVeritum = new Veritum({
            cubeType: CubeType.FROZEN, fields: payloadField });
          expect(emptyVeritum.getFieldLength([])).toBe(0);
        });

        it('can calculate the length even for fields not currently part of this Veritum', () => {
          const veritum = new Veritum({ cubeType: CubeType.PMUC });
          const expectedPayloadLength = payloadField.value.length + veritum.fieldParser.getFieldHeaderLength(payloadField.type);
          expect(veritum.getFieldLength(payloadField)).toBe(expectedPayloadLength);
        });
      });

      describe('getFields()', () => {
        it('fetches all fields by default', () => {
          const veritum = new Veritum({
            cubeType:CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const fields = Array.from(veritum.getFields());
          expect(fields.length).toBe(3);
          expect(fields[0]).toBe(applicationField);
          expect(fields[1]).toBe(mediaTypeField);
          expect(fields[2]).toBe(payloadField);
        });

        it('fetches a single field if there is only one of the specified type', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const fields = Array.from(veritum.getFields(cciFieldType.PAYLOAD));
          expect(fields.length).toBe(1);
          expect(fields[0]).toBe(payloadField);
        });

        it.todo('fetches all fields of a specified type where multiple exist')
      });

      describe('getFirstField()', () => {
        it('returns the first field of the specified type', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          const field = veritum.getFirstField(cciFieldType.PAYLOAD);
          expect(field).toBe(payloadField);
        });

        it('returns undefined if no field of the specified type exists', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          const field = veritum.getFirstField(cciFieldType.PAYLOAD);
          expect(field).toBeUndefined();
        });
      });

      describe('sliceFieldsBy()', () => {
        it.todo('splits the field set into blocks starting with a field of the specified type');
      });
    });  // field retrieval and analysis methods

    describe('field manipulation methods', () => {
      describe('appendField()', () => {
        it('appends a field to the Veritum', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          veritum.appendField(payloadField);
          expect(veritum.fieldCount).toBe(3);
        });
      });

      describe('insertFieldInFront()', () => {
        it('inserts a field in front of the Veritum', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [mediaTypeField, payloadField],
          });
          veritum.insertFieldInFront(applicationField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[0]).toBe(applicationField);
        });
      });

      describe('insertFieldAfterFrontPositionals()', () => {
        it.todo('write tests');
      });

      describe('insertFieldBeforeBackPositionals()', () => {
        it.todo('write tests');
      });

      describe('insertFieldBefore()', () => {
        it('inserts a field before another field', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, payloadField],
          });
          veritum.insertFieldBefore(cciFieldType.PAYLOAD, mediaTypeField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[0].type).toBe(cciFieldType.APPLICATION);
          expect(veritum.getFields()[1].type).toBe(cciFieldType.MEDIA_TYPE);
          expect(veritum.getFields()[2].type).toBe(cciFieldType.PAYLOAD);
        });
      });

      describe('insertField()', () => {
        it.todo('write tests');
      });

      describe('ensureFieldInFront()', () => {
        it('adds a field in front if it does not exist', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [mediaTypeField, payloadField],
          });
          veritum.ensureFieldInFront(cciFieldType.APPLICATION, applicationField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[0]).toBe(applicationField);
        });

        it.todo('does nothing if a field of specified type is already in front');
      });

      describe('ensureFieldInBack()', () => {
        it('adds a field in back if it does not exist', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField],
          });
          veritum.ensureFieldInBack(cciFieldType.PAYLOAD, payloadField);
          expect(veritum.fieldCount).toBe(3);
          expect(veritum.getFields()[2]).toBe(payloadField);
        });

        it.todo('does nothing if a field of specified type is already in back');
      });

      describe('removeField()', () => {
        it('removes a field from the Veritum by value', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          veritum.removeField(mediaTypeField);
          expect(veritum.fieldCount).toBe(2);
          expect(veritum.getFirstField(cciFieldType.MEDIA_TYPE)).toBeUndefined();
        });

        it('removes a field from the Veritum by index', () => {
          const veritum = new Veritum({
            cubeType: CubeType.FROZEN,
            fields: [applicationField, mediaTypeField, payloadField],
          });
          veritum.removeField(1);
          expect(veritum.fieldCount).toBe(2);
          expect(veritum.getFirstField(cciFieldType.MEDIA_TYPE)).toBeUndefined();
        });
      });

      describe('manipulateFields()', () => {
        it.todo('returns an iterable containing all fields');
      });
    });  // field manipulation methods
  });  // field handling methods
});
