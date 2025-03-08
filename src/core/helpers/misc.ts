import { Buffer } from 'buffer';
import EventEmitter from 'events';

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

/**
 * Heuristically checks if this string is printable
 */
export function isPrintable(str: string): boolean {
  if (str.length < 1) return false; // avoid division by zero later on
  let printable = 0, nonPrintable = 0;
  for (let i=0; i<str.length; i++) {
    const codepoint = str.charCodeAt(i);
    if (codepoint < 0x20 || codepoint > 0x7E) {  // non-ASCII?
      // This is very western-centric.
      // Dekar may need to censor it to avoid getting cancelled in California.
      nonPrintable++;
    } else {
      printable++;
    }
  }
  if (printable / str.length > 0.9) return true;  // 90% ASCII sounds about printable
  else return false;
}

export function enumStrings(e: any): string[] {
  return Object.keys(e).filter((entry) => isNaN(Number(entry)));
}
export function enumNums(e: any): number[] {
  return Object.values(e).filter((entry) => Number.isFinite(entry)) as number[];
}

// TODO: remove this once Array.fromAsync is widely supported on every platform
export async function ArrayFromAsync<T>(it: AsyncIterable<T>): Promise<Array<T>> {
  const ret: T[] = [];
  for await (const item of it) ret.push(item);
  return ret;
}

export function isIterableButNotBuffer(obj: any): boolean {
  return obj != null &&
    typeof obj[Symbol.iterator] === 'function' &&
    !Buffer.isBuffer(obj);
}


// Enforce that event mappings have function values
type EventMap = Record<string, (...args: any[]) => void>;

export class TypedEmitter<T extends EventMap> extends EventEmitter {
  emit<K extends keyof T & (string | symbol)>(event: K, ...args: Parameters<T[K]>): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof T & (string | symbol)>(event: K, listener: T[K]): this {
    return super.on(event, listener);
  }

  once<K extends keyof T & (string | symbol)>(event: K, listener: T[K]): this {
    return super.once(event, listener);
  }

  removeListener<K extends keyof T & (string | symbol)>(event: K, listener: T[K]): this {
    return super.removeListener(event, listener);
  }
}