import EventEmitter from "events";

/**
 * A helper type for AsyncGenerators which are based on internally awaiting
 * promises, allowing them to be cancelled externally by calling cancel().
 * Note that the standard return() call will not work properly on promise-based
 * AsyncGenerators as it cannot interrupt the Generator while it is awaiting
 * a promise.
 */
export type CancellableGenerator<T> = AsyncGenerator<T> & {
  /** Interrupts the Generator, causing it to return immediately. */
  cancel(): void;
}

/**
 * A helper type that extends AsyncGenerator, used as return type for the
 * `mergeAsyncGenerators` helper function. It enhances regular AsyncGenerators
 * with additional methods.
 */
export type MergedAsyncGenerator<T> = CancellableGenerator<T> & {
  /**
   * A list of promises resolving at the completion of each individual input
   * generator. The list is in the same order as the input generators.
   **/
  completions: Promise<void>[];

  /**
   * Adds an additional input generator.
   * Can be used at any time after construction but before the Generator terminates.
   **/
  addInputGenerator(generator: AsyncGenerator<T>): void;

  /**
   * Makes the Generator never finish, even if all of its
   * input generators are done. It must thus be terminated externally by calling
   * cancel(). Useful in combination with addInputGenerator().
   **/
  setEndless(endless?: boolean): void;
};

/**
 * Helper function to merge multiple async generators into one.
 * It accepts any number of async generators and yields all of their values
 * in the order they are received.
 * @returns An AsyncGenerator with the following additional features:
 *   - Tracks completion of each input generator via the `completions` property
 *   - Can be aborted at any time by calling .cancel() on it,
 *     even while it is awaiting the next value.
 *     Note that in contrast the standard .return() call will only take effect
 *     after the next value has been yielded.
 *   - Additional input generators can be added via the `addInputGenerator`
 *     method. This obviously only works as long as the generator is not done
 *     yet, i.e. the existing input generators have not completed.
 *   - If needed, you can artificially make the generator never finish by
 *     calling `setEndless()` on it (reversible by calling `setEndless(false)`).
 */
