import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import { FieldType } from "../../../src/cci/cube/cube.definitions";
import { Cube } from "../../../src/cci/cube/cube";
import { VerityField } from "../../../src/cci/cube/verityField";
import { VerityFields, cciFrozenFieldDefinition, cciFrozenParser } from "../../../src/cci/cube/verityFields";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { CubeKey } from "../../../src";

describe('VerityFields', () => {
  describe('constructor', () => {
    it('should initialize with empty data if no data provided', () => {
      const fields = new VerityFields(undefined, cciFrozenFieldDefinition);
      expect(fields.length).toBe(0);
      expect(fields.getByteLength()).toBe(0);
    });

    it('should initialize with provided data', () => {
      const data = [new VerityField(1, Buffer.from('value1')), new VerityField(2, Buffer.from('value2'))];
      const fields = new VerityFields(data, cciFrozenFieldDefinition);
      expect(fields.length).toBe(2);
    });
  });

  describe('custom fields', () => {
    it('correctly parses custom fields intermingled with standard fields', () => {
      const application = 'applicatio praeclara';
      const contentName = 'contentus irrelevans';
      const custom1 = 'contentus ornatus consuetudo';
      const custom2 = Buffer.from(
        "estaG9jIGV0aWFtIG1vZG8gbW9zIGVzdCBmaWx1bSwgc2VkIHBlciBldGlhbSBtYWdpcyBlbmNvZGluZyBhYnNjb25kaXR1bSBlc3Q=",
        'base64');
      const custom3 = 'qui hoc legit stultus est';
      const username = 'usus applicationis valde peculiaris';

      const fields = VerityFields.Frozen([
        VerityField.Application(application),
        VerityField.ContentName(contentName),
        new VerityField(FieldType.CUSTOM1, custom1),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42) as CubeKey)),
        new VerityField(FieldType.CUSTOM2, custom2),
        VerityField.Username(username),
        new VerityField(FieldType.CUSTOM3, custom3),
      ]);

      expect(fields.length).toBeGreaterThan(7);
      expect(fields.getByteLength()).toBeGreaterThan(120);
      expect(fields.getFirst(FieldType.APPLICATION).valueString).toBe(application);
      expect(fields.getFirst(FieldType.CONTENTNAME).valueString).toBe(contentName);
      expect(fields.getFirst(FieldType.CUSTOM1).valueString).toBe(custom1);
      expect(fields.getFirst(FieldType.CUSTOM2).value).toEqual(custom2);
      expect(fields.getFirst(FieldType.USERNAME).valueString).toBe(username);
      expect(fields.getFirst(FieldType.CUSTOM3).valueString).toBe(custom3);

      const compiled: Buffer = cciFrozenParser.compileFields(fields);
      expect(compiled).toBeInstanceOf(Buffer);
      expect(compiled.length).toBe(fields.getByteLength());

      const restored: VerityFields = cciFrozenParser.decompileFields(compiled) as VerityFields;
      expect(restored.length).toBe(fields.length);
      expect(restored.getByteLength()).toBe(fields.getByteLength());
      expect(restored.getFirst(FieldType.APPLICATION).valueString).toBe(application);
      expect(restored.getFirst(FieldType.CONTENTNAME).valueString).toBe(contentName);
      expect(restored.getFirst(FieldType.CUSTOM1).valueString).toBe(custom1);
      expect(restored.getFirst(FieldType.CUSTOM2).value).toEqual(custom2);
      expect(restored.getFirst(FieldType.USERNAME).valueString).toBe(username);
      expect(restored.getFirst(FieldType.CUSTOM3).valueString).toBe(custom3);
    });
  });

  describe('getRelationships', () => {
    it('should return empty array if no relationships found', () => {
      const fields = new VerityFields(undefined, cciFrozenFieldDefinition);
      expect(fields.getRelationships()).toEqual([]);
    });

    it('should return relationships of specified type if provided', () => {
      const rels = [
        VerityField.RelatesTo(new Relationship(
          RelationshipType.MYPOST,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.MYPOST,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(43) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(138) as CubeKey)),
      ];
      const fields = new VerityFields(rels, cciFrozenFieldDefinition);
      expect(fields.getRelationships(RelationshipType.MYPOST).length).toBe(2);
    });

    it('should return all relationships if type not provided', () => {
      const rels = [
        VerityField.RelatesTo(new Relationship(
          RelationshipType.MYPOST,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.MYPOST,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(43) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(138) as CubeKey)),
      ];
      const fields = new VerityFields(rels, cciFrozenFieldDefinition);
      expect(fields.getRelationships().length).toBe(4);
    });
  });

  describe('getFirstRelationship', () => {
    it('should return undefined if no relationships found', () => {
      const fields = new VerityFields(undefined, cciFrozenFieldDefinition);
      expect(fields.getFirstRelationship()).toBeUndefined();
    });

    it('should return first relationship of specified type if provided', () => {
      const rels = [
        VerityField.RelatesTo(new Relationship(
          RelationshipType.MYPOST,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137) as CubeKey)),
      ];
      const fields = new VerityFields(rels, cciFrozenFieldDefinition);
      expect(fields.getFirstRelationship(
        RelationshipType.SUBSCRIPTION_RECOMMENDATION).type).toBe(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION);
      expect(fields.getFirstRelationship(
        RelationshipType.SUBSCRIPTION_RECOMMENDATION).remoteKey).toEqual(
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137));
    });

    it('should return first relationship if type not provided', () => {
      const rels = [
        VerityField.RelatesTo(new Relationship(
          RelationshipType.MYPOST,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42) as CubeKey)),
        VerityField.RelatesTo(new Relationship(
          RelationshipType.SUBSCRIPTION_RECOMMENDATION,
          Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137) as CubeKey)),
      ];
      const fields = new VerityFields(rels, cciFrozenFieldDefinition);
      expect(fields.getFirstRelationship().type).toBe(
        RelationshipType.MYPOST);
      expect(fields.getFirstRelationship().remoteKey).toEqual(
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42));
    });

    it('correctly sets and retrieves a reply_to relationship field in a full stack test', async () => {
      const root: Cube = Cube.Frozen(
        { fields: VerityField.Payload(Buffer.alloc(200)) });
      const leaf: Cube = Cube.Frozen({
        fields: [
          VerityField.Payload(Buffer.alloc(200)),
          VerityField.RelatesTo(new Relationship(
            RelationshipType.REPLY_TO, (await root.getKey())))
        ]
      });

      const retrievedRel: Relationship = leaf.fields.getFirstRelationship();
      expect(retrievedRel.type).toEqual(RelationshipType.REPLY_TO);
      expect(retrievedRel.remoteKey.toString('hex')).toEqual(
        (await root.getKey()).toString('hex'));
    }, 3000);
  });

  describe('insertTillFull', () => {
    it('should insert fields until cube is full', () => {
      const fields = new VerityFields([], cciFrozenFieldDefinition);
      const latinBraggery = "Nullo campo iterari in aeternum potest";
      const field = VerityField.Payload(latinBraggery);
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
