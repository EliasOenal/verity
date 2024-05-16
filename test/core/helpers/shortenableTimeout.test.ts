import { ShortenableTimeout } from "../../../src/core/helpers/shortenableTimeout";

import { jest } from '@jest/globals'

describe("ShortenableTimeout", () => {
  let shortenableTimeout: ShortenableTimeout;

  beforeEach(() => {
    shortenableTimeout = new ShortenableTimeout(jest.fn());
  });

  it("should execute callback after specified delay", (done) => {
    const delay = 100; // 100 milliseconds
    const callback = jest.fn();

    shortenableTimeout = new ShortenableTimeout(callback);
    shortenableTimeout.set(delay);
    expect(callback).not.toHaveBeenCalled();

    // Wait for delay + 10 milliseconds to ensure the callback has been called
    setTimeout(() => {
      expect(callback).toHaveBeenCalled();
      done();
    }, delay + 10);
  });

  it("should replace timeout if requested delay is shorter than remaining time", (done) => {
    const delay1 = 100;
    const delay2 = 50;

    const callback = jest.fn();

    shortenableTimeout = new ShortenableTimeout(callback);
    shortenableTimeout.set(delay1);

    // Replace the timeout with a shorter delay
    shortenableTimeout.set(delay2);

    // Wait for delay2 + 10 milliseconds to ensure the callback has been called
    setTimeout(() => {
      expect(callback).toHaveBeenCalledTimes(1);
      done();
    }, delay2 + 10);
  });

  it("should ignore setTimeout request if new delay is longer than previous one", (done) => {
    const delay1 = 100;
    const delay2 = 200;

    const callback = jest.fn();

    shortenableTimeout = new ShortenableTimeout(callback);
    shortenableTimeout.set(delay1);

    // Ignore the request because the new delay is longer than the remaining time
    shortenableTimeout.set(delay2);

    // Wait for delay1 + 10 milliseconds to ensure the callback has been called only once
    setTimeout(() => {
      expect(callback).toHaveBeenCalledTimes(1);
      done();
    }, delay1 + 10);
  });

  it("should ignore setTimeout request if new delay is longer than time remaining on the previous one", (done) => {
    const delay1 = 300;
    const delay2 = 200;

    const callback = jest.fn();

    shortenableTimeout = new ShortenableTimeout(callback);
    shortenableTimeout.set(delay1);

    // After half of delay1, with only 150ms remaining, try to "shorten" the
    // timeout to 200ms.
    setTimeout(() => {
      // this should be ignored, as at most 150ms are remaining on the first one
      shortenableTimeout.set(delay2);
    }, 150);

    // After delay1 + 10 milliseconds, ensure the callback has been called
    setTimeout(() => {
      expect(callback).toHaveBeenCalledTimes(1);
    }, delay1 + 10);

    // After delay1 + delay2 + 10 milliseconds, ensure the callback has
    // still only be called once
    setTimeout(() => {
      expect(callback).toHaveBeenCalledTimes(1);
      done();
    }, delay1 + delay2 + 10);
  });

  it('should set a new timeout if the previous one has already fired', (done) => {
    const delay = 50;
    const callback = jest.fn();

    shortenableTimeout = new ShortenableTimeout(callback);
    shortenableTimeout.set(delay);

    // After double the delay the callback should have long fired.
    // If we re-set it now, it should set up as a new timeout.
    setTimeout(() => {
      shortenableTimeout.set(delay);
    }, 2*delay);

    // After two delays (make that four to be on the safe side), callback
    // should therefore have been invoked twice.
    setTimeout(() => {
      expect(callback).toHaveBeenCalledTimes(2);
      done();
    }, 4*delay);
  });

});
