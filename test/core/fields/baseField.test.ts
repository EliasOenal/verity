import { BaseField } from "../../../src/core/fields/baseField";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('BaseField', () => {
  describe('constructor (from scratch)', () => {
    it('should initialize correctly with type, value, and start', () => {
      const type = 1;
      const value = Buffer.from('test');
      const start = 0;
      const baseField = new BaseField(type, value, start);
      expect(baseField.type).toEqual(type);
      expect(baseField.value).toEqual(value);
      expect(baseField.start).toEqual(start);
    });

    it('should return correct length', () => {
      const value = Buffer.from('test');
      const baseField = new BaseField(1, value);
      expect(baseField.length).toEqual(value.length);
    });
  });

  describe('constructor (copy)', () => {
    it('creates a deep copy of the field', () => {
      const value = Buffer.from('test');
      const baseField = new BaseField(1, value);
      const copy = new BaseField(baseField);
      expect(copy.value).toEqual(value);
      expect(copy.value).not.toBe(value);
    });
  });

  describe('equals()', () => {
    it('should compare correctly with equals method', () => {
      const baseField1 = new BaseField(1, Buffer.from('test'));
      const baseField2 = new BaseField(1, Buffer.from('test'));
      const baseField3 = new BaseField(2, Buffer.from('test'));
      expect(baseField1.equals(baseField2)).toBeTruthy();
      expect(baseField1.equals(baseField3)).toBeFalsy();
    });

    it('should compare correctly with equals method with different start indices', () => {
      const baseField1 = new BaseField(1, Buffer.from('test'), 0);
      const baseField2 = new BaseField(1, Buffer.from('test'), 1);
      expect(baseField1.equals(baseField2, true)).toBeFalsy();
    });
  });

  describe('isFinalized()', () => {
    it('should check if field is finalized correctly', () => {
      const finalized = new BaseField(1, Buffer.from('test'), 0);
      expect(finalized.isFinalized()).toBeTruthy();
      const unfinalized = new BaseField(1, Buffer.from('test'));
      expect(unfinalized.isFinalized()).toBeFalsy();
    });
  });
});
