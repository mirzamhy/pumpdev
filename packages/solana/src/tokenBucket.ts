export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = clock();
  }

  private refill(): void {
    const t = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
    this.last = t;
  }

  /** Milliseconds until one token is available (0 = now). Does not consume. */
  waitMs(): number {
    this.refill();
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000);
  }

  take(): void {
    this.refill();
    this.tokens -= 1;
  }
}
