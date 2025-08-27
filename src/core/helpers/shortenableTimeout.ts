export class ShortenableTimeout {
  // These values are only defined while an active timeout is scheduled.
  private timeoutId?: ReturnType<typeof setTimeout>;
  private startTime?: number;
  private delay?: number;

  constructor(
      private callback: () => void,
      private context?: object,
  ){}

  /**
   * Remaining time (ms) before the currently scheduled timeout fires.
   * Returns undefined if no timeout is active.
   */
  getRemainingTime(): number | undefined {
    if (this.startTime === undefined || this.delay === undefined) return undefined;
    const elapsedTime = Date.now() - this.startTime;
    return this.delay - elapsedTime;
  }

  set(delay: number): boolean {
    const remainingTime = this.getRemainingTime();

    // only reset timeout if requested time is shorter than remaining time,
    // if the previous timeout has already fired,
    // or if it has in fact never been set before
    if (remainingTime === undefined || delay < remainingTime) {
      this.setUpTimeout(delay);
      return true;
    } else return false;
  }

  clear(): void {
    if (this.timeoutId !== undefined) clearTimeout(this.timeoutId);
    this.timeoutId = undefined;
    this.startTime = undefined;
    this.delay = undefined;
  }

  private setUpTimeout(delay: number): void {
    this.clear();
    this.delay = delay;
    this.startTime = Date.now();
    this.timeoutId = setTimeout(() => this.invokeTimeout(), delay);
  }

  private invokeTimeout(): void {
    this.clear();
    // Use provided context if any; otherwise undefined (normal for functions not using `this`).
    this.callback.call(this.context as any);
  }
}