export function mergeAsyncGenerators<T>(
  ...generators: AsyncGenerator<T>[]
): MergedAsyncGenerator<T> {
  // Hi, welcome to this beautiful helper function!
  // It's more of an ad-hoc object, to be honest.
  // So let's start by creating some helpers.
  // You could also call those attributes and methods, if you're so inclined.

  // Here's an Array of promises for the next values for each generator
  const nextPromises: Promise<IteratorResult<T>>[] = [];

  // Promise 0 is a special extra promise that will allow us to interrupt the
  // loop at any time.
  const reloadSignal = {signal: 'reload' };  // will actually be compared by ref
  const abortSignal = {signal: 'abort' };  // will actually be compared by ref
  let interruptPromiseResolve: (signal: Object) => void;
  let interruptPromise: Promise<Object> = new Promise((res) => {
    interruptPromiseResolve = res;
  })
  nextPromises.push(interruptPromise as Promise<IteratorResult<T>>);  // HACKHACK typecast

  // Now add the actual next value promises
  nextPromises.push(...generators.map((gen) =>
    gen.next()
  ));

  // Here's a list of promises that will tell us when any individual input
  // generator is done.
  const inputGenDone = () => {
    let resolve: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }
  const inputGensDone = generators.map(() => inputGenDone());

  // On demand (but not by default), this generator can be made endless even
  // if all of its input generators are done.
  let endless = false;

  // Now here comes the main part:
  // Define the async generator body itself
  async function* merged(): AsyncGenerator<T> {
    while (endless || nextPromises.length > 1) {  // >1 because index 0 is just our interrupt promise
      // Wait for any promise to resolve, and note which generator (index) it came from
      const { value, index } = await Promise.race(
        nextPromises.map((nextPromise, genIndex) =>
          nextPromise.then((result) => ({ value: result, index: genIndex })))
      );
      const nextPromisesIndex = index;
      const generatorsIndex = index - 1;

      // Well, we got a resolved promise! What could that be?
      // - Is it just a signal that we should re-run our loop, probably because
      //   an extra input generator was added?
      if (Object.is(value, reloadSignal)) {
        continue;
      }
      // - Is it an abort signal, telling us we should stop?
      else if (Object.is(value, abortSignal)) {
        return;  // if our boss tells us we're done, we're done
      }
      // - It it because one of the input generators has ended?
      else if (value.done) {
        // When a generator ends, resolve its deferred promise.
        inputGensDone[generatorsIndex].resolve();

        // Remove that generator, its promise, and its deferred from the arrays.
        nextPromises.splice(nextPromisesIndex, 1);
        generators.splice(generatorsIndex, 1);
        inputGensDone.splice(generatorsIndex, 1);
      }
      // - Or is it because there's actually a value to yield?
      else {
        // Yield the coming value and immediately request the next one.
        yield value.value;
        nextPromises[nextPromisesIndex] = generators[generatorsIndex].next();
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
  // - Attach the cancel() method to be able to interrupt the Generator while it is
  //   awaiting the next promise
  asyncGen.cancel = () => {
    interruptPromiseResolve(abortSignal);
    return undefined;
  };
  // - Add helper function `addInputGenerator` to be able to add a new input
  //   generator after the Generator has already started.
  asyncGen.addInputGenerator = (gen: AsyncGenerator<T>) => {
    generators.push(gen);
    // Add a promise for the next value for the new generator
    nextPromises.push(gen.next());
    // Add a deferred promise for the completion of the new generator
    inputGensDone.push(inputGenDone());
    // Fire and replace our interrupt promise to make the Generator reload
    // its loop.
    interruptPromiseResolve(reloadSignal);
    interruptPromise = new Promise((res) => {
      interruptPromiseResolve = res;
    });
    nextPromises[0] = interruptPromise as Promise<IteratorResult<T>>;
  };
  // - Add `setEndless` method to be able to make the Generator endless
  //   even if all of its input generators are done.
  asyncGen.setEndless = (arg: boolean = true) => {
    endless = arg;
  };

  return asyncGen;
}


export interface ResolveYieldEntry<T, M> {
  promise: Promise<T | undefined>;
  meta: M;
}

export interface ResolveYieldResult<T, M> {
  value: T;
  meta: M;
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
 * @throws This function does not handle rejected promises internally.
 *   Ensure that you handle rejections in the input promises, e.g., by using
 * `.catch()` before passing them to this function.
 */
export function resolveAndYield<T>(
  promises: Array<Promise<T | undefined>>
): AsyncGenerator<T, void, undefined>;

/**
 * Races an array of promise–metadata entries and yields each resolved value together with its metadata,
 * in the order the promises settle. Promises resolving to `undefined` are skipped.
 *
 * @template T - The type of the values resolved by the promises.
 * @template M - The type of metadata associated with each promise.
 *
 * @param entries
 *   Array of objects, each with:
 *     - `promise`: a `Promise<T | undefined>` whose resolution you want to await.
 *     - `meta`: arbitrary metadata of type `M` to be paired with the resolved value.
 *
 * @returns
 *   An `AsyncGenerator` that yields objects of shape `{ value: T; meta: M }` as soon as
 *   their corresponding promises resolve (and skip any that resolve to `undefined`).
 *
 * @example
 * ```ts
 * interface Entry { promise: Promise<string | undefined>; meta: 'user' | 'config' }
 *
 * const entries: Entry[] = [
 *   { promise: fetchUsername(),    meta: 'user'   },
 *   { promise: fetchAppSettings(), meta: 'config' },
 * ];
 *
 * for await (const { value, meta } of resolveAndYield(entries)) {
 *   console.log(meta, value);
 * }
 * // Possible output:
 * // user alice
 * // config { theme: 'dark' }
 * ```
 *
 * @remarks
 * - Internally uses `Promise.race` on the fixed set of promises.
 * - All input promises must be provided up-front; you cannot add entries mid-stream.
 *
 * @throws This function does not handle rejected promises internally.
 *   Ensure that you handle rejections in the input promises, e.g., by using
 * `.catch()` before passing them to this function.
 */
export function resolveAndYield<T, M>(
  entries: Array<ResolveYieldEntry<T, M>>
): AsyncGenerator<ResolveYieldResult<T, M>, void, undefined>;

export async function* resolveAndYield<T, M>(
  items: Array<Promise<T | undefined> | ResolveYieldEntry<T, M>>
): AsyncGenerator<any, void, undefined> {
  // Detect form
  const isRaw = items.length > 0 && typeof (items[0] as any).then === 'function' && !(items[0] as any).meta;

  // Normalize to array of { promise, meta }
  const entries: Array<ResolveYieldEntry<T, M>> = isRaw
    ? (items as Promise<T | undefined>[]).map(p => ({ promise: p, meta: undefined! }))
    : (items as ResolveYieldEntry<T, M>[]);

  // Tag each entry with a unique index
  type RaceRecord = {
    id: number;
    wrapped: Promise<{ id: number; value: T | undefined; meta: M }>;
  };

  const races: RaceRecord[] = entries.map((entry, id) => ({
    id,
    wrapped: entry.promise.then(value => ({ id, value, meta: entry.meta })),
  }));

  // Race them one by one
  while (races.length) {
    // Wait for the next promise to finish
    const { id, value, meta } = await Promise.race(races.map(r => r.wrapped));

    // Remove that record so it doesn’t fire again
    const idx = races.findIndex(r => r.id === id);
    races.splice(idx, 1);

    // Only yield defined values
    if (value !== undefined) {
      if (isRaw) {
        yield value;
      } else {
        yield { value, meta };
      }
    }
  }
}


/**
 * Transforms an array of inputs in parallel using an asynchronous mapper,
 * yielding results as soon as they resolve and skipping any that return `undefined`.
 *
 * @template I  Type of each input item.
 * @template O  Type of each output value.
 *
 * @param inputs
 *   Array of input items to be transformed.
 *
 * @param mapper
 *   An async function that takes an input item and its index, returning
 *   either an `O` or `undefined` (to filter out unwanted results).
 *
 * @returns
 *   An `AsyncGenerator` that yields each mapped value of type `O` as soon as
 *   its promise resolves, in the order of resolution.
 *
 * @example
 * ```ts
 * interface User { id: number }
 * interface Details { name: string; age: number }
 *
 * async function fetchUserDetails(id: number): Promise<Details | undefined> {
 *   if (id % 2 === 0) {
 *     // pretend even‐ID users don’t exist
 *     return undefined;
 *   }
 *   return { name: `User${id}`, age: 20 + id };
 * }
 *
 * const users: User[] = [
 *   { id: 1 }, { id: 2 }, { id: 3 }
 * ];
 *
 * for await (const details of parallelMap(users, (user) => fetchUserDetails(user.id))) {
 *   console.log(details);
 * }
 * // Possible output:
 * // { name: 'User3', age: 23 }
 * // { name: 'User1', age: 21 }
 * // (skips id=2 because mapper returned undefined)
 * ```
 *
 * @remarks
 * - Uses `resolveAndYield` under the hood; all input promises are kicked off immediately.
 * - If you need to preserve the original input order, collect results into an array
 *   and sort by index (you can pass index as metadata to `resolveAndYield`).
 * - Errors thrown by `mapper` will bubble; you can `.catch()` inside your mapper
 *   if you want to skip or handle failures.
 */
export async function* parallelMap<I, O>(
  inputs: I[],
  mapper: (item: I, index: number) => Promise<O | undefined>
): AsyncGenerator<O, void, undefined> {
  // Attach each mapper call with its index as metadata
  const entries = inputs.map((item, index) => ({
    promise: mapper(item, index),
    meta: index,
  }));

  // Use resolveAndYield to drive parallel resolution
  for await (const { value } of resolveAndYield(entries)) {
    yield value;
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
export function eventsToGenerator<
  Emitted extends unknown[],
  Transformed = Emitted extends [infer T] ? T : Emitted
>(
  emitters: { emitter: EventEmitter; event: string }[],
  options: EventsToGeneratorOptions<Emitted, Transformed> = {}
): CancellableGenerator<Transformed> {
  // Define a queue to store emitted events (each as a tuple of arguments).
  const queue: Emitted[] = [];
  let resolveQueue: (() => void) | null = null;

  // Define a cancellation flag, which will cause our generator (defined below)
  // to abort. This flag can be set externally by calling cancel() on the generator.
  let cancelled = false;

  // Define an event handler which pushes emitted events to the queue
  // (the generator [defined below] will then yield queued values one by one).
  const eventHandler = (event: string) => (...args: Emitted): void => {
    // If there is a user-defined limit function (i.e. an event filter),
    // only accept events that pass the filter.
    if (options.limit && options.limit(...args) === false) return;
    // Looks good, push the event value to the queue
    queue.push(args);
    // If the generator is currently sleeping, wake it up
    if (resolveQueue) {
      resolveQueue();
      resolveQueue = null;
    }
  };

  // Subscribe to each event; store a cleanup function for each.
  const unsubscribeFns: (() => void)[] = emitters.map(({ emitter, event }): (() => void) => {
    const listener = eventHandler(event);
    emitter.on(event, listener);
    return () => emitter.removeListener(event, listener);
  });

  // Now here comes the main part:
  // Define the async generator body itself
  async function* gen(): AsyncGenerator<Transformed> {
    // Sanity check: If no emitters are provided, exit immediately.
    if (emitters.length === 0) {
      return;
    }

    try {
      while (true) {
        if (cancelled) return;  // do not go to sleep if cancelled
        if (queue.length === 0) {
          await new Promise<void>(resolve => resolveQueue = resolve);
        }
        if (cancelled) return;  // do not yield after sleeping if cancelled
        // If there are values ready to emit, emit them one by one now.
        while (queue.length > 0) {
          // Collect the next value from the queue
          const args: Emitted = queue.shift()!;

          let output: Transformed;
          if (options.transform) {
            // If the caller has specified a transform function, transform the
            // value before yielding it.
            output = options.transform(...args);
          } else {
            // Otherwise, yield the value as it is. If the value is a tuple
            // (i.e. was emitted by an event emitting multiple values), yield
            // the full tuple. For single value events, strip the containing
            // array and just yield that value.
            output = (args.length === 1 ? args[0] : args) as unknown as Transformed;
          }
          yield output;
        }
      }
    } finally {
      // Cleanup:
      // - Resolve the final waiting promise, if any
      if (resolveQueue) resolveQueue();
      // Unsubscribe from all events
      for (const unsubscribe of unsubscribeFns) {
        unsubscribe();
      }
    }
  }

  // Instantiate the Generator
  const asyncGen = gen() as CancellableGenerator<Transformed>;

  // Enhance the generator to conform to the CancellableGenerator interface.
  asyncGen.cancel = () => {
    cancelled = true;
    if (resolveQueue) resolveQueue();
  }
  return asyncGen;
}
