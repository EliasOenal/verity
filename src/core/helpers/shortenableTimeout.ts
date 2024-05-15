export class ShortenableTimeout {
  private timeoutId: ReturnType<typeof setTimeout> = undefined;
  private startTime: number = undefined;
  private delay: number = undefined;

  constructor(
      private callback: () => void
  ){
    this.callback = () => {
      this.timeoutId = undefined;
      this.startTime = undefined;
      this.delay = undefined;
      callback();
    };
  }

  getRemainingTime(): number {
    if (!this.startTime) return undefined;
    const elapsedTime = Date.now() - this.startTime;
    return this.delay - elapsedTime;
  }

  setTimeout(delay: number): void {
    const remainingTime = this.getRemainingTime();

    // only reset timeout if requested time is shorter than remaining time,
    // if the previous timeout has already fired,
    // or if it has in fact never been set before
    if (remainingTime === undefined || delay < remainingTime) {
      this.delay = delay;
      if (this.timeoutId) clearTimeout(this.timeoutId);
      this.timeoutId = setTimeout(this.callback, delay);
      this.startTime = Date.now();
    }
  }
}
