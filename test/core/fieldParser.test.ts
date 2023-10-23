import { NetConstants } from "../../src/core/networking/networkDefinitions";

import { FieldDefinition, FieldNumericalParam, FieldParser, PositionalFields } from "../../src/core/fieldParser";
import { CubeField, CubeFieldType, CubeFields, CubeRelationshipType, CubeRelationship } from "../../src/core/cube/cubeFields";
import { BaseField } from "../../src/core/cube/baseFields";
import { BinaryDataError, FieldError } from "../../src/core/cube/cubeDefinitions";

import { ZwField, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType, zwFieldDefinition } from '../../src/app/zwFields';

describe('fieldParser', () => {
  describe('positional field tests with synthetic field description', () => {
    // any similarities with CubeFieldTypes, living or dead, are purely coincidental
    enum TestFieldType {
      NONCE = 0x00 << 2,
      PAYLOAD = 0x01 << 2,
      SIGNATURE = 0x06 << 2,
      VERSION = 0x101,
      DATE = 0x102,
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
      firstFieldOffset: 0,
    }
    let fieldParser: FieldParser;
    let version: BaseField, date: BaseField, sig: BaseField, nonce: BaseField, payload: BaseField;

    beforeAll(() => {
      // prepare the field parser
      fieldParser = new FieldParser(testFieldDefinition);

      // prepare some fields
      const versiondata = Buffer.alloc(1); versiondata.writeUint8(42);
      version = new BaseField(
        TestFieldType.VERSION, TestFieldLength[TestFieldType.VERSION], versiondata);

      const datedata = Buffer.alloc(5); datedata.writeUIntBE(1696000000, 0, 5);
      date = new BaseField(
        TestFieldType.DATE, TestFieldLength[TestFieldType.DATE], datedata
      );

      const sigdata = Buffer.alloc(5); sigdata.writeUIntBE(3392000000, 0, 5);  // I think double the time makes for a good signature
      sig = new BaseField(
        TestFieldType.SIGNATURE, TestFieldLength[TestFieldType.SIGNATURE], sigdata
      );

      const noncedata = Buffer.alloc(4); noncedata.writeUIntBE(848000000, 0, 4);  // I think half the time makes for a good nonce
      nonce = new BaseField(
        TestFieldType.NONCE, TestFieldLength[TestFieldType.NONCE], noncedata
      );

      const payloaddata = Buffer.alloc(137); payloaddata.fill(42);
      payload = new BaseField(TestFieldType.PAYLOAD, 137, payloaddata);
    });

    it('correctly parses valid binary data consisting only of positional fields', () => {
      const fields: BaseField[] = [];
      fields.push(version);
      fields.push(date);
      fields.push(sig);
      fields.push(nonce);
      const binaryData = fieldParser.compileFields(fields);
      expect(binaryData.length).toEqual(15);

      const restored: BaseField[] = fieldParser.decompileFields(binaryData);
      expect(restored.length).toEqual(4);
      expect(restored[0].equals(fields[0])).toBeTruthy();
      expect(restored[1].equals(fields[1])).toBeTruthy();
      expect(restored[2].equals(fields[2])).toBeTruthy();
      expect(restored[3].equals(fields[3])).toBeTruthy();
    });

    it('correctly parses valid binary data including optional, non-positional fields', () => {
      const fields: BaseField[] = [];
      fields.push(version);
      fields.push(date);
      fields.push(payload);
      fields.push(sig);
      fields.push(nonce);
      const binaryData = fieldParser.compileFields(fields);
      expect(binaryData.length).toEqual(154);  // 15 + 137 + 2 for payload header

      const restored: BaseField[] = fieldParser.decompileFields(binaryData);
      expect(restored.length).toEqual(5);
      expect(restored[0].equals(fields[0])).toBeTruthy();
      expect(restored[1].equals(fields[1])).toBeTruthy();
      expect(restored[2].equals(fields[2])).toBeTruthy();
      expect(restored[3].equals(fields[3])).toBeTruthy();
      expect(restored[4].equals(fields[4])).toBeTruthy();
    });

    it('throws on compilation if front positional fields are in wrong order', () => {
      const fields: BaseField[] = [];
      fields.push(date);  // note wrong order
      fields.push(version);  // note wrong order
      fields.push(payload);
      fields.push(sig);
      fields.push(nonce);
      expect(() => fieldParser.compileFields(fields)).toThrow(FieldError);
    });

    it('throws on compilation if a front positional field is missing', () => {
      const fields: BaseField[] = [];
      fields.push(date);  // note missing version
      fields.push(payload);
      fields.push(sig);
      fields.push(nonce);
      expect(() => fieldParser.compileFields(fields)).toThrow(FieldError);
    });

    it('throws on compilation if back positional fields are in wrong order', () => {
      const fields: BaseField[] = [];
      fields.push(version);
      fields.push(date);
      fields.push(payload);
      fields.push(sig);  // note missing nonce
      expect(() => fieldParser.compileFields(fields)).toThrow(FieldError);
    });

    it('throws on compilation if a back positional field is missing', () => {
      const fields: BaseField[] = [];
      fields.push(version);
      fields.push(date);
      fields.push(payload);
      fields.push(nonce);  // note wrong order
      fields.push(sig);  // note wrong order
      expect(() => fieldParser.compileFields(fields)).toThrow(FieldError);
    });

    it('throws on decompilation if binary data is smaller than sum of back positional fields', () => {
      // Note: Currently does not throw if front positional fields do not fit.
      // In case of front positionals, it will in fact only throw if a field
      // is cut somewhere in the middle.
      // If binary data is too short, parser will just assume all back positionals
      // are there and then go on to parse front positionals as long as there's
      // binary data left.
      // maybe TODO fix that... it's as easy as adding an extra length check before
      // parsing the front fields, but do we want this extra check?
      const corrupt = Buffer.alloc(8);
      expect(() => fieldParser.decompileFields(corrupt)).toThrow(BinaryDataError);
    });
  });

  describe('standard cube field description', () => {
    it('should correctly compile and decompile top level fields', () => {
      const fieldParser: FieldParser = FieldParser.toplevel;
      const fields = new CubeFields();

      // define a few fields
      fields.appendField(
        CubeField.Payload("Mein kleiner grüner Kaktus")
      );
      fields.appendField(
        CubeField.RelatesTo(
          new CubeRelationship(CubeRelationshipType.CONTINUED_IN,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA))
        )
      );
      fields.appendField(
        CubeField.Payload("steht draußen am Balkon")
      );

      // compile and decompile
      const compiled: Buffer = fieldParser.compileFields(fields);
      const restoredarray: Array<CubeField> = fieldParser.decompileFields(compiled);
      const restored: CubeFields = new CubeFields(restoredarray);

      // compare
      expect(restored.getFieldCount()).toEqual(5);  // three explicit plus two auto-generated VERSION and DATE fields
      expect(restored.getFieldsByType(CubeFieldType.PAYLOAD).length).toEqual(2);
      expect(restored.getFieldsByType(CubeFieldType.RELATES_TO).length).toEqual(1);
      expect(
        restored.getFirstField(CubeFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Mein kleiner grüner Kaktus");
      const restoredrel = CubeRelationship.fromField(restored.getFirstField(CubeFieldType.RELATES_TO));
      expect(restoredrel.type).toEqual(CubeRelationshipType.CONTINUED_IN);
      expect(restoredrel.remoteKey[0]).toEqual(0xDA);
    });
  });

  describe('deprecated', () => {
    it('should correctly compile and decompile ZW fields', () => {
      const fieldParser: FieldParser = new FieldParser(zwFieldDefinition);
      const fields = new ZwFields();

      // define a few fields
      fields.appendField(
        ZwField.Payload("Mein kleiner grüner Kaktus")
      );
      fields.appendField(
        ZwField.RelatesTo(
          new CubeRelationship(ZwRelationshipType.MYPOST,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA))
        )
      );
      fields.appendField(
        ZwField.Payload("steht draußen am Balkon")
      );

      // compile and decompile
      const compiled: Buffer = fieldParser.compileFields(fields);
      const restoredarray: Array<ZwField> = fieldParser.decompileFields(compiled);
      const restored: ZwFields = new ZwFields(restoredarray);

      // compare
      expect(restored.getFieldCount()).toEqual(3);
      expect(restored.getFieldsByType(ZwFieldType.PAYLOAD).length).toEqual(2);
      expect(restored.getFieldsByType(ZwFieldType.RELATES_TO).length).toEqual(1);
      expect(
        restored.getFirstField(ZwFieldType.PAYLOAD).value.toString('utf-8')).
        toEqual("Mein kleiner grüner Kaktus");
      const restoredrel = ZwRelationship.fromField(restored.getFirstField(ZwFieldType.RELATES_TO));
      expect(restoredrel.type).toEqual(ZwRelationshipType.MYPOST);
      expect(restoredrel.remoteKey[0]).toEqual(0xDA);
    });
  });
});