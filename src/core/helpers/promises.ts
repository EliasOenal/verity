/**
 * A cancellable promise, which can be resolved or rejected by its user
 * while the underlying promise is still pending.
 **/
export class DeferredPromise<T = void> {
  public promise: Promise<T>;
  public resolve!: (value: T) => void;
  public reject!: (reason?: any) => void;

  constructor();
  constructor(promise: Promise<T>);
  constructor(inputPromise?: Promise<T>) {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
      if (inputPromise) inputPromise.then(res).catch(rej);
    });
  }
}

/**
 * A semantic wrapper for a DeferredPromise representing a cancellable task;
 * the task can be cancelled by calling its cancel() method, which is equivalent
 * to calling resolve(undefined).
 */
export class CancellableTask<T> extends DeferredPromise<T> {
  public cancel(): void {
    this.resolve(undefined);
}}

/**
 * Type guard that recognizes a CancellableTask by a `.promise` with a `.then`.
 *
 * A "CancellableTask" is expected to look like:
 *   { promise: Promise<T>, cancel?: () => void }
 */
export function isCancellableTask<T>(x: any): x is CancellableTask<T> {
  return !!x && typeof x === 'object' && 'promise' in x && typeof x.promise?.then === 'function';
}
