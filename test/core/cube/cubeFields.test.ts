import { CubeType } from "../../../src/core/cube/cubeDefinitions";
import { CubeFields, CubeFieldType, CubeField, coreFrozenFieldDefinition } from "../../../src/core/cube/cubeFields";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { Settings } from "../../../src/core/settings";

describe('CubeFields', () => {
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

describe('CubeField', () => {
  it('should create a TYPE field with specified cube type', () => {
    const field = CubeField.Type(CubeType.FROZEN);
    expect(field.type).toBe(CubeFieldType.TYPE);
    expect(field.value.length).toBe(NetConstants.CUBE_TYPE_SIZE);
  });

  it('should create a DATE field with specified date', () => {
    const date = 1630509779; // Example timestamp
    const field = CubeField.Date(date);
    expect(field.type).toBe(CubeFieldType.DATE);
    expect(field.value.readUIntBE(0, NetConstants.TIMESTAMP_SIZE)).toBe(date);
  });

  it('should create a Nonce field', () => {
    const field = CubeField.Nonce();
    expect(field.type).toBe(CubeFieldType.NONCE);
    expect(field.value.length).toBe(Settings.NONCE_SIZE);
  });

  it('should create a Payload field', () => {
    const payload = 'Hello, world!';
    const field = CubeField.Payload(payload);
    expect(field.type).toBe(CubeFieldType.PAYLOAD);
    expect(field.value.toString('utf-8')).toBe(payload);
  });

  it('should create a PublicKey field', () => {
    const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE).fill(42); // Example public key
    const field = CubeField.PublicKey(publicKey);
    expect(field.type).toBe(CubeFieldType.PUBLIC_KEY);
    expect(field.value).toBe(publicKey);
  });

  it('should create a Signature field', () => {
    const field = CubeField.Signature();
    expect(field.type).toBe(CubeFieldType.SIGNATURE);
    expect(field.value.length).toBe(64); // Assuming NetConstants.SIGNATURE_SIZE is 64
  });

  it('should create a PADDING field', () => {
    const length = 10; // Example length
    const field = CubeField.Padding(length);
    expect(field.type).toBe(CubeFieldType.PADDING);
    expect(field.value.length).toBe(length - 2); // Assuming 2 is the header length
  });

  it('should create a PADDING_SINGLEBYTE field', () => {
    const field = CubeField.Padding(1);
    expect(field.type).toBe(CubeFieldType.PADDING_SINGLEBYTE);
    expect(field.value.length).toBe(0);
  });
});