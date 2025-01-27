import { mergeAsyncGenerators, resolveAndYield } from '../../../src/core/helpers/misc';

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
});  // mergeAsyncGenerators()



describe("resolveAndYield", () => {
  it("should yield values in the order the promises resolve", async () => {
      const promises = [
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(1), 300)),
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(undefined), 200)),
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(2), 100)),
      ];

      const results: number[] = [];
      for await (const value of resolveAndYield(promises)) {
          results.push(value);
      }

      expect(results).toEqual([2, 1]);
  });

  it("should handle an empty array of promises", async () => {
      const promises: Promise<number | undefined>[] = [];
      const results: number[] = [];

      for await (const value of resolveAndYield(promises)) {
          results.push(value);
      }

      expect(results).toEqual([]);
  });

  it("should not yield undefined values", async () => {
      const promises = [
          Promise.resolve(1),
          Promise.resolve(undefined),
          Promise.resolve(2),
      ];

      const results: number[] = [];
      for await (const value of resolveAndYield(promises)) {
          results.push(value);
      }

      expect(results).toEqual([1, 2]);
  });

  it("should yield results as they arrive, not waiting for long-pending promises", async () => {
      const start = Date.now();

      const promises = [
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(1), 100)),
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(2), 300)),
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(3), 500)),
      ];

      const results: { value: number; time: number }[] = [];
      for await (const value of resolveAndYield(promises)) {
          results.push({ value, time: Date.now() - start });
      }

      expect(results.length).toBe(3);
      expect(results[0].value).toBe(1);
      expect(results[1].value).toBe(2);
      expect(results[2].value).toBe(3);

      // Verify that results are yielded approximately at the expected times
      expect(results[0].time).toBeGreaterThanOrEqual(95);
      expect(results[0].time).toBeLessThan(200);
      expect(results[1].time).toBeGreaterThanOrEqual(295);
      expect(results[1].time).toBeLessThan(400);
      expect(results[2].time).toBeGreaterThanOrEqual(495);
      expect(results[2].time).toBeLessThan(600);
  });

  it("should handle a mix of resolved and pending promises", async () => {
      const promises = [
          Promise.resolve(1),
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(2), 100)),
          Promise.resolve(undefined),
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(3), 200)),
      ];

      const results: number[] = [];
      for await (const value of resolveAndYield(promises)) {
          results.push(value);
      }

      expect(results).toEqual([1, 2, 3]);
  });

  it("should work with promises that reject (skip rejections)", async () => {
      const promises = [
          Promise.resolve(1),
          Promise.reject(new Error("Failed")),
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(2), 100)),
      ];

      const results: number[] = [];
      const errors: Error[] = [];

      for await (const value of resolveAndYield(
          promises.map(p =>
              p.catch(err => {
                  errors.push(err);
                  return undefined;
              })
          )
      )) {
          results.push(value);
      }

      expect(results).toEqual([1, 2]);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("Failed");
  });

  it("should handle a large number of promises efficiently", async () => {
      const promises = Array.from({ length: 1000 }, (_, i) =>
          new Promise<number | undefined>(resolve => setTimeout(() => resolve(i), Math.random() * 1000))
      );

      const results: number[] = [];
      for await (const value of resolveAndYield(promises)) {
          results.push(value);
      }

      // Verify that all values were yielded
      expect(results).toHaveLength(1000);
      expect(new Set(results).size).toBe(1000); // All unique values
  });

  it("should handle cases where all promises resolve immediately", async () => {
      const promises = [
          Promise.resolve(1),
          Promise.resolve(2),
          Promise.resolve(3),
      ];

      const results: number[] = [];
      for await (const value of resolveAndYield(promises)) {
          results.push(value);
      }

      expect(results).toEqual([1, 2, 3]);
  });
});
