import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeFieldType, CubeType, FieldError } from "../../../src/core/cube/cube.definitions";
import { CubeField } from "../../../src/core/cube/cubeField";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('CubeField', () => {
  describe('constructor', () => {
    it('should throw an error when constructing with incorrect length', () => {
      expect(() => {
        const type = CubeFieldType.TYPE;
        const value = Buffer.alloc(4); // Incorrect length
        new CubeField(type, value);
      }).toThrow(FieldError);
    });
  });

  describe('static creation methods', () => {
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
      expect(field.value.length).toBe(NetConstants.NONCE_SIZE);
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
  });
});