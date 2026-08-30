import { DurableObject } from "cloudflare:workers";
import { logger } from "@repo/shared/logger";

const WINDOW_MS = 60_000;
const STORAGE_KEY = "ts";
const MAX_TIMESTAMPS = 10_000;

export class RateLimiter extends DurableObject {
  private timestamps: number[] = [];
  private hydrated = false;
  private clampWarned = false;

  async checkLimit(
    limit: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return { allowed: false, remaining: 0 };
    }

    const effectiveLimit = Math.min(Math.floor(limit), MAX_TIMESTAMPS);
    if (limit > MAX_TIMESTAMPS && !this.clampWarned) {
      this.clampWarned = true;
      logger.warn("RateLimiter limit clamped to MAX_TIMESTAMPS", {
        effective: effectiveLimit,
        requested: limit,
      });
    }

    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    await this.hydrate();

    const pruned = this.timestamps.filter((t) => t > windowStart);

    if (pruned.length >= effectiveLimit) {
      const persisted = await this.persist(pruned);
      if (!persisted) {
        return { allowed: false, remaining: 0 };
      }
      this.timestamps = pruned;
      await this.scheduleAlarm();
      return { allowed: false, remaining: 0 };
    }

    const next = [...pruned, now];
    if (next.length > MAX_TIMESTAMPS) {
      next.splice(0, next.length - MAX_TIMESTAMPS);
    }

    const persisted = await this.persist(next);
    if (!persisted) {
      // fail closed: a storage outage must not allow unlimited requests.
      return { allowed: false, remaining: 0 };
    }
    this.timestamps = next;
    await this.scheduleAlarm();

    return {
      allowed: true,
      remaining: Math.max(0, effectiveLimit - this.timestamps.length),
    };
  }

  async alarm(): Promise<void> {
    try {
      await this.hydrate();
      const windowStart = Date.now() - WINDOW_MS;
      const pruned = this.timestamps.filter((t) => t > windowStart);

      if (pruned.length === 0) {
        await this.ctx.storage.deleteAll();
        this.timestamps = [];
        return;
      }

      if (pruned.length !== this.timestamps.length) {
        await this.ctx.storage.put(STORAGE_KEY, pruned);
        this.timestamps = pruned;
      }

      await this.ctx.storage.setAlarm(Date.now() + WINDOW_MS * 2);
    } catch (err) {
      logger.error("RateLimiter alarm failed", {
        error: err,
      });
    }
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) {
      return;
    }
    try {
      const stored = await this.ctx.storage.get<number[]>(STORAGE_KEY);
      if (Array.isArray(stored)) {
        this.timestamps = stored.filter(
          (t): t is number => typeof t === "number" && Number.isFinite(t)
        );
      }
      this.hydrated = true;
    } catch (err) {
      // checkLimit will fail closed on the next write if storage is genuinely down.
      logger.error("RateLimiter storage read failed", {
        error: err,
      });
      this.hydrated = true;
    }
  }

  // callers must not mutate in-memory state when this returns false (persist-first ordering).
  private async persist(next: number[]): Promise<boolean> {
    try {
      await this.ctx.storage.put(STORAGE_KEY, next);
      return true;
    } catch (err) {
      logger.error("RateLimiter storage write failed; failing closed", {
        error: err,
      });
      return false;
    }
  }

  private async scheduleAlarm(): Promise<void> {
    try {
      await this.ctx.storage.setAlarm(Date.now() + WINDOW_MS * 2);
    } catch (err) {
      logger.warn("RateLimiter setAlarm failed", {
        error: err,
      });
    }
  }
}
