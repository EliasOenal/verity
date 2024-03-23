import { BaseField, BaseFields } from "../../src/core/cube/baseFields";
import { FieldNumericalParam, PositionalFields, FieldDefinition, FieldParser } from "../../src/core/fieldParser";

describe('BaseField', () => {
  it('should initialize correctly with type, value, and start', () => {
    const type = 1;
    const value = Buffer.from('test');
    const start = 0;
    const baseField = new BaseField(type, value, start);
    expect(baseField.type).toEqual(type);
    expect(baseField.value).toEqual(value);
    expect(baseField.start).toEqual(start);
  });

  it('should return correct length', () => {
    const value = Buffer.from('test');
    const baseField = new BaseField(1, value);
    expect(baseField.length).toEqual(value.length);
  });

  it('should compare correctly with equals method', () => {
    const baseField1 = new BaseField(1, Buffer.from('test'));
    const baseField2 = new BaseField(1, Buffer.from('test'));
    const baseField3 = new BaseField(2, Buffer.from('test'));
    expect(baseField1.equals(baseField2)).toBeTruthy();
    expect(baseField1.equals(baseField3)).toBeFalsy();
  });

  it('should check if field is finalized correctly', () => {
    const finalized = new BaseField(1, Buffer.from('test'), 0);
    expect(finalized.isFinalized()).toBeTruthy();
    const unfinalized = new BaseField(1, Buffer.from('test'));
    expect(unfinalized.isFinalized()).toBeFalsy();
  });
});



describe('baseFields', () => {
  // any similarities with CubeFieldTypes, living or dead, are purely coincidental
  enum TestFieldType {
    NONCE = 0,
    PAYLOAD = 4,
    SIGNATURE = 24,
    VERSION = 257,
    DATE = 258,
  }
  const TestFieldLength: FieldNumericalParam = {
    [TestFieldType.NONCE]: 4,
    [TestFieldType.PAYLOAD]: undefined,
    [TestFieldType.SIGNATURE]: 5,
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
  }
  let fieldParser: FieldParser;
  let version: BaseField, date: BaseField, sig: BaseField, nonce: BaseField, payload: BaseField, payload2: BaseField;

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

    const payloaddata = Buffer.alloc(137); payloaddata.fill(42);
    payload = new BaseField(TestFieldType.PAYLOAD, payloaddata);

    const payloaddata2 = Buffer.alloc(137); payloaddata2.fill(84);
    payload2 = new BaseField(TestFieldType.PAYLOAD, payloaddata2);
  });


  it('should initialize correctly with data and fieldDefinition', () => {
    const data = [new BaseField(1, Buffer.from('test'))];
    const baseFields = new BaseFields(data, testFieldDefinition);
    expect(baseFields.all).toEqual(data);
    expect(baseFields.fieldDefinition).toEqual(testFieldDefinition);
  });

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

  it('should get fields correctly by type', () => {
    const data = [
      new BaseField(TestFieldType.PAYLOAD, Buffer.from('test')),
      new BaseField(TestFieldType.PAYLOAD, Buffer.from('test2')),
      new BaseField(TestFieldType.VERSION, Buffer.alloc(1))
    ];
    const baseFields = new BaseFields(data, testFieldDefinition);
    expect(baseFields.get(TestFieldType.PAYLOAD)).toEqual([data[0], data[1]]);
  });

  it('should append field correctly', () => {
    const baseField = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
    const baseFields = new BaseFields([], testFieldDefinition);
    baseFields.appendField(baseField);
    expect(baseFields.all).toEqual([baseField]);
  });

  it('should insert field in front correctly', () => {
    const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
    const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('testing'));
    const baseFields = new BaseFields([baseField2], testFieldDefinition);
    baseFields.insertFieldInFront(baseField1);
    expect(baseFields.all).toEqual([baseField1, baseField2]);
  });

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

  it('should insert field correctly after front positionals', () => {
    const baseField1 = new BaseField(TestFieldType.VERSION, Buffer.from('test'));
    const baseField2 = new BaseField(TestFieldType.SIGNATURE, Buffer.from('testing'));
    const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
    const newField = new BaseField(3, Buffer.from('new'));
    baseFields.insertFieldAfterFrontPositionals(newField);
    expect(baseFields.all).toEqual([baseField1, newField, baseField2]);
  });

  it('should insert field correctly before back positionals', () => {
    const baseField1 = new BaseField(TestFieldType.VERSION, Buffer.alloc(1));
    const baseField2 = new BaseField(TestFieldType.SIGNATURE, Buffer.from('testing'));
    const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
    const newField = new BaseField(3, Buffer.from('new'));
    baseFields.insertFieldBeforeBackPositionals(newField);
    expect(baseFields.all).toEqual([baseField1, newField, baseField2]);
  });

  it('should insert field correctly before existing field of specified type', () => {
    const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
    const baseField2 = new BaseField(TestFieldType.VERSION, Buffer.alloc(1));
    const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
    const newField = new BaseField(3, Buffer.from('new'));
    baseFields.insertFieldBefore(TestFieldType.VERSION, newField);
    expect(baseFields.all).toEqual([baseField1, newField, baseField2]);
  });

  it('should append field correctly if no existing field of specified type', () => {
    const baseField1 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('test'));
    const baseField2 = new BaseField(TestFieldType.PAYLOAD, Buffer.from('testing'));
    const baseFields = new BaseFields([baseField1, baseField2], testFieldDefinition);
    const newField = new BaseField(TestFieldType.PAYLOAD, Buffer.from('new'));
    baseFields.insertFieldBefore(TestFieldType.VERSION, newField);
    expect(baseFields.all).toEqual([baseField1, baseField2, newField]);
  });

  it('can insert fields between positionals', () => {
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
    expect(fields.all[2].value[0]).toEqual(42);
    expect(fields.all[3].type).toEqual(TestFieldType.SIGNATURE);
    expect(fields.all[4].type).toEqual(TestFieldType.NONCE);
    fields.insertFieldBeforeBackPositionals(payload2);
    expect(fields.length).toEqual(6);
    expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
    expect(fields.all[1].type).toEqual(TestFieldType.DATE);
    expect(fields.all[2].type).toEqual(TestFieldType.PAYLOAD);
    expect(fields.all[2].value[0]).toEqual(42);
    expect(fields.all[3].type).toEqual(TestFieldType.PAYLOAD);
    expect(fields.all[3].value[0]).toEqual(84);
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
