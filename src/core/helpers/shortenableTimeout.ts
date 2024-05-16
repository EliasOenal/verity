export class ShortenableTimeout {
  private timeoutId: ReturnType<typeof setTimeout> = undefined;
  private startTime: number = undefined;
  private delay: number = undefined;

  constructor(
      private callback: () => void,
      private context: Object = undefined,
  ){
  }

  getRemainingTime(): number {
    if (!this.startTime) return undefined;
    const elapsedTime = Date.now() - this.startTime;
    return this.delay - elapsedTime;
  }

  set(delay: number): void {
    const remainingTime = this.getRemainingTime();

    // only reset timeout if requested time is shorter than remaining time,
    // if the previous timeout has already fired,
    // or if it has in fact never been set before
    if (remainingTime === undefined || delay < remainingTime) {
      this.setUpTimeout(delay);
    }
  }

  clear(): void {
    this.startTime = undefined;
    this.delay = undefined;
    if (this.timeoutId) clearTimeout(this.timeoutId);
  }

  private setUpTimeout(delay: number): void {
    this.clear();
    this.delay = delay;
    this.startTime = Date.now();
    this.timeoutId = setTimeout(() => this.invokeTimeout(), delay);
  }

  private invokeTimeout(): void {
    this.clear();
    this.callback.call(this.context);
  }
}
