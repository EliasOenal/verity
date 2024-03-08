import { BaseField, BaseFields } from "../../src/core/cube/baseFields";
import { FieldNumericalParam, PositionalFields, FieldDefinition, FieldParser } from "../../src/core/fieldParser";

describe('fields', () => {
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

  it('can insert fields between positionals', () => {
    const fields = new BaseFields([version, date, nonce], testFieldDefinition);
    expect(fields.all.length).toEqual(3);
    expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
    expect(fields.all[1].type).toEqual(TestFieldType.DATE);
    expect(fields.all[2].type).toEqual(TestFieldType.NONCE);
    fields.insertFieldBeforeBackPositionals(sig);
    expect(fields.all.length).toEqual(4);
    expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
    expect(fields.all[1].type).toEqual(TestFieldType.DATE);
    expect(fields.all[2].type).toEqual(TestFieldType.SIGNATURE);
    expect(fields.all[3].type).toEqual(TestFieldType.NONCE);
    fields.insertFieldAfterFrontPositionals(payload);
    expect(fields.all.length).toEqual(5);
    expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
    expect(fields.all[1].type).toEqual(TestFieldType.DATE);
    expect(fields.all[2].type).toEqual(TestFieldType.PAYLOAD);
    expect(fields.all[2].value[0]).toEqual(42);
    expect(fields.all[3].type).toEqual(TestFieldType.SIGNATURE);
    expect(fields.all[4].type).toEqual(TestFieldType.NONCE);
    fields.insertFieldBeforeBackPositionals(payload2);
    expect(fields.all.length).toEqual(6);
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
    expect(fields.all.length).toEqual(0);
    fields.insertFieldAfterFrontPositionals(payload);
    expect(fields.all.length).toEqual(1);
    expect(fields.all[0].type).toEqual(TestFieldType.PAYLOAD);
  });
  it('can insert fields before back positionals even on empty field set', () => {
    const fields = new BaseFields([], testFieldDefinition);
    expect(fields.all.length).toEqual(0);
    fields.insertFieldBeforeBackPositionals(payload);
    expect(fields.all.length).toEqual(1);
    expect(fields.all[0].type).toEqual(TestFieldType.PAYLOAD);
  });
  it('will perform insertion after front positionals at very beginning if there are no front positionals', () => {
    const fields = new BaseFields([nonce], testFieldDefinition);
    expect(fields.all.length).toEqual(1);
    expect(fields.all[0].type).toEqual(TestFieldType.NONCE);
    fields.insertFieldAfterFrontPositionals(payload);
    expect(fields.all.length).toEqual(2);
    expect(fields.all[0].type).toEqual(TestFieldType.PAYLOAD);
    expect(fields.all[1].type).toEqual(TestFieldType.NONCE);
  });
  it('will perform insertion before back positionals at the very end if there are no back positionals', () => {
    const fields = new BaseFields([version], testFieldDefinition);
    expect(fields.all.length).toEqual(1);
    expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
    fields.insertFieldBeforeBackPositionals(payload);
    expect(fields.all.length).toEqual(2);
    expect(fields.all[0].type).toEqual(TestFieldType.VERSION);
    expect(fields.all[1].type).toEqual(TestFieldType.PAYLOAD);
  });


  // TODO move to CCI
  // it('correctly sets and retrieves a reply_to relationship field', async () => {
  //   const root: Cube = new Cube(); // will only be used as referenc
  //   const payloadfield: CubeField = CubeField.Payload(Buffer.alloc(200));
  //   root.setFields(payloadfield);

  //   const leaf: Cube = new Cube();

  //   leaf.setFields(new CubeFields([
  //     payloadfield,
  //     CubeField.RelatesTo(new CubeRelationship(
  //       CubeRelationshipType.REPLY_TO, (await root.getKey())))
  //   ]));

  //   const retrievedRel: CubeRelationship = leaf.fields.getFirstRelationship();
  //   expect(retrievedRel.type).toEqual(CubeRelationshipType.REPLY_TO);
  //   expect(retrievedRel.remoteKey.toString('hex')).toEqual((await root.getKey()).toString('hex'));
  // }, 3000);
});
