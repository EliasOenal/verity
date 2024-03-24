import { cciCube } from "../../../src/cci/cube/cciCube";
import { cciField } from "../../../src/cci/cube/cciField";
import { cciFields, cciFrozenFieldDefinition } from "../../../src/cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

describe('cciFields', () => {
  it('should initialize with empty data if no data provided', () => {
    const fields = new cciFields(undefined, cciFrozenFieldDefinition);
    expect(fields.length).toBe(0);
    expect(fields.getByteLength()).toBe(0);
  });

  it('should initialize with provided data', () => {
    const data = [new cciField(1, Buffer.from('value1')), new cciField(2, Buffer.from('value2'))];
    const fields = new cciFields(data, cciFrozenFieldDefinition);
    expect(fields.length).toBe(2);
  });
});

describe('getRelationships', () => {
  it('should return empty array if no relationships found', () => {
    const fields = new cciFields(undefined, cciFrozenFieldDefinition);
    expect(fields.getRelationships()).toEqual([]);
  });

  it('should return relationships of specified type if provided', () => {
    const rels = [
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(43))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(138))),
    ];
    const fields = new cciFields(rels, cciFrozenFieldDefinition);
    expect(fields.getRelationships(cciRelationshipType.MYPOST).length).toBe(2);
  });

  it('should return all relationships if type not provided', () => {
    const rels = [
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(43))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(138))),
    ];
    const fields = new cciFields(rels, cciFrozenFieldDefinition);
    expect(fields.getRelationships().length).toBe(4);
  });
});

describe('getFirstRelationship', () => {
  it('should return undefined if no relationships found', () => {
    const fields = new cciFields(undefined, cciFrozenFieldDefinition);
    expect(fields.getFirstRelationship()).toBeUndefined();
  });

  it('should return first relationship of specified type if provided', () => {
    const rels = [
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137))),
      ];
    const fields = new cciFields(rels, cciFrozenFieldDefinition);
    expect(fields.getFirstRelationship(
      cciRelationshipType.SUBSCRIPTION_RECOMMENDATION).type).toBe(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION);
    expect(fields.getFirstRelationship(
      cciRelationshipType.SUBSCRIPTION_RECOMMENDATION).remoteKey).toEqual(
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137));
  });

  it('should return first relationship if type not provided', () => {
    const rels = [
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42))),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.SUBSCRIPTION_RECOMMENDATION,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(137))),
      ];
    const fields = new cciFields(rels, cciFrozenFieldDefinition);
    expect(fields.getFirstRelationship().type).toBe(
        cciRelationshipType.MYPOST);
    expect(fields.getFirstRelationship().remoteKey).toEqual(
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42));
  });

  it('correctly sets and retrieves a reply_to relationship field in a full stack test', async () => {
    const root: cciCube = cciCube.Frozen(
      {fields: cciField.Payload(Buffer.alloc(200))});
    const leaf: cciCube = cciCube.Frozen({fields: [
      cciField.Payload(Buffer.alloc(200)),
      cciField.RelatesTo(new cciRelationship(
        cciRelationshipType.REPLY_TO, (await root.getKey())))
    ]});

    const retrievedRel: cciRelationship = leaf.fields.getFirstRelationship();
    expect(retrievedRel.type).toEqual(cciRelationshipType.REPLY_TO);
    expect(retrievedRel.remoteKey.toString('hex')).toEqual(
      (await root.getKey()).toString('hex'));
  }, 3000);
});
