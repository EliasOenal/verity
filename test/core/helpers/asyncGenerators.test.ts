import EventEmitter from 'events';
import { eventsToGenerator, mergeAsyncGenerators, parallelMap, resolveAndYield } from '../../../src/core/helpers/asyncGenerators';

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

  describe('basic Generator merging', () => {
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
    });

    it('should handle empty array of generators', async () => {
      const merged = mergeAsyncGenerators();
      const results: any[] = [];

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


    it('should handle large data sets efficiently', async () => {
      const largeGen = createAsyncGenerator(Array.from({ length: 10000 }, (_, i) => i));

      const merged = mergeAsyncGenerators(largeGen);
      const results: number[] = [];

      for await (const value of merged) {
        results.push(value);
      }

      expect(results).toHaveLength(10000);
    });
  });  // basic Generator merging

  describe('error handling', () => {
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
  });

  describe('early termination', () => {
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

    it('can be terminated while awaiting the next value', async () => {
      const emitter = new EventEmitter();
      const endlessGen = eventsToGenerator([{emitter, event: 'event'}]);

      const merged = mergeAsyncGenerators(endlessGen);
      const ret: any[] = [];
      const done: Promise<void> = (async () => {
        for await (const value of merged) ret.push(value)
      })();

      emitter.emit("event", "eventus primus");
      emitter.emit("event", "eventus secundus");
      emitter.emit("event", "eventus tertius");

      // yield control to allow generator to advance
      await new Promise(resolve => setTimeout(resolve, 0));

      merged.cancel();
      await done;

      expect(ret).toEqual(["eventus primus", "eventus secundus", "eventus tertius"]);
    });
  });

  describe('completion Promises', () => {
    it('should expose a "completions" property as an array of promises matching the generators count', async () => {
      const gen1 = createAsyncGenerator([10, 20]);
      const gen2 = createAsyncGenerator([30, 40, 50]);
      const merged = mergeAsyncGenerators(gen1, gen2);

      expect(Array.isArray(merged.completions)).toBe(true);
      expect(merged.completions.length).toBe(2);

      // Consume merged generator so that generators are advanced to completion.
      const yieldValues: number[] = [];
      for await (const value of merged) {
        yieldValues.push(value);
      }
      // Await all completion promises.
      await Promise.all(merged.completions);
      // Check that all items were yielded.
      expect(yieldValues).toEqual(expect.arrayContaining([10, 20, 30, 40, 50]));
    });

    it('should resolve each completion promise after its corresponding generator finishes', async () => {
      // Create a fast and a slow Generator
      const gen1 = createAsyncGenerator(['a', 'b'], 10);
      const gen2 = createAsyncGenerator(['c', 'd'], 200);

      // Merge the Generators
      const merged = mergeAsyncGenerators(gen1, gen2);

      // Push yielded values into an Array for ease of testing
      const values: string[] = [];
      (async () => { for await (const val of merged) values.push(val) })();

      // Wait for the fast Generator to complete
      await merged.completions[0];

      // Verify that all of the fast Generators values have indeed been yielded,
      // while none of the slow Generator values have been yielded yet.
      expect(values).toEqual(['a', 'b']);

      // Wait for the slow Generator to complete
      await merged.completions[1];

      // Verify the values include those from both generators.
      expect(values).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should support a single generator and return a completions array with one promise', async () => {
      const gen = createAsyncGenerator([100, 200, 300]);
      const merged = mergeAsyncGenerators(gen);
      const results: number[] = [];
      for await (const value of merged) {
        results.push(value);
      }
      expect(results).toEqual([100, 200, 300]);
      expect(merged.completions.length).toBe(1);
      // Each completion promise resolves with no value (undefined)
      await expect(Promise.all(merged.completions)).resolves.toEqual([undefined]);
    });

    it('should handle empty generators correctly (i.e. yield no values but still resolve completions)', async () => {
      const gen1 = createAsyncGenerator<number>([]);
      const gen2 = createAsyncGenerator<number>([]);
      const merged = mergeAsyncGenerators(gen1, gen2);
      const results: number[] = [];
      for await (const value of merged) {
        results.push(value);
      }
      expect(results).toEqual([]);
      // Even though no values are yielded, the completion promises should resolve.
      await Promise.all(merged.completions);
    });

    // In our current implementation, a generator that throws never calls its deferred resolve,
    // meaning its corresponding promise may not resolve.
    // maybe TODO change this?
    // The following test verifies that error propagation still occurs even if completions remain unsettled.
    it('should not resolve completion promise if the generator throws (i.e. iteration stops with error)', async () => {
      let didResolve = false;
      async function* faultyGenerator() {
        yield 'start';
        throw new Error('Test error');
      }
      const gen = faultyGenerator();
      const merged = mergeAsyncGenerators(gen);
      try {
        for await (const _ of merged) {
          // Do nothing.
        }
      } catch (err) {
        // Expected error.
      }
      // Race the completion promise with a timeout; if the promise resolves, we mark didResolve as true.
      await Promise.race([
        merged.completions[0].then(() => { didResolve = true; }),
        new Promise<void>(resolve => setTimeout(resolve, 50))
      ]);
      // In our implementation, the promise remains unresolved if the generator throws.
      expect(didResolve).toBe(false);
    });
  });  // completion Promises

  describe('addInputGenerator()', () => {
    it('should add a new input generator to the merged generator', async () => {
      const emitter = new EventEmitter();
      const firstInputGen = eventsToGenerator([{emitter: emitter, event: 'first'}]);
      const secondInputGen = eventsToGenerator([{emitter: emitter, event: 'second'}]);

      // Create the merged generator, first only with the first input generator
      const merged = mergeAsyncGenerators(firstInputGen);
      // Store yielded values to array for ease of testing
      const ret: any[] = [];
      const done: Promise<void> = (async () => {
        for await (const value of merged) ret.push(value)
      })();

      // Have firstInputGen yield something -- this should be re-yielded by merged.
      emitter.emit("first", "eventus primus");
      // yield control to allow generator to advance
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ret).toHaveLength(1);

      // Have secondInputGen yield something --
      // as secondInputGen is not added yet, this will NOT be re-yielded just yet.
      emitter.emit("second", "eventus secundus");
      // yield control, even though nothing should happen
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ret).toHaveLength(1);
      // Now add the second input generator
      merged.addInputGenerator(secondInputGen);
      // This causes the previous event, which has not yet been consumed, to
      // be re-yielded by the merged generator.
      // yield control to allow generator to advance
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ret).toHaveLength(2);

      // Have secondInputGen yield something -- this should be re-yielded by merged.
      emitter.emit("second", "eventus tertius");
      // yield control to allow generator to advance
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ret).toHaveLength(3);

      // Have firstInputGen yield something, which should obviously still be re-yielded by merged.
      emitter.emit("first", "eventus quartus");
      // yield control to allow generator to advance
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ret).toHaveLength(4);

      // And finally have secondInputGen yield again for good measure.
      emitter.emit("second", "eventus quintus");
      // yield control to allow generator to advance
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ret).toHaveLength(5);

      expect(ret).toEqual(["eventus primus", "eventus secundus", "eventus tertius", "eventus quartus", "eventus quintus"]);

      // Clean up
      merged.cancel();
      await done;
    });

    it('can add inputs to an empty but endless merged generator', async () => {
      // Create an empty merged generator and set it to endless
      const merged = mergeAsyncGenerators();
      merged.setEndless();

      // Run generator and store yielded values to array for ease of testing
      const ret: any[] = [];
      const done: Promise<void> = (async () => {
        for await (const value of merged) ret.push(value)
      })();

      // yield for a while, just to assert nothing happens :)
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(ret).toHaveLength(0);

      // Add an input generator
      const input = createAsyncGenerator(["eventus primus", "eventus secundus", "eventus tertius"]);
      merged.addInputGenerator(input);

      // yield to allow generator to advance
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ret).toHaveLength(3);
      expect(ret).toEqual(["eventus primus", "eventus secundus", "eventus tertius"]);

      // Clean up
      merged.cancel();
      await done;
    });
  });
});  // mergeAsyncGenerators()



