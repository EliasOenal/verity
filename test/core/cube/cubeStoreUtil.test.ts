import { describe, it, expect, vi } from 'vitest';
import { getNotificationDateKey, getNotificationDifficultyKey } from '../../../src/core/cube/cubeStoreUtil';
import { Cube } from '../../../src/core/cube/cube';
import { CubeField } from '../../../src/core/cube/cubeField';
import { CubeType, NotificationKey, CubeKey, CubeFieldType } from '../../../src/core/cube/cube.definitions';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

describe('getNotificationDateKey()', () => {
  const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 1) as NotificationKey;
  const timestamp = 148302000;  // viva Malta repubblika!
  const dateBuffer = Buffer.alloc(NetConstants.TIMESTAMP_SIZE);
  dateBuffer.writeUIntBE(timestamp, 0, NetConstants.TIMESTAMP_SIZE);

  describe('Cube as parameter', () => {
    describe('happy path', () => {
      it('should generate the correct key from a valid Cube object', async () => {
          const cube = Cube.Create({
              cubeType: CubeType.FROZEN_NOTIFY,
              fields: [
                  CubeField.Notify(recipientKey),
                  CubeField.Date(timestamp),
              ],
              requiredDifficulty: 0
          });
          const cubeKey = await cube.getKey();
          const dateBuffer = cube.getFirstField(CubeFieldType.DATE).value;
          const expectedKey = Buffer.concat([recipientKey, dateBuffer, cubeKey]);

          const result = await getNotificationDateKey(cube);
          expect(result).toEqual(expectedKey);
      });
    });

    describe('error handling', () => {
      it('should return undefined for a Cube without a NOTIFY field', async () => {
        const cube = Cube.Create({
            cubeType: CubeType.FROZEN,
            fields: [
                CubeField.Date(timestamp),
            ],
            requiredDifficulty: 0
        });

        const result = await getNotificationDateKey(cube);
        expect(result).toBeUndefined();
      });
    });
  });  // Cube as parameter

  describe('Explicit parameters', () => {
    const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 1) as NotificationKey;
    const cubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 2) as CubeKey;
    const expectedKey = Buffer.concat([recipientKey, dateBuffer, cubeKey]);

    describe('happy paths', () => {
      it('should generate the correct key from explicit parameters with a numeric timestamp', async () => {
          const result = await getNotificationDateKey(recipientKey, timestamp, cubeKey);
          expect(result).toEqual(expectedKey);
      });

      it('should generate the correct key from explicit parameters with a Buffer timestamp', async () => {
          const result = await getNotificationDateKey(recipientKey, dateBuffer, cubeKey);
          expect(result).toEqual(expectedKey);
      });
    });

    describe('error handling', () => {
      it('should return undefined for an invalid recipient key length', async () => {
          const invalidRecipient = Buffer.alloc(NetConstants.NOTIFY_SIZE - 1) as NotificationKey;
          const result = await getNotificationDateKey(invalidRecipient, timestamp, cubeKey);
          expect(result).toBeUndefined();
      });

      it('should return undefined for an invalid timestamp buffer length', async () => {
          const invalidDateBuffer = Buffer.alloc(NetConstants.TIMESTAMP_SIZE - 1);
          const result = await getNotificationDateKey(recipientKey, invalidDateBuffer, cubeKey);
          expect(result).toBeUndefined();
      });

      it('should return undefined for an invalid cube key length', async () => {
          const invalidCubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE - 1) as CubeKey;
          const result = await getNotificationDateKey(recipientKey, timestamp, invalidCubeKey);
          expect(result).toBeUndefined();
      });

      it('should return undefined when called with all invalid parameters', async () => {
          const invalidRecipient = Buffer.alloc(NetConstants.NOTIFY_SIZE - 1) as NotificationKey;
          const invalidCubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE - 1) as CubeKey;
          const result = await getNotificationDateKey(invalidRecipient, timestamp, invalidCubeKey);
          expect(result).toBeUndefined();
      });
    });
  });
});

describe('getNotificationDifficultyKey()', () => {
  const recipientKey = Buffer.alloc(NetConstants.NOTIFY_SIZE, 1) as NotificationKey;
  const difficulty = 42;
  const difficultyBuffer = Buffer.alloc(1);
  difficultyBuffer.writeUInt8(difficulty);

  describe('Cube as parameter', () => {
    describe('happy path', () => {
      it('should generate the correct key from a valid Cube object', async () => {
          const cube = Cube.Create({
              cubeType: CubeType.FROZEN_NOTIFY,
              fields: [
                  CubeField.Notify(recipientKey),
              ],
              requiredDifficulty: 0
          });
          const cubeKey = await cube.getKey();
          const actualDifficulty = cube.getDifficulty();
          const actualDifficultyBuffer = Buffer.alloc(1);
          actualDifficultyBuffer.writeUInt8(actualDifficulty);
          const expectedKey = Buffer.concat([recipientKey, actualDifficultyBuffer, cubeKey]);

          const result = await getNotificationDifficultyKey(cube);
          expect(result).toEqual(expectedKey);
      });
    });

    describe('error handling', () => {
      it('should return undefined for a Cube without a NOTIFY field', async () => {
        const cube = Cube.Create({
            cubeType: CubeType.FROZEN,
            requiredDifficulty: 0
        });

        const result = await getNotificationDifficultyKey(cube);
        expect(result).toBeUndefined();
      });
    });
  });  // Cube as parameter

  describe('Explicit parameters', () => {
    const cubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 2) as CubeKey;
    const expectedKey = Buffer.concat([recipientKey, difficultyBuffer, cubeKey]);

    describe('happy paths', () => {
      it('should generate the correct key from explicit parameters with a numeric difficulty', async () => {
          const result = await getNotificationDifficultyKey(recipientKey, difficulty, cubeKey);
          expect(result).toEqual(expectedKey);
      });

      it('should generate the correct key from explicit parameters with a Buffer difficulty', async () => {
          const result = await getNotificationDifficultyKey(recipientKey, difficultyBuffer, cubeKey);
          expect(result).toEqual(expectedKey);
      });
    });

    describe('error handling', () => {
      it('should return undefined for an invalid recipient key length', async () => {
          const invalidRecipient = Buffer.alloc(NetConstants.NOTIFY_SIZE - 1) as NotificationKey;
          const result = await getNotificationDifficultyKey(invalidRecipient, difficulty, cubeKey);
          expect(result).toBeUndefined();
      });

      it('should return undefined for an invalid difficulty buffer length', async () => {
          const invalidDifficultyBuffer = Buffer.alloc(2);
          const result = await getNotificationDifficultyKey(recipientKey, invalidDifficultyBuffer, cubeKey);
          expect(result).toBeUndefined();
      });

      it('should return undefined for an invalid cube key length', async () => {
          const invalidCubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE - 1) as CubeKey;
          const result = await getNotificationDifficultyKey(recipientKey, difficulty, invalidCubeKey);
          expect(result).toBeUndefined();
      });

      it('should return undefined when called with all invalid parameters', async () => {
          const invalidRecipient = Buffer.alloc(NetConstants.NOTIFY_SIZE - 1) as NotificationKey;
          const invalidCubeKey = Buffer.alloc(NetConstants.CUBE_KEY_SIZE - 1) as CubeKey;
          const result = await getNotificationDifficultyKey(invalidRecipient, difficulty, invalidCubeKey);
          expect(result).toBeUndefined();
      });
    });
  });
});
