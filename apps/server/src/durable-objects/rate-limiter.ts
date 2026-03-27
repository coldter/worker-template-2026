import { DurableObject } from "cloudflare:workers";

const WINDOW_MS = 60_000;

export class RateLimiter extends DurableObject {
  private timestamps: number[] = [];

  async checkLimit(
    limit: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return { allowed: false, remaining: 0 };
    }

    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    this.timestamps = this.timestamps.filter((t) => t > windowStart);

    if (this.timestamps.length >= limit) {
      return { allowed: false, remaining: 0 };
    }

    this.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - this.timestamps.length,
    };
  }
}
