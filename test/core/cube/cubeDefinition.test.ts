import { coreCubeFamily } from "../../../src/core/cube/cube";
import { CubeFieldLength, CubeFieldType, CubeType, FrozenCorePositionalFront, FrozenNotifyPositionalBack, FrozenPositionalBack, MucCorePositionalFront, MucNotifyPositionalBack, MucPositionalBack, PicCorePositionalFront, PicNotifyPositionalBack, PicPositionalBack, PmucCorePositionalFront, PmucNotifyPositionalBack, PmucPositionalBack } from "../../../src/core/cube/cube.definitions";
import { enumNums } from "../../../src/core/helpers/misc";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

describe('Cube field definitions', () => {
  describe('field sizes', () => {
    test('field sizes for plain FROZEN Cubes should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.FROZEN_RAWCONTENT],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for FROZEN Cubes with NOTIFY should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.FROZEN_NOTIFY_RAWCONTENT],
        CubeFieldLength[CubeFieldType.NOTIFY],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for PIC Cubes should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.PIC_RAWCONTENT],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for PIC Cubes with NOTIFY should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.PIC_NOTIFY_RAWCONTENT],
        CubeFieldLength[CubeFieldType.NOTIFY],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for MUC Cubes should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.MUC_RAWCONTENT],
        CubeFieldLength[CubeFieldType.PUBLIC_KEY],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.SIGNATURE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for MUC Cubes with NOTIFY should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.MUC_NOTIFY_RAWCONTENT],
        CubeFieldLength[CubeFieldType.NOTIFY],
        CubeFieldLength[CubeFieldType.PUBLIC_KEY],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.SIGNATURE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for PMUC Cubes should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.PMUC_RAWCONTENT],
        CubeFieldLength[CubeFieldType.PMUC_UPDATE_COUNT],
        CubeFieldLength[CubeFieldType.PUBLIC_KEY],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.SIGNATURE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for PMUC Cubes with NOTIFY should add up to the total Cube size', () => {
      const fieldSizes = [
        CubeFieldLength[CubeFieldType.TYPE],
        CubeFieldLength[CubeFieldType.PMUC_NOTIFY_RAWCONTENT],
        CubeFieldLength[CubeFieldType.NOTIFY],
        CubeFieldLength[CubeFieldType.PMUC_UPDATE_COUNT],
        CubeFieldLength[CubeFieldType.PUBLIC_KEY],
        CubeFieldLength[CubeFieldType.DATE],
        CubeFieldLength[CubeFieldType.SIGNATURE],
        CubeFieldLength[CubeFieldType.NONCE],
      ];
      expect(fieldSizes.reduce((a, b) => a + b)).toBe(NetConstants.CUBE_SIZE);
    });
  });

  describe('positional field definitions', () => {
    enumNums(CubeType).forEach((type) => {  // perform the tests for every CubeType
      test(`field sizes for plain ${CubeType[type]} Cubes should add up to the total Cube size`, () => {
        let size: number = 0;
        const fields = [
          ...Object.values(coreCubeFamily.parsers[type].fieldDef.positionalFront),
          ...Object.values(coreCubeFamily.parsers[type].fieldDef.positionalBack),
        ];
        for (const field of fields) {
          size += CubeFieldLength[field];
        }
        expect(size).toBe(NetConstants.CUBE_SIZE);
      });
    });
  });
});
