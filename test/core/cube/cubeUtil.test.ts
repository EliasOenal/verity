import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CubeKey, CubeType, CubeError } from '../../../src/core/cube/cube.definitions';
import { CubeInfo } from '../../../src/core/cube/cubeInfo';
import { cubeContest, cubeExpiration } from '../../../src/core/cube/cubeUtil';
import { NetConstants } from '../../../src/core/networking/networkDefinitions';

describe('cubeLifetime()', () => {
  it.todo('write tests');
});

describe('cubeExpiration()', () => {
  it.todo('write tests');
});

describe('cubeContest', () => {
  describe('PICs', () => {
    it('incoming Cube wins if expiration is longer (by sculpting time)', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC,
        date: 156164400,
        difficulty: 12,
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC,
        date: 156164401,
        difficulty: 12,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(incomingCube);
    });

    it('incoming Cube wins if expiration is longer (by difficulty)', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC,
        date: 156164400,
        difficulty: 12,
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC,
        date: 156164400,
        difficulty: 13,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(incomingCube);
    });

    it('local Cube wins if expiration is longer (by sculpting time)', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC_NOTIFY,
        date: 156164401,
        difficulty: 12,
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC_NOTIFY,
        date: 156164400,
        difficulty: 12,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(localCube);
    });

    it('local Cube wins if expiration is longer (by difficulty)', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC_NOTIFY,
        date: 156164400,
        difficulty: 13,
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PIC_NOTIFY,
        date: 156164400,
        difficulty: 12,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(localCube);
    });
  });

  describe('MUCs', () => {
    it('incoming Cube wins if sculpting date is newer', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.MUC,
        date: 156164400,
        difficulty: 100,  // should not matter for MUCs
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.MUC,
        date: 156164401,
        difficulty: 12,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(incomingCube);
    });

    it('local Cube wins if sculpting date is newer', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.MUC_NOTIFY,
        date: 156164401,
        difficulty: 12,
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.MUC_NOTIFY,
        date: 156164400,
        difficulty: 12,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(localCube);
    });
  });

  describe('PMUCs', () => {
    it('incoming Cube wins if update count is newer', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PMUC,
        updatecount: 42,
        date: 291726000,  // should not matter
        difficulty: 100,  // should not matter
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PMUC,
        updatecount: 43,
        date: 156164401,
        difficulty: 12,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(incomingCube);
    });

    it('local Cube wins if update count is newer', () => {
      const localCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PMUC_NOTIFY,
        updatecount: 43,
        date: 156164401,
        difficulty: 12,
      });
      const incomingCube = new CubeInfo({
        key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42),
        cubeType: CubeType.PMUC_NOTIFY,
        updatecount: 42,
        date: 156164401,
        difficulty: 12,
      });
      expect(cubeContest(localCube, incomingCube)).toBe(localCube);
    });
  });

  describe('edge cases', () => {
    describe('Cubes of different types', () => {
      it.todo('implement and write tests');
    });

    describe('Invalid cube types', () => {
      it('should throw error for unknown cube type (both local and incoming)', () => {
        const localCube = new CubeInfo({
          key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 10) as CubeKey,
          cubeType: 999 as CubeType,
          date: 156164400,
          difficulty: 12,
        });
        const incomingCube = new CubeInfo({
          key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 10) as CubeKey,
          cubeType: 999 as CubeType,
          date: 156164400,
          difficulty: 12,
        });
        expect(() => cubeContest(localCube, incomingCube)).toThrow(CubeError);
      });

      it('should throw error for unknown local cube type', () => {
        const localCube = new CubeInfo({
          key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 10) as CubeKey,
          cubeType: 999 as CubeType,
          date: 156164400,
          difficulty: 12,
        });
        const incomingCube = new CubeInfo({
          key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 10) as CubeKey,
          cubeType: CubeType.FROZEN,
          date: 156164400,
          difficulty: 12,
        });
        expect(() => cubeContest(localCube, incomingCube)).toThrow(CubeError);
      });

      it('should throw error for unknown incoming cube type', () => {
        const localCube = new CubeInfo({
          key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 10) as CubeKey,
          cubeType: CubeType.FROZEN,
          date: 156164400,
          difficulty: 12,
        });
        const incomingCube = new CubeInfo({
          key: Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 10) as CubeKey,
          cubeType: 999 as CubeType,
          date: 156164400,
          difficulty: 12,
        });
        expect(() => cubeContest(localCube, incomingCube)).toThrow(CubeError);
      });
    });
  });
});


describe('countTrailingZeroBits()', () => {
  it.todo('write tests');
});

describe('getCurrentEpoch()', () => {
  it.todo('write tests');
});

describe('unixTimeToEpoch()', () => {
  it.todo('write tests');
});

describe('shouldRetainCube()', () => {
  it.todo('write tests');
});

describe('keyVariants()', () => {
  it.todo('write tests');
});

describe('typeFromBinary()', () => {
  it.todo('write tests');
});

describe('paddedBuffer()', () => {
  it.todo('write tests');
});

describe('activateCube()', () => {
  it.todo('write tests');
});