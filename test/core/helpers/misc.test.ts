import { mergeAsyncGenerators } from '../../../src/core/helpers/misc';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('mergeAsyncGenerators', () => {
  // Helper function to create an async generator from an array
  async function* createAsyncGenerator<T>(values: T[], delay: number = 0): AsyncGenerator<T> {
    for (const value of values) {
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      yield value;
    }
  }

  it('should merge multiple async generators maintaining completion order', async () => {
    const gen1 = createAsyncGenerator([1, 2], 15);
    const gen2 = createAsyncGenerator([3, 4], 20);

    const merged = mergeAsyncGenerators(gen1, gen2);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(4);
    expect(results).toEqual([1, 3, 2, 4]);
  }); // Use Vitest's timeout option

  it('should handle empty array of generators', async () => {
    const merged = mergeAsyncGenerators();
    const results = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(0);
  });

  it('should handle single generator', async () => {
    const gen = createAsyncGenerator([1, 2, 3]);
    const merged = mergeAsyncGenerators(gen);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should handle generators of different lengths', async () => {
    const gen1 = createAsyncGenerator([1, 2]);
    const gen2 = createAsyncGenerator([3, 4, 5, 6]);

    const merged = mergeAsyncGenerators(gen1, gen2);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(6);
    expect(results).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]));
  });

  it('should handle generators that throw errors', async () => {
    async function* errorGenerator(): AsyncGenerator<number> {
      yield 1;
      throw new Error('Generator error');
    }

    const gen1 = createAsyncGenerator([1, 2, 3]);
    const gen2 = errorGenerator();

    const merged = mergeAsyncGenerators(gen1, gen2);

    await expect(async () => {
      const results: number[] = [];
      for await (const value of merged) {
        results.push(value);
      }
    }).rejects.toThrow('Generator error');
  });

  it('should handle different data types', async () => {
    const gen1 = createAsyncGenerator(['a', 'b', 'c']);
    const gen2 = createAsyncGenerator([1, 2, 3]);
    const gen3 = createAsyncGenerator([true, false]);

    const merged = mergeAsyncGenerators(
      gen1 as AsyncGenerator<string | number | boolean>,
      gen2 as AsyncGenerator<string | number | boolean>,
      gen3
    );

    const results: (string | number | boolean)[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(8);
    expect(results).toEqual(
      expect.arrayContaining(['a', 'b', 'c', 1, 2, 3, true, false])
    );
  });

  it('should handle very fast and very slow generators together', async () => {
    const fastGen = createAsyncGenerator([1, 2, 3], 0);
    const slowGen = createAsyncGenerator([4, 5, 6], 100);

    const merged = mergeAsyncGenerators(fastGen, slowGen);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(6);
    expect(results.slice(0, 3)).toEqual([1, 2, 3]); // Fast generator values should come first
    expect(results.slice(3)).toEqual([4, 5, 6]); // Slow generator values should come last
  });

  it('should handle generators that yield the same values', async () => {
    const gen1 = createAsyncGenerator([1, 1, 1]);
    const gen2 = createAsyncGenerator([1, 1, 1]);

    const merged = mergeAsyncGenerators(gen1, gen2);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(6);
    expect(results).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('should handle early termination of iteration', async () => {
    const gen1 = createAsyncGenerator([1, 2, 3]);
    const gen2 = createAsyncGenerator([4, 5, 6]);

    const merged = mergeAsyncGenerators(gen1, gen2);
    const results: number[] = [];

    // Only take first 3 values
    let count = 0;
    for await (const value of merged) {
      results.push(value);
      count++;
      if (count >= 3) break;
    }

    expect(results).toHaveLength(3);
  });

  it('should handle generators that yield no values', async () => {
    const gen1 = createAsyncGenerator([]);
    const gen2 = createAsyncGenerator([1, 2, 3]);

    const merged = mergeAsyncGenerators(gen1, gen2);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(3);
    expect(results).toEqual([1, 2, 3]);
  });

  it('should handle overlapping yields correctly', async () => {
    const gen1 = createAsyncGenerator([1, 2], 10);
    const gen2 = createAsyncGenerator([3, 4], 10);

    const merged = mergeAsyncGenerators(gen1, gen2);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(4);
    expect(results).toEqual(expect.arrayContaining([1, 2, 3, 4]));
  });

  it('should handle multiple generators throwing errors', async () => {
    async function* errorGen1() {
      throw new Error('Error in generator 1');
    }

    async function* errorGen2() {
      yield 1;
      throw new Error('Error in generator 2');
    }

    const merged = mergeAsyncGenerators(errorGen1(), errorGen2());

    await expect(async () => {
      for await (const value of merged) {
        // This line won't be reached for errorGen1
      }
    }).rejects.toThrow('Error in generator 1');
  });

  it('should handle large data sets efficiently', async () => {
    const largeGen = createAsyncGenerator(Array.from({ length: 10000 }, (_, i) => i));

    const merged = mergeAsyncGenerators(largeGen);
    const results: number[] = [];

    for await (const value of merged) {
      results.push(value);
    }

    expect(results).toHaveLength(10000);
  });
});
