import { CubeKey, CubeType, WrongFieldType } from "../../../src/core/cube/coreCube.definitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import { VerityField } from "../../../src/cci/cube/verityField";
import { cciFieldParsers, VerityFields, cciFrozenFieldDefinition } from "../../../src/cci/cube/verityFields";
import { Relationship, RelationshipType } from "../../../src/cci/cube/relationship";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('Relationship', () => {
  it('create a CCI fields object from its predefined field definition', () => {
    const parserTable = cciFieldParsers;
    const cciFrozenParser = parserTable[CubeType.FROZEN];
    const fieldDef = cciFrozenParser.fieldDef;
    const fieldsClass = fieldDef.fieldsObjectClass;
    const fields = new fieldsClass(undefined, fieldDef);
    expect(fields instanceof VerityFields).toBeTruthy();
  });

  it('marshalls and demarshalls relationsships to and from fields', () => {
    const fields = new VerityFields([
      VerityField.Type(CubeType.FROZEN),
      VerityField.Payload("Ego sum cubus bene connexus cum multis relationibus ad alios cubos."),
      VerityField.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(1) as CubeKey)),
      VerityField.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(2) as CubeKey)),
      VerityField.RelatesTo(new Relationship(
        RelationshipType.MENTION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(11) as CubeKey)),
      VerityField.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(3) as CubeKey)),
      VerityField.Payload("Cubus insolitus sum."),
      VerityField.RelatesTo(new Relationship(
        RelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(21) as CubeKey)),
      VerityField.RelatesTo(new Relationship(
        RelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(4) as CubeKey)),
      VerityField.Date(),
      VerityField.Nonce(),
    ],
    cciFrozenFieldDefinition);

    expect(fields instanceof VerityFields).toBeTruthy();
    expect(fields.getRelationships().length).toEqual(6);
    expect(fields.getRelationships()[0]).toBeInstanceOf(Relationship);

    expect(fields.getRelationships()[0].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships()[0].remoteKey[0]).toEqual(1);
    expect(fields.getRelationships()[1].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships()[1].remoteKey[0]).toEqual(2);
    expect(fields.getRelationships()[2].type).toEqual(RelationshipType.MENTION);
    expect(fields.getRelationships()[2].remoteKey[0]).toEqual(11);
    expect(fields.getRelationships()[3].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships()[3].remoteKey[0]).toEqual(3);
    expect(fields.getRelationships()[4].type).toEqual(RelationshipType.MYPOST);
    expect(fields.getRelationships()[4].remoteKey[0]).toEqual(21);
    expect(fields.getRelationships()[5].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships()[5].remoteKey[0]).toEqual(4);

    expect(fields.getRelationships(RelationshipType.REPLY_TO).length).toEqual(4);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[0].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[0].remoteKey[0]).toEqual(1);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[1].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[1].remoteKey[0]).toEqual(2);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[2].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[2].remoteKey[0]).toEqual(3);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[3].type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getRelationships(RelationshipType.REPLY_TO)[3].remoteKey[0]).toEqual(4);

    expect(fields.getFirstRelationship().type).toEqual(RelationshipType.REPLY_TO);
    expect(fields.getFirstRelationship().remoteKey[0]).toEqual(1);

    expect(fields.getRelationships(RelationshipType.MYPOST).length).toEqual(1);
    expect(fields.getFirstRelationship(RelationshipType.MYPOST)).toEqual(fields.getRelationships(RelationshipType.MYPOST)[0]);
    expect(fields.getFirstRelationship(RelationshipType.MYPOST).type).toEqual(RelationshipType.MYPOST);
    expect(fields.getFirstRelationship(RelationshipType.MYPOST).remoteKey[0]).toEqual(21);
  });

  it('returns undefined when trying to demarshal a non-relationship field', () => {
    const field = VerityField.Payload("Hoc non est relationem.");
    expect(Relationship.fromField(field)).toBeUndefined();
  });
});