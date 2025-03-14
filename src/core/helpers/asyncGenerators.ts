import EventEmitter from "events";

/**
 * Helper function to merge multiple async generators into one.
 * It accepts any number of async generators and yields all of their values
 * in the order they are received.
 */

export async function* mergeAsyncGenerators<T>(
  ...generators: AsyncGenerator<T>[]
): AsyncGenerator<T> {
  // Array to hold the promises for the next values of each generator
  const promises: Promise<IteratorResult<T>>[] = generators.map(gen => gen.next());

  while (promises.length > 0) {
    // Wait for any promise to resolve
    const { value, index }: { value: IteratorResult<T>; index: number; } = await Promise.race(
      promises.map((p, i) => p.then((result) => ({ value: result, index: i }))
      )
    );

    // If the resolved promise is not done, yield its value
    if (!value.done) {
      yield value.value;
      // Replace the resolved promise with the next from the corresponding generator
      promises[index] = generators[index].next();
    } else {
      // If done, remove the corresponding generator and promise
      promises.splice(index, 1);
      generators.splice(index, 1);
    }
  }
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



/**
 * An async generator that listens to multiple event emitters and yields events as they occur.
 * It's basically an adapter from events to await for ... of.
 *
 * @param emitters - An array of objects containing an EventEmitter and the event name to listen for.
 * @param transform - An optional function that transforms each emitted event before yielding.
 * @returns An async generator yielding transformed or original event data.
 */
export async function* eventsToGenerator<Emitted, Transformed = Emitted>(
  emitters: { emitter: EventEmitter; event: string }[],
  transform?: (data: Emitted) => Transformed
): AsyncGenerator<Transformed> {
  // Sanity check: If no emitters are provided, exit immediately.
  if (emitters.length === 0) {
    return;
  }

  const queue: Emitted[] = [];
  let resolveQueue: (() => void) | null = null;

  // Event handler factory that pushes data into the queue
  const createHandler = (event: string) => (data: Emitted): void => {
    queue.push(data);
    if (resolveQueue) {
      resolveQueue();
      resolveQueue = null;
    }
  };

  const unsubscribeFns: (() => void)[] = emitters.map(({ emitter, event }): (() => void) => {
    const listener = createHandler(event);
    emitter.on(event, listener);
    return () => emitter.removeListener(event, listener);
  });

  // All preparations done!
  try {
    // Run the main loop:
    while (true) {
      // If there is currently nothing ready to yield, wait for the next
      // Promise to resolve.
      if (queue.length === 0) {
        await new Promise<void>((resolve) => (resolveQueue = resolve));
      }
      // But if there is something ready, yield it now.
      while (queue.length > 0) {
        // Fetch something from the queue of data ready to yield
        let data: Emitted|Transformed = queue.shift()!;
        // If requested by the caller, run a transformation on the data
        if (transform) data = transform(data);
        yield data as any;  // typecast: data will either be Emitted or Transformed
      }
    }
  } finally {
    // We're finished! Just do some cleanup work:
    // - Resolve the last pending Promise, if any -- TODO: why?
    if (resolveQueue) {
      resolveQueue();
    }
    // - Unsubscribe all event listeners
    for (const unsubscribe of unsubscribeFns) {
      unsubscribe();
    }
  }
}
