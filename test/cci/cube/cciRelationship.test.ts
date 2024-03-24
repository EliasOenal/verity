import { CubeType, WrongFieldType } from "../../../src/core/cube/cubeDefinitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

import { cciField } from "../../../src/cci/cube/cciField";
import { cciFieldParsers, cciFields, cciFrozenFieldDefinition } from "../../../src/cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";

describe('cciRelationship', () => {
  it('create a CCI fields object from its predefined field definition', () => {
    const parserTable = cciFieldParsers;
    const cciFrozenParser = parserTable[CubeType.FROZEN];
    const fieldDef = cciFrozenParser.fieldDef;
    const fieldsClass = fieldDef.fieldsObjectClass;
    const fields = new fieldsClass(undefined, fieldDef);
    expect(fields instanceof cciFields).toBeTruthy();
  });

  it('marshalls and demarshalls relationsships to and from fields', () => {
    const fields = new cciFields([
      cciField.Type(CubeType.FROZEN),
      cciField.Payload("Ego sum cubus bene connexus cum multis relationibus ad alios cubos."),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(1))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(2))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MENTION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(11))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(3))),
      cciField.Payload("Cubus insolitus sum."),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(21))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.REPLY_TO,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(4))),
      cciField.Date(),
      cciField.Nonce(),
    ],
    cciFrozenFieldDefinition);

    expect(fields instanceof cciFields).toBeTruthy();
    expect(fields.getRelationships().length).toEqual(6);
    expect(fields.getRelationships()[0]).toBeInstanceOf(cciRelationship);

    expect(fields.getRelationships()[0].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships()[0].remoteKey[0]).toEqual(1);
    expect(fields.getRelationships()[1].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships()[1].remoteKey[0]).toEqual(2);
    expect(fields.getRelationships()[2].type).toEqual(cciRelationshipType.MENTION);
    expect(fields.getRelationships()[2].remoteKey[0]).toEqual(11);
    expect(fields.getRelationships()[3].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships()[3].remoteKey[0]).toEqual(3);
    expect(fields.getRelationships()[4].type).toEqual(cciRelationshipType.MYPOST);
    expect(fields.getRelationships()[4].remoteKey[0]).toEqual(21);
    expect(fields.getRelationships()[5].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships()[5].remoteKey[0]).toEqual(4);

    expect(fields.getRelationships(cciRelationshipType.REPLY_TO).length).toEqual(4);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[0].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[0].remoteKey[0]).toEqual(1);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[1].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[1].remoteKey[0]).toEqual(2);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[2].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[2].remoteKey[0]).toEqual(3);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[3].type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getRelationships(cciRelationshipType.REPLY_TO)[3].remoteKey[0]).toEqual(4);

    expect(fields.getFirstRelationship().type).toEqual(cciRelationshipType.REPLY_TO);
    expect(fields.getFirstRelationship().remoteKey[0]).toEqual(1);

    expect(fields.getRelationships(cciRelationshipType.MYPOST).length).toEqual(1);
    expect(fields.getFirstRelationship(cciRelationshipType.MYPOST)).toEqual(fields.getRelationships(cciRelationshipType.MYPOST)[0]);
    expect(fields.getFirstRelationship(cciRelationshipType.MYPOST).type).toEqual(cciRelationshipType.MYPOST);
    expect(fields.getFirstRelationship(cciRelationshipType.MYPOST).remoteKey[0]).toEqual(21);
  });

  it('throws trying to demarshal a non-relationship field', () => {
    const field = cciField.Payload("Hoc non est relationem.");
    expect(() => cciRelationship.fromField(field)).toThrow(WrongFieldType);
  });
});