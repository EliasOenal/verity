import { ApiMisuseError } from "../../../src/core/settings";
import { BaseField } from "../../../src/core/fields/baseField";
import { BaseFields, FieldEqualityMetric, FieldPosition } from "../../../src/core/fields/baseFields";
import { FieldNumericalParam, PositionalFields, FieldDefinition, FieldParser } from "../../../src/core/fields/fieldParser";
import { CoreFrozenFieldDefinition } from "../../../src/core/cube/cubeFields";
import { CubeFieldType, CubeType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('baseFields', () => {
  // any similarities with CubeFieldTypes, living or dead, are purely coincidental
  enum TestFieldType {
    NONCE = 0,
    PAYLOAD = 4,
    SIGNATURE = 24,
    STOP = 66,
    REMAINDER = 67,
    VERSION = 257,
    DATE = 258,
  }
  const TestFieldLength: FieldNumericalParam = {
    [TestFieldType.NONCE]: 4,
    [TestFieldType.PAYLOAD]: undefined,
    [TestFieldType.SIGNATURE]: 5,
    [TestFieldType.STOP]: undefined,  // using variable length stop field, just 'cause CCI doesn't
    [TestFieldType.REMAINDER]: undefined,
    [TestFieldType.VERSION]: 1,
    [TestFieldType.DATE]: 5,
  };
  const TestPositionalFront: PositionalFields = {
    1: TestFieldType.VERSION,
    2: TestFieldType.DATE,
  };
  const TestPositionalBack: PositionalFields = {
    1: TestFieldType.NONCE,
    2: TestFieldType.SIGNATURE,
  };
  const testFieldDefinition: FieldDefinition = {
    fieldNames: TestFieldType,
    fieldLengths: TestFieldLength,
    positionalFront: TestPositionalFront,
    positionalBack: TestPositionalBack,
    fieldObjectClass: BaseField,
    fieldsObjectClass: BaseFields,
    firstFieldOffset: 0,
    stopField: TestFieldType.STOP,
    remainderField: TestFieldType.REMAINDER,
  }
  let fieldParser: FieldParser;
  let version: BaseField, date: BaseField, sig: BaseField, nonce: BaseField;
  let payload: BaseField, payload2: BaseField, stop: BaseField, remainder: BaseField;

  beforeEach(() => {
    // prepare the field parser
    fieldParser = new FieldParser(testFieldDefinition);

    // prepare some fields
    const versiondata = Buffer.alloc(1); versiondata.writeUint8(42);
    version = new BaseField(
      TestFieldType.VERSION, versiondata);

    const datedata = Buffer.alloc(5); datedata.writeUIntBE(1696000000, 0, 5);
    date = new BaseField(
      TestFieldType.DATE, datedata
    );

    const sigdata = Buffer.alloc(5); sigdata.writeUIntBE(3392000000, 0, 5);  // I think double the time makes for a good signature
    sig = new BaseField(
      TestFieldType.SIGNATURE, sigdata
    );

    const noncedata = Buffer.alloc(4); noncedata.writeUIntBE(848000000, 0, 4);  // I think half the time makes for a good nonce
    nonce = new BaseField(
      TestFieldType.NONCE, noncedata
    );

    const payloaddata = 'Habeo res importantes dicere';
    payload = new BaseField(TestFieldType.PAYLOAD, payloaddata);

    const payloaddata2 = 'Habeo res maximi momenti dicendas'
    payload2 = new BaseField(TestFieldType.PAYLOAD, payloaddata2);

    const stopdata = "Tempus dicendi consumptum est"
    stop = new BaseField(TestFieldType.STOP, stopdata);

    const remainderdata = "Nemo iam curat verba tua"
    remainder = new BaseField(TestFieldType.REMAINDER, remainderdata);
  });

  describe('constructor (construction from scratch)', () => {
    it('should initialize correctly with data and fieldDefinition', () => {
      const data = [new BaseField(1, Buffer.from('test'))];
      const baseFields = new BaseFields(data, testFieldDefinition);
      expect(baseFields.all).toEqual(data);
      expect(baseFields.fieldDefinition).toEqual(testFieldDefinition);
    });

    it('should throw ApiMisuseError when fieldDefinition is not provided', () => {
      expect(() => new BaseFields([])).toThrow(ApiMisuseError);
    });
  });

  describe('copy constructor', () => {
    it('creates a deep copy of the fields', () => {
      const data = [new BaseField(1, Buffer.from('test')), new BaseField(2, Buffer.from('test2'))];
      const baseFields = new BaseFields(data, testFieldDefinition);
      const baseFieldsCopy = new BaseFields(baseFields);

      expect(baseFieldsCopy.fieldDefinition).not.toBe(baseFields.fieldDefinition);
      expect(baseFieldsCopy.fieldDefinition).toEqual(baseFields.fieldDefinition);

      expect(baseFieldsCopy.all).not.toBe(baseFields.all);
      expect(baseFieldsCopy.all.length).toBe(baseFields.all.length);
      for (let i = 0; i < baseFieldsCopy.all.length; i++) {
        expect(baseFieldsCopy.all[i]).not.toBe(baseFields.all[i]);
        expect(baseFieldsCopy.all[i]).toEqual(baseFields.all[i]);
      }
    });

    it('copied the field definition', () => {
    });
  });

  describe('getters', () => {
    describe('meta data getter', () => {
      it('should return correct byte length', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
        const baseField2 = new BaseField(TestFieldType.VERSION, Buffer.alloc(1));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        expect(baseFields.getByteLength()).toEqual(7);  // 4 chars, 2 byte Payload header, 1 byte version
      });

      it('should return correct count', () => {
        const data = [
          new BaseField(TestFieldType.PAYLOAD, Buffer.from('test')),
          new BaseField(TestFieldType.VERSION, Buffer.alloc(1))
        ];
        const baseFields = new BaseFields(data, testFieldDefinition);
        expect(baseFields.length).toEqual(2);
      });
    });

    describe('getting fields', () => {
      it('should get fields correctly by type', () => {
        const data = [
          new BaseField(TestFieldType.PAYLOAD, Buffer.from('test')),
          new BaseField(TestFieldType.PAYLOAD, Buffer.from('test2')),
          new BaseField(TestFieldType.VERSION, Buffer.alloc(1))
        ];
        const baseFields = new BaseFields(data, testFieldDefinition);
        expect(baseFields.get(TestFieldType.PAYLOAD)).toEqual([data[0], data[1]]);
      });

      describe('getFirst()', () => {
        it('should return the first field of the specified type', () => {
          const baseField1 = new BaseField(1, Buffer.from('test'));
          const baseField2 = new BaseField(2, Buffer.from('testing'));
          const baseField3 = new BaseField(1, Buffer.from('another'));
          const baseFields = new BaseFields([baseField1, baseField2, baseField3], testFieldDefinition);
          expect(baseFields.getFirst(1)).toEqual(baseField1);
        });

        it('should return undefined if no field of the specified type is found', () => {
          const baseField1 = new BaseField(1, Buffer.from('test'));
          const baseField2 = new BaseField(2, Buffer.from('testing'));
          const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
          expect(baseFields.getFirst(3)).toBeUndefined();
        });
      });
    });
  });

  describe('removeField', () => {
    it('should remove field correctly by index', () => {
      const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
      const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('testing'));
      const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
      baseFields.removeField(0);
      expect(baseFields.all).toEqual([baseField2]);
    });

    it('should remove field correctly by object', () => {
      const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
      const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('testing'));
      const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
      baseFields.removeField(baseField2);
      expect(baseFields.all).toEqual([baseField1]);
    });

    it('should do nothing when trying to remove a field that is not in the set', () => {
      const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
      const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('testing'));
      const fieldNotInSet = new BaseField(TestFieldType.PAYLOAD, Buffer.from('nope'));
      const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
      expect(baseFields.length).toBe(2);
      expect(baseFields.all).toEqual([baseField1, baseField2]);
      baseFields.removeField(fieldNotInSet);
      expect(baseFields.length).toBe(2);
      expect(baseFields.all).toEqual([baseField1, baseField2]);
    });
  });

  describe('equals', () => {
    describe('using metric IgnoreOrder (default)', () => {
      it('should return true when comparing BaseFields instances with same fields in different order', () => {
        const baseFields1 = new BaseFields([payload, payload2], testFieldDefinition);
        const baseFields2 = new BaseFields([payload2, payload], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.IgnoreOrder })).toBe(true);
      });

      it('should return false when comparing BaseFields instances with different fields', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
        const baseField2 = new BaseField(TestFieldType.NONCE, Buffer.from('other field'));
        const baseField3 = new BaseField(TestFieldType.SIGNATURE, Buffer.from('yet another field'));
        const baseFields1 = new BaseFields([baseField1, baseField2], testFieldDefinition);
        const baseFields2 = new BaseFields([baseField1, baseField3], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.IgnoreOrder })).toBe(false);
      });
    });

    describe('using metric Ordered', () => {
      it('should return true when comparing two identical BaseFields', () => {
        const baseFields1 = new BaseFields([payload], testFieldDefinition);
        const baseFields2 = new BaseFields([payload], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.Ordered })).toBe(true);
      });

      it('should return false when comparing two different BaseFields', () => {
        const baseFields1 = new BaseFields([payload], testFieldDefinition);
        const baseFields2 = new BaseFields([payload2], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.Ordered })).toBe(false);
      });

      it('should return false when comparing BaseFields instances with different lengths', () => {
        const baseFields1 = new BaseFields([payload], testFieldDefinition);
        const baseFields2 = new BaseFields([], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.Ordered })).toBe(false);
      });

      it('should return false when comparing BaseFields instances with same fields in different order', () => {
        const baseFields1 = new BaseFields([payload, payload2], testFieldDefinition);
        const baseFields2 = new BaseFields([payload2, payload], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.Ordered })).toBe(false);
      });
    });

    describe('using metric OrderedSameOffset', () => {
      it('should return true when comparing BaseFields instances with same order and offset', () => {
        const baseFields1 = new BaseFields([payload], testFieldDefinition);
        const baseFields2 = new BaseFields([payload], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.OrderedSameOffset })).toBe(true);
      });

      it('should return false when comparing BaseFields instances with same order but different offsets', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'), 0);
        const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'), 1);
        const baseFields1 = new BaseFields([baseField1], testFieldDefinition);
        const baseFields2 = new BaseFields([baseField2], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { metric: FieldEqualityMetric.OrderedSameOffset })).toBe(false);
      });
    });

    describe('using option ignoreDisregarded (default)', () => {
      it('should compare two BaseFields as equal if one contains a disregarded field and the other does not', () => {
        const baseFields1 = new BaseFields([
          version, date, payload, stop, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, payload, stop, payload2, sig, nonce
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2)).toBe(true);
      });

      it('should compare two BaseFields as equal if they only differ in disregarded fields', () => {
        const baseFields1 = new BaseFields([
          version, date, stop, payload, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, stop, payload, payload2, sig, nonce
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2)).toBe(true);
      });

      it('should compare two BaseFields as equal if one contains a remainder field and the other does not', () => {
        const baseFields1 = new BaseFields([
          version, date, payload, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, payload, sig, nonce, remainder
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2)).toBe(true);
      });

      it('should return false if one has a stop field and the other does not', () => {
        const baseFields1 = new BaseFields([
          version, date, payload, stop, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, payload, sig, nonce
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2)).toBe(false);
      });
    });

    describe('disabling option ignoreDisregarded', () => {
      it('should return false if one BaseFields contains a disregarded field and the other does not', () => {
        const baseFields1 = new BaseFields([
          version, date, payload, stop, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, payload, stop, payload2, sig, nonce
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { ignoreDisregarded: false })).toBe(false);
      });

      it('should return false if two BaseFields differ (only) in disregarded fields', () => {
        const baseFields1 = new BaseFields([
          version, date, stop, payload, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, stop, payload, payload2, sig, nonce
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { ignoreDisregarded: false })).toBe(false);
      });

      it('should return false if one BaseFields contains a remainder field and the other does not', () => {
        const baseFields1 = new BaseFields([
          version, date, payload, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, payload, sig, nonce, remainder
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { ignoreDisregarded: false })).toBe(false);
      });

      it('should return false if one has a stop field and the other does not', () => {
        const baseFields1 = new BaseFields([
          version, date, payload, stop, sig, nonce
        ], testFieldDefinition);
        const baseFields2 = new BaseFields([
          version, date, payload, sig, nonce
        ], testFieldDefinition);
        expect(baseFields1.equals(baseFields2, { ignoreDisregarded: false })).toBe(false);
      });
    });
  });

  describe('adding fields', () => {
    describe('basic inserts and appends', () => {
      it('should append field correctly', () => {
        const baseField = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
        const baseFields = new BaseFields([], testFieldDefinition);
        baseFields.appendField(baseField);
        expect(baseFields.all).toEqual([baseField]);
      });

      it('should append multiple fields correctly', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('experior'));
        const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('adhuc experior'));
        const baseField3 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('magis experior'));
        const baseField4 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('non desinam experiri'));
        const baseFields = new BaseFields(baseField1, testFieldDefinition);
        baseFields.appendField(baseField2, baseField3, baseField4);
        expect(baseFields.all).toEqual([baseField1, baseField2, baseField3, baseField4]);
      });

      it('should insert field in front correctly', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
        const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('testing'));
        const baseFields = new BaseFields([baseField2], testFieldDefinition);
        baseFields.insertFieldInFront(baseField1);
        expect(baseFields.all).toEqual([baseField1, baseField2]);
      });

      it('should insert multiple fields in front correctly', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('experior'));
        const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('adhuc experior'));
        const baseField3 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('magis experior'));
        const baseField4 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('non desinam experiri'));
        const baseFields = new BaseFields(baseField4, testFieldDefinition);
        baseFields.insertFieldInFront(baseField1, baseField2, baseField3);
        expect(baseFields.all).toEqual([baseField1, baseField2, baseField3, baseField4]);
      });

      it('should throw ApiMisuseError when an invalid position is provided', () => {
        const baseField = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
        const baseFields = new BaseFields([], testFieldDefinition);
        expect(() => baseFields.insertField(42 as FieldPosition, baseField)).toThrow(ApiMisuseError);
      });
    });

    describe('inserting between positionals', () => {
      it('should insert field after front positionals', () => {
        const frontPositional = new BaseField(TestFieldType.VERSION, Buffer.from('test'));
        const backPositional = new BaseField(TestFieldType.SIGNATURE, Buffer.from('testing'));
        const fields = new BaseFields([frontPositional, backPositional], testFieldDefinition);

        const newField = new BaseField(3, Buffer.from('new'));
        fields.insertFieldAfterFrontPositionals(newField);
        expect(fields.all).toEqual([frontPositional, newField, backPositional]);
      });

      it('should insert multiple fields after front positionals', () => {
        const frontPositional = new BaseField(TestFieldType.VERSION, Buffer.from('experior'));
        const backPositional = new BaseField(TestFieldType.SIGNATURE, Buffer.from('non desinam experiri'));
        const fields = new BaseFields([frontPositional, backPositional], testFieldDefinition);

        const newField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('adhuc experior'));
        const newField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('magis experior'));
        fields.insertFieldAfterFrontPositionals(newField1, newField2);
        expect(fields.all).toEqual([frontPositional, newField1, newField2, backPositional]);
      });

      it('should insert field before back positionals', () => {
        const baseField1 = new BaseField(TestFieldType.VERSION, Buffer.alloc(1));
        const baseField2 = new BaseField(TestFieldType.SIGNATURE, Buffer.from('testing'));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        const newField = new BaseField(3, Buffer.from('new'));
        baseFields.insertFieldBeforeBackPositionals(newField);
        expect(baseFields.all).toEqual([baseField1, newField, baseField2]);
      });

      it('should insert multiple fields before back positionals', () => {
        const baseField1 = new BaseField(TestFieldType.VERSION, Buffer.from('experior'));
        const baseField2 = new BaseField(TestFieldType.SIGNATURE, Buffer.from('non desinam experiri'));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);

        const newField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('adhuc experior'));
        const newField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('magis experior'));
        baseFields.insertFieldBeforeBackPositionals(newField1, newField2);
        expect(baseFields.all).toEqual([baseField1, newField1, newField2, baseField2]);
      });

      it('can insert fields between positionals iteratively', () => {
        const fields = new BaseFields([version, date, nonce], testFieldDefinition);
        expect(fields.length).toEqual(3);
        expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
        expect(fields.all[1].type).toEqual(TestFieldType.DATE);
        expect(fields.all[2].type).toEqual(TestFieldType.NONCE);
        fields.insertFieldBeforeBackPositionals(sig);
        expect(fields.length).toEqual(4);
        expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
        expect(fields.all[1].type).toEqual(TestFieldType.DATE);
        expect(fields.all[2].type).toEqual(TestFieldType.SIGNATURE);
        expect(fields.all[3].type).toEqual(TestFieldType.NONCE);
        fields.insertFieldAfterFrontPositionals(payload);
        expect(fields.length).toEqual(5);
        expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
        expect(fields.all[1].type).toEqual(TestFieldType.DATE);
        expect(fields.all[2].type).toEqual(TestFieldType.PAYLOAD);
        expect(fields.all[2].valueString).toEqual(payload.valueString)
        expect(fields.all[3].type).toEqual(TestFieldType.SIGNATURE);
        expect(fields.all[4].type).toEqual(TestFieldType.NONCE);
        fields.insertFieldBeforeBackPositionals(payload2);
        expect(fields.length).toEqual(6);
        expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
        expect(fields.all[1].type).toEqual(TestFieldType.DATE);
        expect(fields.all[2].type).toEqual(TestFieldType.PAYLOAD);
        expect(fields.all[2].valueString).toEqual(payload.valueString)
        expect(fields.all[3].type).toEqual(TestFieldType.PAYLOAD);
        expect(fields.all[3].valueString).toEqual(payload2.valueString)
        expect(fields.all[4].type).toEqual(TestFieldType.SIGNATURE);
        expect(fields.all[5].type).toEqual(TestFieldType.NONCE);
      });

      it('can insert fields after front positionals even on empty field set', () => {
        const fields = new BaseFields([], testFieldDefinition);
        expect(fields.length).toEqual(0);
        fields.insertFieldAfterFrontPositionals(payload);
        expect(fields.length).toEqual(1);
        expect(fields.all[0].type).toEqual(TestFieldType.PAYLOAD);
      });

      it('can insert fields before back positionals even on empty field set', () => {
        const fields = new BaseFields([], testFieldDefinition);
        expect(fields.length).toEqual(0);
        fields.insertFieldBeforeBackPositionals(payload);
        expect(fields.length).toEqual(1);
        expect(fields.all[0].type).toEqual(TestFieldType.PAYLOAD);
      });

      it('will perform insertion after front positionals at very beginning if there are no front positionals', () => {
        const fields = new BaseFields([nonce], testFieldDefinition);
        expect(fields.length).toEqual(1);
        expect(fields.all[0].type).toEqual(TestFieldType.NONCE);
        fields.insertFieldAfterFrontPositionals(payload);
        expect(fields.length).toEqual(2);
        expect(fields.all[0].type).toEqual(TestFieldType.PAYLOAD);
        expect(fields.all[1].type).toEqual(TestFieldType.NONCE);
      });

      it('will perform insertion before back positionals at the very end if there are no back positionals', () => {
        const fields = new BaseFields([version], testFieldDefinition);
        expect(fields.length).toEqual(1);
        expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
        fields.insertFieldBeforeBackPositionals(payload);
        expect(fields.length).toEqual(2);
        expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
        expect(fields.all[1].type).toEqual(TestFieldType.PAYLOAD);
      });
    });

    describe('insertFieldBefore() field of other type', () => {
      it('should insert field correctly before existing field of specified type', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
        const baseField2 = new BaseField(TestFieldType.VERSION, Buffer.alloc(1));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        const newField = new BaseField(3, Buffer.from('new'));
        baseFields.insertFieldBefore(TestFieldType.VERSION, newField);
        expect(baseFields.all).toEqual([baseField1, newField, baseField2]);
      });

      it('should insert multiple fields correctly before existing field of specified type', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('experior'));
        const baseField2 = new BaseField(TestFieldType.VERSION, Buffer.alloc(1));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        const newField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('adhuc experior'));
        const newField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('magis experior'));
        baseFields.insertFieldBefore(TestFieldType.VERSION, newField1, newField2);
        expect(baseFields.all).toEqual([baseField1, newField1, newField2, baseField2]);
      });

      it('should append field correctly if no existing field of specified type', () => {
        const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
        const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('testing'));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        const newField = new BaseField(TestFieldType.PAYLOAD, Buffer.from('new'));
        baseFields.insertFieldBefore(TestFieldType.VERSION, newField);
        expect(baseFields.all).toEqual([baseField1, baseField2, newField]);
      });
    });

    describe('ensureFieldInFront and ensureFieldInBack', () => {
      it('should insert default field at the front if specified type is not found', () => {
        const baseField1 = new BaseField(1, Buffer.from('test'));
        const baseField2 = new BaseField(2, Buffer.from('testing'));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        expect(baseFields.length).toBe(2);
        const defaultField = new BaseField(3, Buffer.from('default'));
        baseFields.ensureFieldInFront(3, defaultField);
        expect(baseFields.length).toBe(3);
        expect(baseFields.all[0]).toEqual(defaultField);
      });

      it('should append default field at the back if specified type is not found', () => {
        const baseField1 = new BaseField(1, Buffer.from('test'));
        const baseField2 = new BaseField(2, Buffer.from('testing'));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        expect(baseFields.length).toBe(2);
        const defaultField = new BaseField(3, Buffer.from('default'));
        baseFields.ensureFieldInBack(3, defaultField);
        expect(baseFields.length).toBe(3);
        expect(baseFields.all[baseFields.length - 1]).toEqual(defaultField);
      });

      it('should move existing field to the front', () => {
        const baseField1 = new BaseField(1, Buffer.from('test'));
        const baseField2 = new BaseField(2, Buffer.from('testing'));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        const defaultField = new BaseField(1, Buffer.from('default'));
        baseFields.ensureFieldInFront(1, defaultField);
        expect(baseFields.all[0]).toEqual(baseField1);
      });

      it('should move existing field to the back', () => {
        const baseField1 = new BaseField(1, Buffer.from('test'));
        const baseField2 = new BaseField(2, Buffer.from('testing'));
        const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
        const defaultField = new BaseField(2, Buffer.from('default'));
        baseFields.ensureFieldInBack(2, defaultField);
        expect(baseFields.all[baseFields.length - 1]).toEqual(baseField2);
      });
    });
  });

  describe('sliceBy', () => {
    it('should slice fields by type', () => {
      const fields: BaseFields = new BaseFields([
        new BaseField(TestFieldType.NONCE, "abc"),
        new BaseField(TestFieldType.PAYLOAD, "def"),
        new BaseField(TestFieldType.NONCE, "ghi"),
        new BaseField(TestFieldType.PAYLOAD, "jkl"),
        new BaseField(TestFieldType.NONCE, "mno"),
        new BaseField(TestFieldType.NONCE, "pqr"),
        new BaseField(TestFieldType.NONCE, "stu"),
        new BaseField(TestFieldType.NONCE, "vwx"),
        new BaseField(TestFieldType.PAYLOAD, "yz!"),
      ], testFieldDefinition);
      {  // standard slicing not including leading non-matching fields
        const slices: BaseFields[] = fields.sliceBy(TestFieldType.PAYLOAD);
        expect(slices).toHaveLength(3);
        expect(slices[0].length).toEqual(2);
        expect(slices[0].all[0].type).toEqual(TestFieldType.PAYLOAD);
        expect(slices[0].all[0].valueString).toEqual("def");
        expect(slices[0].all[1].type).toEqual(TestFieldType.NONCE);
        expect(slices[0].all[1].valueString).toEqual("ghi");
        expect(slices[1].length).toEqual(5);
        expect(slices[1].all[0].type).toEqual(TestFieldType.PAYLOAD);
        expect(slices[1].all[0].valueString).toEqual("jkl");
        expect(slices[1].all[1].type).toEqual(TestFieldType.NONCE);
        expect(slices[1].all[1].valueString).toEqual("mno");
        expect(slices[1].all[2].type).toEqual(TestFieldType.NONCE);
        expect(slices[1].all[2].valueString).toEqual("pqr");
        expect(slices[1].all[3].type).toEqual(TestFieldType.NONCE);
        expect(slices[1].all[3].valueString).toEqual("stu");
        expect(slices[1].all[4].type).toEqual(TestFieldType.NONCE);
        expect(slices[1].all[4].valueString).toEqual("vwx");
        expect(slices[2].length).toEqual(1);
        expect(slices[2].all[0].type).toEqual(TestFieldType.PAYLOAD);
        expect(slices[2].all[0].valueString).toEqual("yz!");
      }
      {  // slicing including leading non-matching fields
        const slices: BaseFields[] = fields.sliceBy(TestFieldType.PAYLOAD, true);
        expect(slices).toHaveLength(4);
        expect(slices[0].length).toEqual(1);
        expect(slices[0].all[0].type).toEqual(TestFieldType.NONCE);
        expect(slices[0].all[0].valueString).toEqual("abc");
        expect(slices[1].length).toEqual(2);
        expect(slices[2].length).toEqual(5);
        expect(slices[3].length).toEqual(1);
      }
    });
  });

  describe('withoutDisregarded()', () => {
    it('should create an equal copy when there is no stop field', () => {
      const fields: BaseFields = new BaseFields([
        version, date, payload, payload2, sig, nonce
      ], testFieldDefinition);
      const result = fields.withoutDisregarded();
      expect(result).toEqual(fields);
    });

    it('should drop non-positional fields after the stop field while retaining positionals', () => {
      const fields: BaseFields = new BaseFields([
        version, date, payload, stop, payload2, sig, nonce
      ], testFieldDefinition);
      const result = fields.withoutDisregarded();
      expect(result).toBeInstanceOf(BaseFields);
      expect(result.length).toEqual(6);
      expect(result.all[0].equals(version)).toBe(true);
      expect(result.all[1].equals(date)).toBe(true);
      expect(result.all[2].equals(payload)).toBe(true);
      expect(result.all[3].equals(stop)).toBe(true);
      expect(result.all[4].equals(sig)).toBe(true);
      expect(result.all[5].equals(nonce)).toBe(true);
    });

    it('should always drop the remainder field', () => {
      const fields: BaseFields = new BaseFields([
        version, date, remainder, payload, sig, nonce
      ], testFieldDefinition);
      const result = fields.withoutDisregarded();
      expect(result).toBeInstanceOf(BaseFields);
      expect(result.length).toEqual(5);
      expect(result.all[0].equals(version)).toBe(true);
      expect(result.all[1].equals(date)).toBe(true);
      expect(result.all[2].equals(payload)).toBe(true);
      expect(result.all[3].equals(sig)).toBe(true);
      expect(result.all[4].equals(nonce)).toBe(true);
    });
  });

  describe('DefaultPositionals() static method', () => {
    it('should fill in missing positional fields with default values', () => {
      const result = BaseFields.DefaultPositionals(CoreFrozenFieldDefinition);
      // ensure correct types
      const frontTypes = result.all.map(field => field.type);
      expect(frontTypes).toEqual([CubeFieldType.TYPE, CubeFieldType.FROZEN_RAWCONTENT, CubeFieldType.DATE, CubeFieldType.NONCE]);
      // ensure TYPE field has correct content (others are non-static)
      const typeField = result.getFirst(CubeFieldType.TYPE);
      expect(typeField.value[0]).toBe(CubeType.FROZEN);
    });

    it('should retain input field when supplied as a single BaseField', () => {
      const data = CubeField.Type(CubeType.FROZEN);
      const result = BaseFields.DefaultPositionals(CoreFrozenFieldDefinition, data);
      expect(result.all).toContainEqual(data);
    });

    it('should retain input field when supplied as an array of BaseField', () => {
      const data = [CubeField.Type(CubeType.FROZEN)];
      const result = BaseFields.DefaultPositionals(CoreFrozenFieldDefinition, data);
      expect(result.all).toEqual(expect.arrayContaining(data));
    });

    it('should retain input field when supplied as a BaseFields object', () => {
      const data = new BaseFields([CubeField.Type(CubeType.FROZEN)], CoreFrozenFieldDefinition);
      const result = BaseFields.DefaultPositionals(CoreFrozenFieldDefinition, data);
      expect(result.all).toEqual(expect.arrayContaining(data.all));
    });

    it.todo('should handle gaps in positional fields');
  });
});
