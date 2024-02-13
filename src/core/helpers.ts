export function fibonacci(n: number) {
  let fib = 1, previous = 0, tmp = 0;
  for (let i=0; i<n; i++) {
    tmp = fib;
    fib += previous;
    previous = tmp;
  }
  return fib;
}

/**
 * @returns A standard full-second resolution UNIX time.
 * Returns the current time if no args given.
 * Converts any time given in unix milliseconds to full seconds.
 */
export function unixtime(millis: number = undefined): number {
  if (millis === undefined) millis = Date.now();
  return Math.floor(millis / 1000);
}
