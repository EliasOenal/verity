import { FieldType, MediaTypes } from "../../../src/cci/cube/cube.definitions";
import { VerityField } from "../../../src/cci/cube/verityField";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";
import { CubeKey, FieldError } from "../../../src/core/cube/coreCube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('VerityField', () => {
  describe('constructor', () => {
    it('should construct a cciField for types with no fixed length', () => {
      const type = FieldType.APPLICATION;
      const value = Buffer.alloc(10); // Arbitrary buffer length for APPLICATION
      expect(() => new VerityField(type, value)).not.toThrow();
    });

    it('should construct a cciField with fixed length', () => {
      const type = FieldType.MEDIA_TYPE;
      const value = Buffer.alloc(1);
      expect(() => new VerityField(type, value)).not.toThrow();
    });

    it('should throw error for invalid length', () => {
      const type = FieldType.MEDIA_TYPE;
      const value = Buffer.alloc(20); // Arbitrary buffer length not matching MEDIA_TYPE
      expect(() => new VerityField(type, value)).toThrow(FieldError);
    });

    it('should construct a cciField with length defined by relationship', () => {
      const type = FieldType.RELATES_TO;
      const value = Buffer.alloc(NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE);
      expect(() => new VerityField(type, value)).not.toThrow();
    });
  });

  describe('simple static creation methods', () => {
    it('should create SubkeySeed cciField', () => {
      const buf = Buffer.alloc(10);
      const field = VerityField.SubkeySeed(buf);
      expect(field instanceof CubeField).toBe(true);
      expect(field.type).toBe(FieldType.SUBKEY_SEED);
      expect(field.value).toEqual(buf);
    });

    it('should create Application cciField', () => {
      const applicationString = 'Test Application';
      const field = VerityField.Application(applicationString);
      expect(field instanceof VerityField).toBe(true);
      expect(field.type).toBe(FieldType.APPLICATION);
      expect(field.value.toString('utf-8')).toBe(applicationString);
    });

    it('should create RelatesTo cciField', () => {
      const rel = new Relationship(RelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42) as CubeKey);
      const field = VerityField.RelatesTo(rel);
      expect(field instanceof VerityField).toBe(true);
      expect(field.type).toBe(FieldType.RELATES_TO);
      const restoredRel = Relationship.fromField(field);
      expect(restoredRel.type).toBe(RelationshipType.MYPOST);
      expect(restoredRel.remoteKey).toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42));
    });

    it('should create Payload cciField', () => {
      const payload = 'Test payload';
      const field = VerityField.Payload(payload);
      expect(field instanceof VerityField).toBe(true);
      expect(field.type).toBe(FieldType.PAYLOAD);
      expect(field.value.toString()).toBe(payload);
    });

    it('should create MediaType cciField', () => {
      const type = MediaTypes.TEXT;
      const field = VerityField.MediaType(type);
      expect(field instanceof VerityField).toBe(true);
      expect(field.type).toBe(FieldType.MEDIA_TYPE);
      expect(field.value).toEqual(Buffer.alloc(1).fill(type));
    });

    it('should create Username cciField', () => {
      const name = 'TestUser';
      const field = VerityField.Username(name);
      expect(field instanceof VerityField).toBe(true);
      expect(field.type).toBe(FieldType.USERNAME);
      expect(field.value.toString('utf-8')).toBe(name);
    });

    it('should create a Padding field', () => {
      const length = 10; // Example length
      const field = VerityField.Padding(length);
      expect(field.type).toBe(FieldType.PADDING);
      expect(field.value.length).toBe(length - 2); // Assuming 2 is the header length
    });

    it('should create a CCI_END marker', () => {
      const field = VerityField.Padding(1);
      expect(field.type).toBe(FieldType.CCI_END);
      expect(field.value.length).toBe(0);
    });
  });

  describe('static FromRelationships generator', () => {
    it('should generate fields from relationships', () => {
      const rels = [new Relationship(RelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE) as CubeKey)];
      const gen = VerityField.FromRelationships(rels);
      expect(gen.next().value instanceof VerityField).toBe(true);
    });
  });
});
