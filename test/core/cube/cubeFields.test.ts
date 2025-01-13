import { NetConstants } from "../../../src/core/networking/networkDefinitions";
import { CubeField } from "../../../src/core/cube/cubeField";
import { CubeFields, CoreFrozenFieldDefinition, CoreMucFieldDefinition, CorePmucFieldDefinition } from "../../../src/core/cube/cubeFields";
import { CubeFieldType, CubeType } from "../../../src/core/cube/cube.definitions";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('CubeFields', () => {
  describe('static methods', () => {
    describe('DefaultPositionals()', () => {
      describe('DefaultPositionals() for frozen cubes', () => {
        it('should create a valid frozen cube field set', () => {
          const fields = CubeFields.DefaultPositionals(CoreFrozenFieldDefinition);
          expect(fields.all.length).toBe(4); // 4 mandatory fields for frozen cubes
          expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
          expect(fields.all[1].type).toBe(CubeFieldType.FROZEN_RAWCONTENT);
          expect(fields.all[2].type).toBe(CubeFieldType.DATE);
          expect(fields.all[3].type).toBe(CubeFieldType.NONCE);
        });

        it('should be idempotent', () => {
          const origFields = CubeFields.Frozen();
          const doubleFields = CubeFields.Frozen(origFields);
          expect(origFields.equals(doubleFields, true)).toBeTruthy();
        });

        it('should upgrade an incomplete field set', () => {
          const date = 148302000;  // viva Malta repubblika!
          const dateField = CubeField.Date(date);
          const incomplete = new CubeFields(dateField, CoreFrozenFieldDefinition);
          expect(incomplete.all.length).toBe(1);
          const fields = CubeFields.DefaultPositionals(CoreFrozenFieldDefinition, incomplete);
          expect(fields.all.length).toBe(4); // 4 mandatory fields for frozen cubes
          expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
          expect(fields.all[1].type).toBe(CubeFieldType.FROZEN_RAWCONTENT);
          expect(fields.all[2].type).toBe(CubeFieldType.DATE);
          expect(fields.all[3].type).toBe(CubeFieldType.NONCE);
        });
      });  // DefaultPositionals() for frozen cubes

      describe('DefaultPositionals() for notification frozen Cubes', () => {
        it.todo('write tests');
      });

      describe('DefaultPositionals() for MUCs', () => {
        it('should create a valid MUC field set', () => {
          const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 42); // example public key
          const fields = CubeFields.DefaultPositionals(CoreMucFieldDefinition, CubeField.PublicKey(publicKey));
          expect(fields.all.length).toBe(6); // 6 mandatory fields for MUC cubes
          expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
          expect(fields.all[1].type).toBe(CubeFieldType.MUC_RAWCONTENT);
          expect(fields.all[2].type).toBe(CubeFieldType.PUBLIC_KEY);
          expect(fields.all[3].type).toBe(CubeFieldType.DATE);
          expect(fields.all[4].type).toBe(CubeFieldType.SIGNATURE);
          expect(fields.all[5].type).toBe(CubeFieldType.NONCE);
          expect(fields.all[2].value).toBe(publicKey);  // pubkey correctly set
        });

        it.skip('should be idempotent', () => {
          // DefaultPositionals() currently is not idempotent regarding the public key
          // field while the old MUC() static was. I'm not sure if it even has to be, though.
          const mockKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE).fill(42);
          const origFields = CubeFields.DefaultPositionals(CoreMucFieldDefinition, CubeField.PublicKey(mockKey));
          const doubleFields = CubeFields.DefaultPositionals(CoreMucFieldDefinition, [CubeField.PublicKey(mockKey), ...origFields.all]);
          expect(origFields.equals(doubleFields, true)).toBeTruthy();
        });

        it('can upgrade an incomplete field set to a MUC field set', () => {
          const frozenFields = new CubeFields(
            [
              CubeField.RawContent(CubeType.MUC, "Cubus camporum incompletorum"),
            ],
            CoreMucFieldDefinition
          )
          const mockKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE).fill(42);
          const mucFields = CubeFields.DefaultPositionals(CoreMucFieldDefinition, [CubeField.PublicKey(mockKey), ...frozenFields.all]);
          expect(mucFields.all.length).toBe(6); // 6 mandatory fields for MUC cubes
          expect(mucFields.all[0].type).toBe(CubeFieldType.TYPE);
          expect(mucFields.all[1].type).toBe(CubeFieldType.MUC_RAWCONTENT);
          expect(mucFields.all[2].type).toBe(CubeFieldType.PUBLIC_KEY);
          expect(mucFields.all[3].type).toBe(CubeFieldType.DATE);
          expect(mucFields.all[4].type).toBe(CubeFieldType.SIGNATURE);
          expect(mucFields.all[5].type).toBe(CubeFieldType.NONCE);
          expect(mucFields.all[2].value).toBe(mockKey);  // pubkey correctly set
        });
      });  // DefaultPositionals() for MUCs

      describe('DefaultPositionals() for notification MUCs', () => {
        it.todo('write tests');
      });  // DefaultPositionals() for notification MUCs

      describe('DefaultPositionals() for PMUCs', () => {
        it('should create a valid PMUC field set', () => {
          const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 42); // example public key
          const fields = CubeFields.DefaultPositionals(
            CorePmucFieldDefinition, CubeField.PublicKey(publicKey));
          expect(fields.all.length).toBe(7); // 7 mandatory fields for PMUC cubes
          expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
          expect(fields.all[1].type).toBe(CubeFieldType.PMUC_RAWCONTENT);
          expect(fields.all[2].type).toBe(CubeFieldType.PMUC_UPDATE_COUNT);
          expect(fields.all[3].type).toBe(CubeFieldType.PUBLIC_KEY);
          expect(fields.all[4].type).toBe(CubeFieldType.DATE);
          expect(fields.all[5].type).toBe(CubeFieldType.SIGNATURE);
          expect(fields.all[6].type).toBe(CubeFieldType.NONCE);

          // assert pubkey correctly set
          expect(fields.getFirst(CubeFieldType.PUBLIC_KEY).value).toBe(publicKey);
          // assert PMUC update count initialised at zero
          expect(fields.getFirst(CubeFieldType.PMUC_UPDATE_COUNT).value.readUintBE(
            0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toBe(0);
        });

        it('can create a PMUC field set starting at an arbitrary version number', () => {
          const publicKey = Buffer.alloc(NetConstants.PUBLIC_KEY_SIZE, 42); // example public key
          const fields = CubeFields.DefaultPositionals(CorePmucFieldDefinition,
            [CubeField.PublicKey(publicKey), CubeField.PmucUpdateCount(42)]);
          expect(fields.all.length).toBe(7); // 7 mandatory fields for PMUC cubes
          expect(fields.all[0].type).toBe(CubeFieldType.TYPE);
          expect(fields.all[1].type).toBe(CubeFieldType.PMUC_RAWCONTENT);
          expect(fields.all[2].type).toBe(CubeFieldType.PMUC_UPDATE_COUNT);
          expect(fields.all[3].type).toBe(CubeFieldType.PUBLIC_KEY);
          expect(fields.all[4].type).toBe(CubeFieldType.DATE);
          expect(fields.all[5].type).toBe(CubeFieldType.SIGNATURE);
          expect(fields.all[6].type).toBe(CubeFieldType.NONCE);

          // assert pubkey correctly set
          expect(fields.getFirst(CubeFieldType.PUBLIC_KEY).value).toBe(publicKey);
          // assert PMUC update set as requested
          expect(fields.getFirst(CubeFieldType.PMUC_UPDATE_COUNT).value.readUintBE(
            0, NetConstants.PMUC_UPDATE_COUNT_SIZE)).toBe(42);
        });

        it.todo('can upgrade an incomplete field set to a PMUC field set');
      });  // DefaultPositionals() for PMUCs

      describe('DefaultPositionals() for notification PMUCs', () => {
        it.todo('write tests');
      });
    });  // DefaultPositionals()
  });  // static methods
});
