import { cciField, cciFieldType, MediaTypes } from "../../../src/cci/cube/cciField";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";
import { FieldError } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

describe('cciField', () => {
  describe('constructor', () => {
    it('should construct a cciField for types with no fixed length', () => {
      const type = cciFieldType.APPLICATION;
      const value = Buffer.alloc(10); // Arbitrary buffer length for APPLICATION
      expect(() => new cciField(type, value)).not.toThrow();
    });

    it('should construct a cciField with fixed length', () => {
      const type = cciFieldType.MEDIA_TYPE;
      const value = Buffer.alloc(1);
      expect(() => new cciField(type, value)).not.toThrow();
    });

    it('should throw error for invalid length', () => {
      const type = cciFieldType.MEDIA_TYPE;
      const value = Buffer.alloc(20); // Arbitrary buffer length not matching MEDIA_TYPE
      expect(() => new cciField(type, value)).toThrow(FieldError);
    });

    it('should construct a cciField with length defined by relationship', () => {
      const type = cciFieldType.RELATES_TO;
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
      const rel = new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42));
      const field = cciField.RelatesTo(rel);
      expect(field instanceof cciField).toBe(true);
      expect(field.type).toBe(cciFieldType.RELATES_TO);
      const restoredRel = cciRelationship.fromField(field);
      expect(restoredRel.type).toBe(cciRelationshipType.MYPOST);
      expect(restoredRel.remoteKey).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42));
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
      const rels = [new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE))];
      const gen = cciField.FromRelationships(rels);
      expect(gen.next().value instanceof cciField).toBe(true);
    });
  });
});