describe("resolveAndYield", () => {
  describe('plain promise format, no metadata', () => {
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

  describe('with metadata', () => {
    it("should yield { value, meta } pairs in the order the promises resolve", async () => {
      const entries = [
        { promise: new Promise<string | undefined>(r => setTimeout(() => r('first'), 50)), meta: 'A' },
        { promise: new Promise<string | undefined>(r => setTimeout(() => r('second'), 10)), meta: 'B' },
        { promise: new Promise<string | undefined>(r => setTimeout(() => r('third'), 30)), meta: 'C' },
      ];

      const results: Array<{ value: string; meta: string }> = [];
      for await (const item of resolveAndYield(entries)) {
        results.push(item);
      }

      expect(results).toEqual([
        { value: 'second', meta: 'B' },
        { value: 'third',  meta: 'C' },
        { value: 'first',  meta: 'A' },
      ]);
    });

    it("should skip entries resolving to undefined (and omit their metadata)", async () => {
      const entries = [
        { promise: Promise.resolve<number | undefined>(undefined), meta: { id: 1 } },
        { promise: Promise.resolve<number | undefined>(42),      meta: { id: 2 } },
        { promise: Promise.resolve<number | undefined>(undefined), meta: { id: 3 } },
      ];

      const results: Array<{ value: number; meta: { id: number } }> = [];
      for await (const item of resolveAndYield(entries)) {
        results.push(item);
      }

      expect(results).toEqual([
        { value: 42, meta: { id: 2 } },
      ]);
    });

    it("should handle all entries resolving immediately and preserve their metadata order", async () => {
      const entries = [
        { promise: Promise.resolve(1), meta: 'one' },
        { promise: Promise.resolve(2), meta: 'two' },
        { promise: Promise.resolve(3), meta: 'three' },
      ];

      const results: Array<{ value: number; meta: string }> = [];
      for await (const item of resolveAndYield(entries)) {
        results.push(item);
      }

      expect(results).toEqual([
        { value: 1, meta: 'one' },
        { value: 2, meta: 'two' },
        { value: 3, meta: 'three' },
      ]);
    });
  });
});


describe('parallelMap', () => {
  it('yields mapped values in the order of resolution, skipping undefined', async () => {
    const inputs = [1, 2, 3]
    const mapper = (n: number) => {
      const delay = n === 2 ? 50 : n === 3 ? 10 : 30
      return new Promise<string | undefined>(resolve => {
        setTimeout(() => {
          // skip even numbers
          resolve(n % 2 === 0 ? undefined : `val${n}`)
        }, delay)
      })
    }

    const results: string[] = []
    for await (const v of parallelMap(inputs, mapper)) {
      results.push(v)
    }

    // 3 resolves first (10ms), then 1 (30ms), 2 is skipped
    expect(results).toEqual(['val3', 'val1'])
  })

  it('handles an empty input array', async () => {
    const mapper = async (n: number) => `x${n}`
    const results: string[] = []
    for await (const v of parallelMap([], mapper)) {
      results.push(v)
    }
    expect(results).toEqual([])
  })

  it('passes the correct index to the mapper', async () => {
    const calls: Array<{ item: number; idx: number }> = []
    const mapper = async (item: number, idx: number) => {
      calls.push({ item, idx })
      return `${item * 2}`
    }

    const results: string[] = []
    for await (const v of parallelMap([10, 20, 30], mapper)) {
      results.push(v)
    }

    // All three should map, order of resolution here is immediate.
    expect(results).toEqual(['20', '40', '60'])
    expect(calls).toEqual([
      { item: 10, idx: 0 },
      { item: 20, idx: 1 },
      { item: 30, idx: 2 },
    ])
  })

  it('bubbles errors thrown by the mapper', async () => {
    const inputs = [1, 2, 3]
    const mapper = async (n: number) => {
      if (n === 2) throw new Error('mapper failed on 2')
      return n
    }

    await expect(async () => {
      for await (const _ of parallelMap(inputs, mapper)) {
        // no-op
      }
    }).rejects.toThrow('mapper failed on 2')
  })

  it('works with all promises resolving immediately', async () => {
    const inputs = ['a', 'b', 'c']
    const mapper = async (s: string) => s.toUpperCase()
    const results: string[] = []

    for await (const v of parallelMap(inputs, mapper)) {
      results.push(v)
    }

    expect(results).toEqual(['A', 'B', 'C'])
  })

  it('handles a large number of inputs efficiently', async () => {
    const N = 500
    const inputs = Array.from({ length: N }, (_, i) => i)
    const mapper = (i: number) =>
      new Promise<number>(resolve =>
        setTimeout(() => resolve(i * 2), Math.random() * 20)
      )

    const results: number[] = []
    for await (const v of parallelMap(inputs, mapper)) {
      results.push(v)
    }

    expect(results).toHaveLength(N)
    // every input mapped to i*2
    expect(new Set(results)).toEqual(new Set(inputs.map(i => i * 2)))
  })
})


describe('eventsToGenerator()', () => {
  describe('yielding correct values', () => {
    it('yields events in the order they are emitted', async () => {
      const emitter = new EventEmitter();

      const generator = eventsToGenerator([
        { emitter: emitter, event: 'event' },
      ]);

      // Emit events -- but only after a short while as eventsToGenerator()
      // is not listening yet.
      setTimeout(() => {
        emitter.emit('event', 'data1');
        emitter.emit('event', 'data2');
        emitter.emit('event', 'data3');
        emitter.emit('event', 'data4');
        emitter.emit('event', 'data5');
        emitter.emit('event', 'data6');
        emitter.emit('event', 'data7');
        emitter.emit('event', 'data8');
        emitter.emit('event', 'data9');
      }, 100);

      // Test event yielding with for...of loop
      const results: any[] = [];
      for await (const event of generator) {
        results.push(event);
        if (results.length === 9) break;
      }

      expect(results[0]).toEqual('data1');
      expect(results[1]).toEqual('data2');
      expect(results[2]).toEqual('data3');
      expect(results[3]).toEqual('data4');
      expect(results[4]).toEqual('data5');
      expect(results[5]).toEqual('data6');
      expect(results[6]).toEqual('data7');
      expect(results[7]).toEqual('data8');
      expect(results[8]).toEqual('data9');
    });

    it('handles multiple emitters and events properly', async () => {
      const emitter1 = new EventEmitter();
      const emitter2 = new EventEmitter();
      const emitter3 = new EventEmitter();

      const generator = eventsToGenerator([
        { emitter: emitter1, event: 'event1' },
        { emitter: emitter2, event: 'event2' },
        { emitter: emitter3, event: 'event3' }
      ]);

      setTimeout(() => {
        emitter1.emit('event1', 'data1');
        emitter2.emit('event2', 'data2');
        emitter3.emit('event3', 'data3');
      }, 100);

      const results: any[] = [];
      for await (const event of generator) {
        results.push(event);
        if (results.length === 3) break;
      }

      expect(results[0]).toEqual('data1');
      expect(results[1]).toEqual('data2');
      expect(results[2]).toEqual('data3');
    });

    it('yields undefined if event is emitted with undefined data', async () => {
      const emitter = new EventEmitter();
      const generator = eventsToGenerator([{ emitter, event: 'event' }]);

      setTimeout(() => {
        emitter.emit('event', undefined);
      }, 100);

      const { value, done } = await generator.next();
      expect(value).toBeUndefined();

      // Terminate the generator to clean up the listener.
      await generator.return(undefined);
    });

    it('yields an Array for multi parameter events', async () => {
      const emitter = new EventEmitter();
      const generator = eventsToGenerator([{ emitter, event: 'event' }]);

      setTimeout(() => {
        emitter.emit('event', "Eventus multivarius", "notitia", "multa notitia");
      }, 100);

      const { value, done } = await generator.next();
      expect(value).toEqual(["Eventus multivarius", "notitia", "multa notitia"]);

      // Terminate the generator to clean up the listener.
      await generator.return(undefined);
    });
  });  // yielding correct values

  describe('termination', () => {
    it('cleans up listeners when the generator is done', async () => {
      const emitter = new EventEmitter();
      const generator = eventsToGenerator([{ emitter, event: 'event1' }]);

      // Add a spy to track listener removal
      const removeListenerSpy = vi.spyOn(emitter, 'removeListener');

      // Emit an event and consume it
      setTimeout(() => {
        emitter.emit('event1', 'data1');
      }, 100);
      const results: any[] = [];
      for await (const event of generator) {
        results.push(event);
        if (results.length === 1) break;  // closes the generator
      }

      // Check that removeListener was called
      expect(removeListenerSpy).toHaveBeenCalledTimes(1);
      expect(removeListenerSpy).toHaveBeenCalledWith('event1', expect.any(Function));
    });


    it('can terminate the generator externally', async () => {
      const emitter = new EventEmitter();

      const generator = eventsToGenerator([
        { emitter: emitter, event: 'event' },
      ]);

      // Emit events -- but only after a short while as eventsToGenerator()
      // is not listening yet.
      setTimeout(() => {
        emitter.emit('event', 'data1');
        emitter.emit('event', 'data2');
        emitter.emit('event', 'data3');
      }, 100);

      // Test event yielding with for...of loop
      // Do this from within another, idenpendently scheduled async function
      const results: any[] = [];
      (async() => {
        for await (const event of generator) {
          results.push(event);
          // note no break, without external intervention this is an endless loop
        }
      })();

      // after another 100ms, terminate the generator
      await new Promise(resolve => setTimeout(resolve, 200));
      generator.return(undefined);
      expect(results.length).toBe(3);
      expect(results[0]).toEqual('data1');
      expect(results[1]).toEqual('data2');
      expect(results[2]).toEqual('data3');
    });
  });  // termination

  describe('options', () => {
    describe('transform', () => {
      it('runs the transformation function if supplied', async () => {
        const emitter = new EventEmitter();

        const toIntAndDouble: (input: string) => number =
          (input: string) => Number.parseInt(input) * 2;

        const generator = eventsToGenerator(
          [{ emitter: emitter, event: 'event' }],
          { transform: toIntAndDouble },
        );


        // Emit events -- but only after a short while as eventsToGenerator()
        // is not listening yet.
        setTimeout(() => {
          emitter.emit('event', '1');
          emitter.emit('event', '2');
          emitter.emit('event', '3');
        }, 100);

        // Test event yielding with for...of loop
        const results: any[] = [];
        for await (const event of generator) {
          results.push(event);
          if (results.length === 3) break;
        }

        expect(results[0]).toBe(2);
        expect(results[1]).toBe(4);
        expect(results[2]).toBe(6);
      });

      it('can transform multi parameter events', async () => {
        const emitter = new EventEmitter();
        const generator = eventsToGenerator([{ emitter, event: 'event' }], {
          transform: (...input: string[]) => input[1]
        });

        setTimeout(() => {
          emitter.emit('event', "Eventus multivarius", "notitia", "multa notitia");
        }, 100);

        const { value, done } = await generator.next();
        expect(value).toEqual("notitia");

        // Terminate the generator to clean up the listener.
        await generator.return(undefined);
      });
    });  // transform

    describe('limit', () => {
      it('excludes events if the limit function returns false', async () => {
        const emitter = new EventEmitter();

        const limit: (input: string) => boolean = input => input !== '2';

        const generator = eventsToGenerator(
          [{ emitter: emitter, event: 'event' }], { limit },
        );

        // Emit events -- but only after a short while as eventsToGenerator()
        // is not listening yet.
        setTimeout(() => {
          emitter.emit('event', '1');
          emitter.emit('event', '2');
          emitter.emit('event', '3');
        }, 100);

        // Test event yielding with for...of loop
        const results: any[] = [];
        for await (const event of generator) {
          results.push(event);
          if (results.length === 2) break;
        }

        expect(results[0]).toBe('1');
        expect(results[1]).toBe('3');
      });

      it('can apply limits to multi parameter events', async () => {
        const emitter = new EventEmitter();
        const generator = eventsToGenerator([{ emitter, event: 'event' }],
          { limit: (...input: string[]) => input.some(item => item === 'magna notitia') }
        );

        setTimeout(() => {
          emitter.emit('event', "casualis notitia", "famae notitia", "inutilis notitia");
        }, 100);
        setTimeout(() => {
          emitter.emit('event', "politica notitia", "magna notitia", "oeconomica notitia");
        }, 200);

        const { value, done } = await generator.next();
        expect(value).toEqual(["politica notitia", "magna notitia", "oeconomica notitia"]);

        // Terminate the generator to clean up the listener.
        await generator.return(undefined);
      });
    })
  });  // options

  describe('edge cases', () => {
    it('handles empty emitter array gracefully', async () => {
      const generator = eventsToGenerator([]);

      // Terminate the generator after a short delay since no events will ever be emitted.
      setTimeout(() => {
        generator.return(undefined);
      }, 100);

      const results: any[] = [];
      for await (const event of generator) {
        results.push(event);
      }

      expect(results).toEqual([]);
    });
  });  // edge cases
});