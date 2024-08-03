import { cciCube } from "../../../src/cci/cube/cciCube";
import { cciField, cciFieldType } from "../../../src/cci/cube/cciField";
import { cciFieldParsers, cciFields, cciFrozenFieldDefinition, cciFrozenParser } from "../../../src/cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

describe('cciFields', () => {
  describe('constructor', () => {
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

      const fields = cciFields.Frozen([
        cciField.Application(application),
        cciField.ContentName(contentName),
        new cciField(cciFieldType.CUSTOM1, custom1),
        cciField.RelatesTo(new cciRelationship(
          cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42))),
        new cciField(cciFieldType.CUSTOM2, custom2),
        cciField.Username(username),
        new cciField(cciFieldType.CUSTOM3, custom3),
      ]);

      expect(fields.length).toBeGreaterThan(7);
      expect(fields.getByteLength()).toBeGreaterThan(120);
      expect(fields.getFirst(cciFieldType.APPLICATION).valueString).toBe(application);
      expect(fields.getFirst(cciFieldType.CONTENTNAME).valueString).toBe(contentName);
      expect(fields.getFirst(cciFieldType.CUSTOM1).valueString).toBe(custom1);
      expect(fields.getFirst(cciFieldType.CUSTOM2).value).toEqual(custom2);
      expect(fields.getFirst(cciFieldType.USERNAME).valueString).toBe(username);
      expect(fields.getFirst(cciFieldType.CUSTOM3).valueString).toBe(custom3);

      const compiled: Buffer = cciFrozenParser.compileFields(fields);
      expect(compiled).toBeInstanceOf(Buffer);
      expect(compiled.length).toBe(fields.getByteLength());

      const restored: cciFields = cciFrozenParser.decompileFields(compiled) as cciFields;
      expect(restored.length).toBe(fields.length);
      expect(restored.getByteLength()).toBe(fields.getByteLength());
      expect(restored.getFirst(cciFieldType.APPLICATION).valueString).toBe(application);
      expect(restored.getFirst(cciFieldType.CONTENTNAME).valueString).toBe(contentName);
      expect(restored.getFirst(cciFieldType.CUSTOM1).valueString).toBe(custom1);
      expect(restored.getFirst(cciFieldType.CUSTOM2).value).toEqual(custom2);
      expect(restored.getFirst(cciFieldType.USERNAME).valueString).toBe(username);
      expect(restored.getFirst(cciFieldType.CUSTOM3).valueString).toBe(custom3);
    });
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
