import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeFieldType, CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields, coreFrozenFieldDefinition } from "../../../src/core/cube/cubeFields";
import { Settings } from "../../../src/core/settings";

describe('CubeFields', () => {
  describe('static creation methods', () => {
    describe('static method Frozen', () => {
      it('should create a valid frozen cube field set', () => {
        const fields = CubeFields.Frozen();
        expect(fields.all.length).toBe(3); // 3 mandatory fields for frozen cubes
        expect(fields.getFirst(CubeFieldType.TYPE)).toBeDefined();
        expect(fields.getFirst(CubeFieldType.DATE)).toBeDefined();
        expect(fields.getFirst(CubeFieldType.NONCE)).toBeDefined();
      });

      it('should be idempotent', () => {
        const origFields = CubeFields.Frozen();
        const doubleFields = CubeFields.Frozen(origFields);
        expect(origFields.equals(doubleFields, true)).toBeTruthy();
      });

      it('should upgrade an incomplete field set', () => {
        const date = 148302000;  // viva Malta repubblika!
        const dateField = CubeField.Date(date);
        const incomplete = new CubeFields(dateField, coreFrozenFieldDefinition);
        expect(incomplete.all.length).toBe(1);
        const fields = CubeFields.Frozen(incomplete);
        expect(fields.all.length).toBe(3); // 3 mandatory fields for frozen cubes
        expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
        expect(fields.all[1].type).toBe(CubeFieldType.DATE);
        expect(fields.all[2].type).toBe(CubeFieldType.NONCE);
      });
    });

    describe('static method MUC', () => {
      it('should create a valid MUC field set', () => {
        const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE); // example public key
        const fields = CubeFields.Muc(publicKey);
        expect(fields.all.length).toBe(5); // 5 mandatory fields for MUC cubes
        expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
        expect(fields.all[1].type).toBe(CubeFieldType.PUBLIC_KEY);
        expect(fields.all[2].type).toBe(CubeFieldType.DATE);
        expect(fields.all[3].type).toBe(CubeFieldType.SIGNATURE);
        expect(fields.all[4].type).toBe(CubeFieldType.NONCE);
        expect(fields.all[1].value).toBe(publicKey);  // pubkey correctly set
      });

      it('should be idempotent', () => {
        const mockKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE).fill(42);
        const origFields = CubeFields.Muc(mockKey);
        const doubleFields = CubeFields.Muc(mockKey, origFields);
        expect(origFields.equals(doubleFields, true)).toBeTruthy();
      });

      it('can upgrade a frozen field set to a MUC field set', () => {
        const frozenFields = CubeFields.Frozen();
        const mockKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE).fill(42);
        const mucFields = CubeFields.Muc(mockKey, frozenFields);
        expect(mucFields.all.length).toBe(5); // 5 mandatory fields for MUC cubes
        expect(mucFields.all[0].type).toBe(CubeFieldType.TYPE);
        expect(mucFields.all[1].type).toBe(CubeFieldType.PUBLIC_KEY);
        expect(mucFields.all[2].type).toBe(CubeFieldType.DATE);
        expect(mucFields.all[3].type).toBe(CubeFieldType.SIGNATURE);
        expect(mucFields.all[4].type).toBe(CubeFieldType.NONCE);
        expect(mucFields.all[1].value).toBe(mockKey);  // pubkey correctly set
      });
    });
  });

  describe('insertTillFull', () => {
    it('should insert fields until cube is full', () => {
      const fields = new CubeFields([], coreFrozenFieldDefinition);
      const latinBraggery = "Nullo campo iterari in aeternum potest";
      const field = CubeField.Payload(latinBraggery);
      const spaceAvailable = NetConstants.CUBE_SIZE;
      const spacePerField = NetConstants.FIELD_TYPE_SIZE + NetConstants.FIELD_LENGTH_SIZE + latinBraggery.length;
      const fittingFieldCount = Math.floor(spaceAvailable / spacePerField);
      const insertedCount = fields.insertTillFull([field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field, field]);
      expect(insertedCount).toBe(fittingFieldCount);
      expect(fields.length).toBe(fittingFieldCount);

      // cube already full, should not fit more fields
      const insertedCount2 = fields.insertTillFull([field, field, field, field, field, field, field, field, field, field, field, field]);
      expect(insertedCount2).toBe(0);
    });
  });
});
