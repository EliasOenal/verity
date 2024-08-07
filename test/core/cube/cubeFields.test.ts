import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields, CoreFrozenFieldDefinition, CoreMucFieldDefinition } from "../../../src/core/cube/cubeFields";
import { CubeFieldType, CubeType } from "../../../src/core/cube/cube.definitions";

describe('CubeFields', () => {
  describe('static creation methods', () => {
    describe('static method Frozen', () => {
      it('should create a valid frozen cube field set', () => {
        const fields = CubeFields.Frozen();
        expect(fields.all.length).toBe(4); // 3 mandatory fields for frozen cubes
        expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
        expect(fields.all[1].type).toBe(CubeFieldType.FROZEN_RAWCONTENT);
        expect(fields.all[2].type).toBe(CubeFieldType.DATE);
        expect(fields.all[3].type).toBe(CubeFieldType.NONCE);
      });

      it('should be idempotent', () => {
        const origFields = CubeFields.Frozen();
        const doubleFields = CubeFields.Frozen(origFields);
        expect(origFields.equals(doubleFields, true)).toBeTruthy();
      });

      it('should upgrade an incomplete field set', () => {
        const date = 148302000;  // viva Malta repubblika!
        const dateField = CubeField.Date(date);
        const incomplete = new CubeFields(dateField, CoreFrozenFieldDefinition);
        expect(incomplete.all.length).toBe(1);
        const fields = CubeFields.Frozen(incomplete);
        expect(fields.all.length).toBe(4); // 3 mandatory fields for frozen cubes
        expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
        expect(fields.all[1].type).toBe(CubeFieldType.FROZEN_RAWCONTENT);
        expect(fields.all[2].type).toBe(CubeFieldType.DATE);
        expect(fields.all[3].type).toBe(CubeFieldType.NONCE);
      });
    });

    describe('static method MUC', () => {
      it.only('should create a valid MUC field set', () => {
        const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 42); // example public key
        const fields = CubeFields.Muc(publicKey);
        expect(fields.all.length).toBe(6); // 5 mandatory fields for MUC cubes
        expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
        expect(fields.all[1].type).toBe(CubeFieldType.MUC_RAWCONTENT);
        expect(fields.all[2].type).toBe(CubeFieldType.PUBLIC_KEY);
        expect(fields.all[3].type).toBe(CubeFieldType.DATE);
        expect(fields.all[4].type).toBe(CubeFieldType.SIGNATURE);
        expect(fields.all[5].type).toBe(CubeFieldType.NONCE);
        expect(fields.all[2].value).toBe(publicKey);  // pubkey correctly set
      });

      it('should be idempotent', () => {
        const mockKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE).fill(42);
        const origFields = CubeFields.Muc(mockKey);
        const doubleFields = CubeFields.Muc(mockKey, origFields);
        expect(origFields.equals(doubleFields, true)).toBeTruthy();
      });

      it('can upgrade an incomplete field set to a MUC field set', () => {
        const frozenFields = new CubeFields(
          [
            CubeField.RawContent(CubeType.MUC, "Cubus camporum incompletorum"),
          ],
          CoreMucFieldDefinition
        )
        const mockKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE).fill(42);
        const mucFields = CubeFields.Muc(mockKey, frozenFields);
        expect(mucFields.all.length).toBe(6); // 5 mandatory fields for MUC cubes
        expect(mucFields.all[0].type).toBe(CubeFieldType.TYPE);
        expect(mucFields.all[1].type).toBe(CubeFieldType.MUC_RAWCONTENT);
        expect(mucFields.all[2].type).toBe(CubeFieldType.PUBLIC_KEY);
        expect(mucFields.all[3].type).toBe(CubeFieldType.DATE);
        expect(mucFields.all[4].type).toBe(CubeFieldType.SIGNATURE);
        expect(mucFields.all[5].type).toBe(CubeFieldType.NONCE);
        expect(mucFields.all[2].value).toBe(mockKey);  // pubkey correctly set
      });
    });
  });
});
