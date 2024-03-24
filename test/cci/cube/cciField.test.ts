import { cciField, cciFieldType, MediaTypes } from "../../../src/cci/cube/cciField";
import { FieldError } from "../../../src/core/cube/cubeDefinitions";
import { CubeFieldType, CubeField } from "../../../src/core/cube/cubeField";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

describe('cciField', () => {
  describe('constructor', () => {
    it('should construct a cciField for types with no fixed length', () => {
      const type = CubeFieldType.APPLICATION;
      const value = Buffer.alloc(10); // Arbitrary buffer length for APPLICATION
      expect(() => new cciField(type, value)).not.toThrow();
    });

    it('should construct a cciField with fixed length', () => {
      const type = CubeFieldType.MEDIA_TYPE;
      const value = Buffer.alloc(1);
      expect(() => new cciField(type, value)).not.toThrow();
    });

    it('should throw error for invalid length', () => {
      const type = CubeFieldType.MEDIA_TYPE;
      const value = Buffer.alloc(20); // Arbitrary buffer length not matching MEDIA_TYPE
      expect(() => new cciField(type, value)).toThrow(FieldError);
    });

    it('should construct a cciField with length defined by relationship', () => {
      const type = CubeFieldType.RELATES_TO;
      const value = Buffer.alloc(NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE);
      expect(() => new cciField(type, value)).not.toThrow();
    });
  });

  describe('simple static creation methods', () => {
    it('should create SubkeySeed cciField', () => {
      const buf = Buffer.alloc(10);
      const field = cciField.SubkeySeed(buf);
      expect(field instanceof CubeField).toBe(true);
      expect(field.type).toBe(cciFieldType.SUBKEY_SEED);
      expect(field.value).toEqual(buf);
    });

    it('should create Application cciField', () => {
      const applicationString = 'Test Application';
      const field = cciField.Application(applicationString);
      expect(field instanceof cciField).toBe(true);
      expect(field.type).toBe(cciFieldType.APPLICATION);
      expect(field.value.toString('utf-8')).toBe(applicationString);
    });

    it('should create RelatesTo cciField', () => {
      const rel = { type: 0, remoteKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE) };
      const field = cciField.RelatesTo(rel);
      expect(field instanceof cciField).toBe(true);
      expect(field.type).toBe(cciFieldType.RELATES_TO);
      expect(field.value).toEqual(Buffer.alloc(NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE));
    });

    it('should create Payload cciField', () => {
      const payload = 'Test payload';
      const field = cciField.Payload(payload);
      expect(field instanceof cciField).toBe(true);
      expect(field.type).toBe(cciFieldType.PAYLOAD);
      expect(field.value.toString()).toBe(payload);
    });

    it('should create MediaType cciField', () => {
      const type = MediaTypes.TEXT;
      const field = cciField.MediaType(type);
      expect(field instanceof cciField).toBe(true);
      expect(field.type).toBe(cciFieldType.MEDIA_TYPE);
      expect(field.value).toEqual(Buffer.alloc(1).fill(type));
    });

    it('should create Username cciField', () => {
      const name = 'TestUser';
      const field = cciField.Username(name);
      expect(field instanceof cciField).toBe(true);
      expect(field.type).toBe(cciFieldType.USERNAME);
      expect(field.value.toString('utf-8')).toBe(name);
    });
  });

  describe('static FromRelationships generator', () => {
    it('should generate fields from relationships', () => {
      const rels = [{ type: 1, remoteKey: Buffer.alloc(NetConstants.CUBE_KEY_SIZE) }];
      const gen = cciField.FromRelationships(rels);
      expect(gen.next().value instanceof cciField).toBe(true);
    });
  });
});

