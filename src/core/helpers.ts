export function fibonacci(n: number) {
  let fib = 1, previous = 0, tmp = 0;
  for (let i=0; i<n; i++) {
    tmp = fib;
    fib += previous;
    previous = tmp;
  }
  return fib;
}
