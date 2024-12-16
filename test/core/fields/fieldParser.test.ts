import { FieldDefinition, FieldNumericalParam, FieldParser, PositionalFields } from "../../../src/core/fields/fieldParser";

import { BaseField } from "../../../src/core/fields/baseField";
import { BaseFields } from "../../../src/core/fields/baseFields";

import { BinaryDataError, CubeFieldType, CubeType, FieldError } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { cciFields, cciFrozenFieldDefinition, cciFrozenParser } from "../../../src/cci/cube/cciFields";
import { cciField } from "../../../src/cci/cube/cciField";
import { cciFieldType } from "../../../src/cci/cube/cciCube.definitions";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('fieldParser', () => {
  describe('positional field tests with synthetic field description', () => {
    // any similarities with CubeFieldTypes, living or dead, are purely coincidental
    enum TestFieldType {
      NONCE = 0,
      PAYLOAD = 4,
      SIGNATURE = 24,
      STOP = 44,
      VERSION = 257,
      DATE = 258,
      REMAINDER = 1337,
    }
    const TestFieldLength: FieldNumericalParam = {
      [TestFieldType.NONCE]: 4,
      [TestFieldType.PAYLOAD]: undefined,
      [TestFieldType.SIGNATURE]: 5,
      [TestFieldType.STOP]: undefined,  // using a TLV stop field just because CCI doesn't
      [TestFieldType.VERSION]: 1,
      [TestFieldType.DATE]: 5,
      [TestFieldType.REMAINDER]: undefined,  // virtual field
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
    let version: BaseField, date: BaseField, sig: BaseField, nonce: BaseField, payload: BaseField, stop: BaseField;

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

      const stopdata = Buffer.from("Hic siste interpretari");
      stop = new BaseField(TestFieldType.STOP, stopdata);
    });

    describe('general parsing and field handling', () => {
      describe('compileFields()', () => {
        it('throws on overly large field type codes', () => {
          const fields: BaseField[] = [
            new BaseField(31337, Buffer.from('test')),
          ];
          expect(() => fieldParser.compileFields(fields)).toThrow(FieldError);
        });

        it('throws on overly large field lengths', () => {
          const fields: BaseField[] = [
            new BaseField(42, Buffer.alloc(31337)),
          ];
          expect(() => fieldParser.compileFields(fields)).toThrow(FieldError);
        });
      });
      describe('decompileFields() and round-trip compile/decompile tests', () => {
        it('correctly parses valid binary data including both positional and TLV fields', () => {
          const fields: BaseField[] = [];
          fields.push(version);
          fields.push(date);
          fields.push(payload);
          fields.push(sig);
          fields.push(nonce);
          const binaryData = fieldParser.compileFields(fields);

          const restored: BaseFields = fieldParser.decompileFields(binaryData);
          expect(restored.all.length).toEqual(5);
          expect(restored.all[0].equals(fields[0], true)).toBeTruthy();
          expect(restored.all[1].equals(fields[1], true)).toBeTruthy();
          expect(restored.all[2].equals(fields[2], true)).toBeTruthy();
          expect(restored.all[3].equals(fields[3], true)).toBeTruthy();
          expect(restored.all[4].equals(fields[4], true)).toBeTruthy();
        });

        it('throws on decompiling invalid TLV field by default', () => {
          const fields: BaseField[] = [];
          fields.push(version);
          fields.push(date);
          fields.push(new BaseField(42, Buffer.alloc(10, 0)));  // note there is no TLV field 42
          fields.push(sig);
          fields.push(nonce);
          // Note: in the current implementation, it's not a problem to compile
          // an invalid field. We just won't be able to decompile this.
          // If the implementation ever changes or if we add a sanity check
          // on compilation (which we maybe should), amend this test.
          const binaryData = fieldParser.compileFields(fields);
          expect(() => fieldParser.decompileFields(binaryData)).toThrow(FieldError);
        });

        it('does not throw on invalid TLV field if TLV field parsing is disabled', () => {
          fieldParser.decompileTlv = false;
          const binaryData = Buffer.from([
            // Cube version (0) and type (basic "frozen" Cube, 0) (1 byte)
            0b00000000,
            // Date (5 bytes)
            0x00, 0x00, 0x00, 0x00, 0x00,

            // Invalid TLV field
            0xFA,       // no such field ID exists
            0x0A,       // Length: 10 bytes
            0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x77, 0x6F, 0x72, // Value: "Hello, wor"

            // Any padding (all zeros for instance) so we end up at 1024 bytes total
            ...Array.from({ length: 997 }, () => 0x00),

            0x01, 0x02, 0x03, 0x04, 0x05,  // 5 bytes "signature"
            0x00, 0x00, 0x37, 0x4D, // Nonce
          ])
          const restored: BaseFields = fieldParser.decompileFields(binaryData);
          expect(restored.all.length).toEqual(4);
          expect(restored.all[0].value.equals(Buffer.from([0]))).toBeTruthy();
          expect(restored.all[1].value.equals(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]))).toBeTruthy();
          expect(restored.all[2].value.equals(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]))).toBeTruthy();
          expect(restored.all[3].value.equals(Buffer.from([0x00, 0x00, 0x37, 0x4D]))).toBeTruthy();
        });

        it('stops parsing on encountering a stop field', () => {
          const fields: BaseField[] = [];
          fields.push(version);
          fields.push(date);
          fields.push(payload);
          fields.push(stop);
          fields.push(new BaseField(TestFieldType.PAYLOAD, Buffer.from("oh")));
          fields.push(new BaseField(TestFieldType.PAYLOAD, Buffer.from("lol")));
          fields.push(new BaseField(TestFieldType.PAYLOAD, Buffer.from("so")));
          fields.push(new BaseField(TestFieldType.PAYLOAD, Buffer.from("many")));
          fields.push(new BaseField(TestFieldType.PAYLOAD, Buffer.from("fields")));
          fields.push(sig);
          fields.push(nonce);
          expect(fields.length).toBe(11);  // just sanity-checking
          const binaryData = fieldParser.compileFields(fields);

          const restored: BaseFields = fieldParser.decompileFields(binaryData);
          expect(restored.all.length).toEqual(7);  // all but one PAYLOADs removed but one REMAINDER added
          expect(restored.all[0].equals(fields[0], true)).toBeTruthy();
          expect(restored.all[1].equals(fields[1], true)).toBeTruthy();
          expect(restored.all[2].equals(fields[2], true)).toBeTruthy();
          expect(restored.all[3].equals(fields[3], true)).toBeTruthy();  // stop still parsed

          // virtual remainder field inserted which contains all the skipped data
          expect(restored.all[4].type).toBe(TestFieldType.REMAINDER);
          expect(restored.all[4].valueString).toContain("oh");
          expect(restored.all[4].valueString).toContain("lol");
          expect(restored.all[4].valueString).toContain("so");
          expect(restored.all[4].valueString).toContain("many");
          expect(restored.all[4].valueString).toContain("fields");

          expect(restored.all[5].equals(fields[9], true)).toBeTruthy();  // back positionals still present
          expect(restored.all[6].equals(fields[10], true)).toBeTruthy();  // back positionals still present
        });
      });
    });

    describe('positional field handling', () => {
      it('correctly parses valid binary data consisting only of positional fields', () => {
        const fields: BaseField[] = [];
        fields.push(version);
        fields.push(date);
        fields.push(sig);
        fields.push(nonce);
        const binaryData = fieldParser.compileFields(fields);
        expect(binaryData.length).toEqual(15);

        const restored: BaseFields = fieldParser.decompileFields(binaryData);
        expect(restored.all.length).toEqual(4);
        expect(restored.all[0].value.equals(fields[0].value)).toBeTruthy();
        expect(restored.all[0].start).toEqual(fields[0].start);
        expect(restored.all[1].value.equals(fields[1].value)).toBeTruthy();
        expect(restored.all[1].start).toEqual(fields[1].start);
        expect(restored.all[2].value.equals(fields[2].value)).toBeTruthy();
        expect(restored.all[2].start).toEqual(fields[2].start);
        expect(restored.all[3].value.equals(fields[3].value)).toBeTruthy();
        expect(restored.all[3].start).toEqual(fields[3].start);
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
  });

  describe('core cube field', () => {
    it.todo("write tests")
  });

  describe('CCI fields', () => {
    it('should correctly compile and decompile CCI fields', () => {
      const fieldParser: FieldParser = cciFrozenParser;
      const fields = new cciFields(undefined, cciFrozenFieldDefinition);

      // define a few fields
      fields.appendField(CubeField.Type(CubeType.FROZEN));
      fields.appendField(
        cciField.Payload("Mein kleiner grüner Kaktus")
      );
      fields.appendField(
        cciField.Payload("steht draußen am Balkon")
      );
      fields.appendField(CubeField.Date());
      fields.appendField(CubeField.Nonce());

      // compile and decompile
      const compiled: Buffer = fieldParser.compileFields(fields);
      const restored: CubeFields = fieldParser.decompileFields(compiled) as CubeFields;

      // compare
      expect(restored.length).toEqual(5);
      expect(restored.get(cciFieldType.PAYLOAD).length).toEqual(2);
      expect(
        restored.get(cciFieldType.PAYLOAD)[0].value.toString('utf-8')).
        toEqual("Mein kleiner grüner Kaktus");
      expect(
        restored.get(cciFieldType.PAYLOAD)[1].value.toString('utf-8')).
        toEqual("steht draußen am Balkon");
    });

    // TODO: rewrite tests for CCI or get rid of them
    // it('should correctly compile and decompile ZW fields', () => {
    //   const fieldParser: FieldParser = new FieldParser(zwFieldDefinition);
    //   const fields = new ZwFields();

    //   // define a few fields
    //   fields.appendField(
    //     ZwField.Payload("Mein kleiner grüner Kaktus")
    //   );
    //   fields.appendField(
    //     ZwField.RelatesTo(
    //       new CubeRelationship(ZwRelationshipType.MYPOST,
    //       Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA))
    //     )
    //   );
    //   fields.appendField(
    //     ZwField.Payload("steht draußen am Balkon")
    //   );

    //   // compile and decompile
    //   const compiled: Buffer = fieldParser.compileFields(fields);
    //   const restoredarray: Array<ZwField> = fieldParser.decompileFields(compiled);
    //   const restored: ZwFields = new ZwFields(restoredarray);

    //   // compare
    //   expect(restored.count()).toEqual(3);
    //   expect(restored.get(ZwFieldType.PAYLOAD).length).toEqual(2);
    //   expect(restored.get(ZwFieldType.RELATES_TO).length).toEqual(1);
    //   expect(
    //     restored.getFirst(ZwFieldType.PAYLOAD).value.toString('utf-8')).
    //     toEqual("Mein kleiner grüner Kaktus");
    //   const restoredrel = ZwRelationship.fromField(restored.getFirst(ZwFieldType.RELATES_TO));
    //   expect(restoredrel.type).toEqual(ZwRelationshipType.MYPOST);
    //   expect(restoredrel.remoteKey[0]).toEqual(0xDA);
    // });
  });
});
