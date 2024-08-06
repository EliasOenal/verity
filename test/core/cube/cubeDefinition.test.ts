import { CubeFieldLength, CubeFieldType } from "../../../src/core/cube/cubeField";
import { RawFrozenFields, RawFrozenFieldsWithNotify, RawMucFields, RawMucFieldsWithNotify, RawPicFields, RawPicFieldsWithNotify } from "../../../src/core/cube/fieldDefinitions";
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
    test('field sizes for plain FROZEN Cubes should add up to the total Cube size', () => {
      let size: number = 0;
      for (const field of Object.values(RawFrozenFields)) {
        size += CubeFieldLength[field];
      }
      expect(size).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for FROZEN Cubes with NOTIFY should add up to the total Cube size', () => {
      let size: number = 0;
      for (const field of Object.values(RawFrozenFieldsWithNotify)) {
        size += CubeFieldLength[field];
      }
      expect(size).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for PIC Cubes should add up to the total Cube size', () => {
      let size: number = 0;
      for (const field of Object.values(RawPicFields)) {
        size += CubeFieldLength[field];
      }
      expect(size).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for PIC Cubes with NOTIFY should add up to the total Cube size', () => {
      let size: number = 0;
      for (const field of Object.values(RawPicFieldsWithNotify)) {
        size += CubeFieldLength[field];
      }
      expect(size).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for MUC Cubes should add up to the total Cube size', () => {
      let size: number = 0;
      for (const field of Object.values(RawMucFields)) {
        size += CubeFieldLength[field];
      }
      expect(size).toBe(NetConstants.CUBE_SIZE);
    });

    test('field sizes for MUC Cubes with NOTIFY should add up to the total Cube size', () => {
      let size: number = 0;
      for (const field of Object.values(RawMucFieldsWithNotify)) {
        size += CubeFieldLength[field];
      }
      expect(size).toBe(NetConstants.CUBE_SIZE);
    });

  });
});
