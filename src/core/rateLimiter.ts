export interface RateLimitCheck {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Sliding-window rate limiter trong bo nho, dung theo tung key (vi du "telegram:12345"). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly sweepIntervalHandle: ReturnType<typeof setInterval>;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {
    this.sweepIntervalHandle = setInterval(() => this.sweep(), this.windowMs).unref();
  }

  checkAndRecord(key: string): RateLimitCheck {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.hits.set(key, timestamps);
      const retryAfterMs = timestamps[0] + this.windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private sweep(): void {
    const windowStart = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const fresh = timestamps.filter((t) => t > windowStart);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
  }

  stop(): void {
    clearInterval(this.sweepIntervalHandle);
  }
}
