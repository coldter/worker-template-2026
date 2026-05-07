import { DurableObject } from "cloudflare:workers";

const DEFAULT_WINDOW_MS = 60_000;
// Run the prune alarm every 5 minutes. Five is the smallest interval that
// still amortises a delete sweep across a moderately busy IP without paying
// per-request prune cost beyond the inline `WHERE ts < ?` delete below.
const ALARM_INTERVAL_MS = 5 * 60_000;

type CountRow = { c: number };

/**
 * Sliding-window rate limiter backed by the DO's SQLite storage. Each call to
 * `checkLimit` inserts a hit timestamp, prunes hits older than the configured
 * window, and counts the remaining rows to decide if the caller is allowed.
 * State is durable across DO eviction so a process restart does not reset the
 * window.
 *
 * An alarm runs every ~5 minutes to delete stale rows. The inline prune in
 * `checkLimit` keeps active windows tight; the alarm stops rescheduling when
 * no hits remain.
 */
export class RateLimiter extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS rate_limit_hits (ts INTEGER NOT NULL)"
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_ts ON rate_limit_hits (ts)"
      );
      const existing = await this.ctx.storage.getAlarm();
      if (existing === null) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    });
  }

  /**
   * Slide a `limit`-token window of size `windowMs` (defaults to 60s for
   * backwards compatibility with the global per-IP limiter). Each call
   * inserts a row on success; rows older than the window are pruned inline.
   */
  async checkLimit(
    limit: number,
    windowMs: number = DEFAULT_WINDOW_MS
  ): Promise<{ allowed: boolean; remaining: number }> {
    if (!Number.isFinite(limit) || limit <= 0) {
      return { allowed: false, remaining: 0 };
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      return { allowed: false, remaining: 0 };
    }

    const now = Date.now();
    const windowStart = now - windowMs;

    this.ctx.storage.sql.exec(
      "DELETE FROM rate_limit_hits WHERE ts < ?",
      windowStart
    );

    const countCursor = this.ctx.storage.sql.exec<CountRow>(
      "SELECT COUNT(*) AS c FROM rate_limit_hits"
    );
    const countRow = countCursor.one();
    const currentCount = countRow.c;

    if (currentCount >= limit) {
      return { allowed: false, remaining: 0 };
    }

    this.ctx.storage.sql.exec(
      "INSERT INTO rate_limit_hits (ts) VALUES (?)",
      now
    );
    const existingAlarm = await this.ctx.storage.getAlarm();
    if (existingAlarm === null) {
      await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
    }

    return {
      allowed: true,
      remaining: limit - (currentCount + 1),
    };
  }

  /**
   * Periodic maintenance. Prunes hits older than the longest plausible window
   * and stops rescheduling when no hits remain. Do not call `deleteAll()` here:
   * it removes the SQLite schema on a warm object, while the constructor may
   * not run again before the next `checkLimit`.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    // Use a generous window (10x default) for the alarm sweep so unusual
    // callers with longer windows don't have their rows pruned out from
    // under them by the alarm.
    const sweepCutoff = now - DEFAULT_WINDOW_MS * 10;
    this.ctx.storage.sql.exec(
      "DELETE FROM rate_limit_hits WHERE ts < ?",
      sweepCutoff
    );

    const countCursor = this.ctx.storage.sql.exec<CountRow>(
      "SELECT COUNT(*) AS c FROM rate_limit_hits"
    );
    const remaining = countCursor.one().c;

    if (remaining === 0) {
      return;
    }

    await this.ctx.storage.setAlarm(now + ALARM_INTERVAL_MS);
  }
}
