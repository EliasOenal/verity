import { CubeFieldType, CubeType, RawcontentFieldType } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields } from "../../../src/core/cube/cubeFields";
import { enumNums } from "../../../src/core/helpers/misc";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import type { FieldParser } from "../../../src/core/fields/fieldParser";
import { coreCubeFamily } from "../../../src/core/cube/cube";

describe('CubeFields compilation and decompilation using rawCubeFamily', () => {
  enumNums(CubeType).forEach((type) => {  // perform the tests for every CubeType
    describe(`CubeType.${CubeType[type]}`, () => {
      let cubeFields: CubeFields;
      let binaryData: Buffer;
      let parser: FieldParser;

      beforeEach(() => {
        // Create sample CubeFields based on the specific CubeType
        parser = coreCubeFamily.parsers[type];
        cubeFields = new CubeFields([CubeField.Type(type)], parser.fieldDef);

        // Add fields based on CubeType
        switch (type) {
          case CubeType.FROZEN:
          case CubeType.PIC:
            cubeFields.appendField(CubeField.RawContent(type, "Raw content"));
            cubeFields.appendField(CubeField.Date());
            break;
          case CubeType.FROZEN_NOTIFY:
          case CubeType.PIC_NOTIFY:
            cubeFields.appendField(CubeField.RawContent(type, "Raw content"));
            cubeFields.appendField(CubeField.Notify(Buffer.alloc(NetConstants.NOTIFY_SIZE, 42)));
            cubeFields.appendField(CubeField.Date());
            break;
          case CubeType.MUC:
            cubeFields.appendField(CubeField.RawContent(type, "Raw content"));
            cubeFields.appendField(CubeField.PublicKey(Buffer.alloc(32, 147)));
            cubeFields.appendField(CubeField.Date());
            cubeFields.appendField(CubeField.Signature());
            break;
          case CubeType.MUC_NOTIFY:
            cubeFields.appendField(CubeField.RawContent(type, "Raw content"));
            cubeFields.appendField(CubeField.Notify(Buffer.alloc(NetConstants.NOTIFY_SIZE, 42)));
            cubeFields.appendField(CubeField.PublicKey(Buffer.alloc(32, 147)));
            cubeFields.appendField(CubeField.Date());
            cubeFields.appendField(CubeField.Signature());
            break;
          case CubeType.PMUC:
            cubeFields.appendField(CubeField.RawContent(type, "Raw content"));
            cubeFields.appendField(CubeField.PmucUpdateCount(137)),
            cubeFields.appendField(CubeField.PublicKey(Buffer.alloc(32, 1)));
            cubeFields.appendField(CubeField.Date());
            cubeFields.appendField(CubeField.Signature());
            break;
          case CubeType.PMUC_NOTIFY:
            cubeFields.appendField(CubeField.RawContent(type, "Raw content"));
            cubeFields.appendField(CubeField.Notify(Buffer.alloc(NetConstants.NOTIFY_SIZE, 42)));
            cubeFields.appendField(CubeField.PmucUpdateCount(137)),
            cubeFields.appendField(CubeField.PublicKey(Buffer.alloc(32, 1)));
            cubeFields.appendField(CubeField.Date());
            cubeFields.appendField(CubeField.Signature());
            break;
        }
        cubeFields.appendField(CubeField.Nonce());

        // Compile CubeFields to binary
        binaryData = parser.compileFields(cubeFields);
      });

      test('should compile CubeFields to binary of correct size', () => {
        expect(binaryData).toBeInstanceOf(Buffer);
        expect(binaryData.length).toBe(NetConstants.CUBE_SIZE);
      });

      test('should decompile binary back to CubeFields', () => {
        const decompiledFields = parser.decompileFields(binaryData);
        expect(decompiledFields).toBeInstanceOf(CubeFields);
        expect(decompiledFields.length).toBe(cubeFields.length);
      });

      test('should preserve field types and order after compilation and decompilation', () => {
        const decompiledFields = parser.decompileFields(binaryData);
        cubeFields.all.forEach((field, index) => {
          expect(decompiledFields.all[index].type).toBe(field.type);
        });
      });

      test('should preserve field values after compilation and decompilation', () => {
        const decompiledFields = parser.decompileFields(binaryData);
        cubeFields.all.forEach((field, index) => {
          expect(decompiledFields.all[index].value.toString()).toBe(field.value.toString());
        });
      });

      test('should correctly handle RAW_CONTENT field', () => {
        const decompiledFields = parser.decompileFields(binaryData);
        const rawContentType = RawcontentFieldType[type];
        const originalRawContent = cubeFields.getFirst(rawContentType);
        const decompiledRawContent = decompiledFields.getFirst(rawContentType);
        expect(decompiledRawContent.value.toString()).toBe(originalRawContent.value.toString());
      });

      if (type === CubeType.MUC || type === CubeType.MUC_NOTIFY ||
          type === CubeType.PMUC || type === CubeType.PMUC_NOTIFY) {
        test('should correctly handle PublicKey field', () => {
          const decompiledFields = parser.decompileFields(binaryData);
          const originalPublicKey = cubeFields.getFirst(CubeFieldType.PUBLIC_KEY);
          const decompiledPublicKey = decompiledFields.getFirst(CubeFieldType.PUBLIC_KEY);
          expect(decompiledPublicKey.value.toString('hex')).toBe(originalPublicKey.value.toString('hex'));
        });

        test('should correctly handle Signature field', () => {
          const decompiledFields = parser.decompileFields(binaryData);
          expect(decompiledFields.getFirst(CubeFieldType.SIGNATURE)).toBeDefined();
        });
      }

      if (type === CubeType.FROZEN_NOTIFY || type === CubeType.PIC_NOTIFY ||
          type === CubeType.MUC_NOTIFY || type === CubeType.PMUC_NOTIFY) {
        test('should correctly handle Notify field', () => {
          const decompiledFields = parser.decompileFields(binaryData);
          const originalNotify = cubeFields.getFirst(CubeFieldType.NOTIFY);
          const decompiledNotify = decompiledFields.getFirst(CubeFieldType.NOTIFY);
          expect(decompiledNotify.value.toString()).toBe(originalNotify.value.toString());
        });
      }

      if (type === CubeType.PMUC || type === CubeType.PMUC_NOTIFY) {
        test('should correctly handle PMUC_UPDATE_COUNT field', () => {
          const decompiledFields = parser.decompileFields(binaryData);
          const originalUpdateCount = cubeFields.getFirst(CubeFieldType.PMUC_UPDATE_COUNT);
          const decompiledUpdateCount = decompiledFields.getFirst(CubeFieldType.PMUC_UPDATE_COUNT);
          expect(decompiledUpdateCount.value.toString('hex')).toBe(originalUpdateCount.value.toString('hex'));
        });
      }
    });
  });
});
