import EventEmitter from "events";

/**
 * A helper type that extends AsyncGenerator, used as return type for the
 * `mergeAsyncGenerators` helper function.
 */
export type MergedAsyncGenerator<T> = AsyncGenerator<T> & {
  completions: Promise<void>[];
};

/**
 * Helper function to merge multiple async generators into one.
 * It accepts any number of async generators and yields all of their values
 * in the order they are received.
 * Optionally tracks completion of each input generator via `completions`
 * property on the returned async generator.
 */
export function mergeAsyncGenerators<T>(
  ...generators: AsyncGenerator<T>[]
): MergedAsyncGenerator<T> {
  // Hi, welcome to this beautiful helper function!
  // It's more of an ad-hoc object, to be honest.
  // So let's start by creating some helpers.
  // You could also call those attributes and methods, if you're so inclined.

  // Here's a list of promises that will tell us when any individual input
  // generator is done.
  const inputGensDone = generators.map(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  });

  // Here's an Array of promises for the next values for each generator
  const nextPromises: Promise<IteratorResult<T>>[] = generators.map((gen) =>
    gen.next()
  );

  // Now here comes the main part: Define the async generator body itself
  async function* merged(): AsyncGenerator<T> {
    while (nextPromises.length > 0) {
      // Wait for any promise to resolve, and note which generator (index) it came from
      const { value, index } = await Promise.race(
        nextPromises.map((nextPromise, genIndex) =>
          nextPromise.then((result) => ({ value: result, index: genIndex })))
      );

      // Well, we got a resolved promise! What could that be?
      // - Is it just a signal that we should re-run our loop, probably because
      //   an extra input generator was added?
      // TODO implement
      // - Is it an abort signal, telling us we should stop?
      // TODO implement
      // - It it because one of the input generators has ended?
      if (value.done) {
        // When a generator ends, resolve its deferred promise.
        inputGensDone[index].resolve();

        // Remove that generator, its promise, and its deferred from the arrays.
        nextPromises.splice(index, 1);
        generators.splice(index, 1);
        inputGensDone.splice(index, 1);
      }
      // - Or is it because there's actually a value to yield?
      else {
        // Yield the coming value and immediately request the next one.
        yield value.value;
        nextPromises[index] = generators[index].next();
      }
    }
  }

  // Create the async generator instance.
  const asyncGen: MergedAsyncGenerator<T> = merged() as MergedAsyncGenerator<T>;

  // Let's go ahead and enhance the async generator with the additional
  // properties we defined:
  // - Attach the `completions` property (an array of promises indicating
  //   which of the input generators have completed).
  asyncGen.completions = inputGensDone.map(deferred => deferred.promise);
  return asyncGen;
}



/**
 * Asynchronously yields values from an array of promises as they resolve, in the order they are fulfilled.
 * Promises resolving to `undefined` are skipped and not yielded.
 *
 * @template T - The type of values resolved by the promises.
 * @param promises - An array of promises that resolve to either a value of type `T` or `undefined`.
 * @returns An `AsyncGenerator` that yields values of type `T` as soon as their corresponding promises resolve.
 *
 * @example
 * ```typescript
 * const promises = [
 *     new Promise<number | undefined>(resolve => setTimeout(() => resolve(1), 300)),
 *     new Promise<number | undefined>(resolve => setTimeout(() => resolve(undefined), 200)),
 *     new Promise<number | undefined>(resolve => setTimeout(() => resolve(2), 100)),
 * ];
 *
 * for await (const value of resolveAndYield(promises)) {
 *     console.log(value); // Logs: 2, then 1
 * }
 * ```
 *
 * @remarks
 * - This function uses `Promise.race` to process the promises as they resolve.
 * - Promises that resolve to `undefined` are ignored and not yielded.
 * - The function will continue until all promises in the input array are resolved.
 * - If a promise rejects, the rejection must be handled externally to prevent unhandled promise rejections.
 *
 * @throws This function does not handle rejected promises internally. Ensure that you handle rejections in the input promises, e.g., by using `.catch()` before passing them to this function.
 */

export async function* resolveAndYield<T>(
  promises: Promise<T | undefined>[]
): AsyncGenerator<T, void, undefined> {
  const pending: Set<Promise<T | undefined>> = new Set(promises); // Set of pending promises
  const promiseMap: Map<Promise<T | undefined>, Promise<{ value: T | undefined; promise: Promise<T | undefined>; }>> = new Map(
    promises.map(p => [
      p,
      p.then(value => ({ value, promise: p }))
    ])
  );

  while (pending.size > 0) {
    const { value, promise } = await Promise.race(promiseMap.values()); // Wait for the first promise to resolve

    pending.delete(promise); // Remove the resolved promise from the set
    promiseMap.delete(promise); // Remove it from the map

    if (value !== undefined) {
      yield value; // Yield the resolved value if it's not undefined
    }
  }
}


export interface EventsToGeneratorOptions<
  Emitted extends unknown[],
  Transformed = Emitted extends [infer T] ? T : Emitted
> {
  /**
   * If supplied, all emitted data will be passed through this transformation
   * function before yielding.
   */
  transform?: (...args: [...Emitted]) => Transformed;
  /**
   * Limits which events should be yielded.
   * The supplied function shall return `true` if the emitted data should be yielded.
   */
  limit?: (...args: [...Emitted]) => boolean;
}

/**
 * An async generator that listens to multiple event emitters and yields events as they occur.
 *
 * In the absence of a custom transform:
 * - If an event emits a single value, that value is yielded.
 * - If it emits multiple values, the tuple of values is yielded.
 *
 * Both `limit` and `transform` now receive a dynamic number of arguments.
 *
 * @param emitters - An array of objects, each containing an EventEmitter and an event name.
 * @param options  - Optional filter and transformation functions.
 * @returns An async generator yielding event data in a backward-compatible manner.
 */
export async function* eventsToGenerator<
  Emitted extends unknown[],
  Transformed = Emitted extends [infer T] ? T : Emitted
>(
  emitters: { emitter: EventEmitter; event: string }[],
  options: EventsToGeneratorOptions<Emitted, Transformed> = {}
): AsyncGenerator<Transformed> {
  // Sanity check: If no emitters are provided, exit immediately.
  if (emitters.length === 0) {
    return;
  }

  // Queue to store emitted events (each as a tuple of arguments).
  const queue: Emitted[] = [];
  let resolveQueue: (() => void) | null = null;

  // Event handler that collects the full set of arguments.
  const createHandler = (event: string) => (...args: Emitted): void => {
    // Call limit with the dynamic set of arguments—backwards compatible.
    if (options.limit && options.limit(...args) === false) return;
    queue.push(args);
    if (resolveQueue) {
      resolveQueue();
      resolveQueue = null;
    }
  };

  // Subscribe to each event; store a cleanup function for each.
  const unsubscribeFns: (() => void)[] = emitters.map(({ emitter, event }): (() => void) => {
    const listener = createHandler(event);
    emitter.on(event, listener);
    return () => emitter.removeListener(event, listener);
  });

  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => (resolveQueue = resolve));
      }
      while (queue.length > 0) {
        const args: Emitted = queue.shift()!;
        let output: Transformed;
        // Call the transform function with dynamic arguments if provided.
        // Otherwise, yield a single value or the full tuple based on the number of arguments.
        if (options.transform) {
          output = options.transform(...args);
        } else {
          output = (args.length === 1 ? args[0] : args) as unknown as Transformed;
        }
        yield output;
      }
    }
  } finally {
    if (resolveQueue) resolveQueue();
    for (const unsubscribe of unsubscribeFns) {
      unsubscribe();
    }
  }
}
