/**
 * CF API budget semaphore — defense in depth.
 *
 * Cloudflare's per-token rate limit is the real budget; this counter is a
 * coarse safety net so a runaway reconciler / hot-loop in our worker does
 * not burn the per-token quota and lock out user-driven requests.
 *
 * Backed by Workers KV: a single counter key with a sliding 5-minute window
 * is incremented on every CF API call. The counter is best-effort — KV
 * reads / writes are not strongly consistent across regions, so the value
 * we observe is a lower bound on actual concurrency. That is acceptable
 * here because the production rate limit is enforced upstream by CF.
 *
 * Implementation notes:
 *   - We use bucket keys of the form `cf:budget:<floor(now/300s)>` so old
 *     buckets expire automatically (KV TTL set on write).
 *   - `tryAcquire` reads the current bucket, refuses if the count is
 *     already over the threshold, otherwise increments. The increment is
 *     not atomic across concurrent isolates; the racy worst case is one or
 *     two extra calls past the threshold per isolate, which is negligible
 *     against the 1000-call window.
 */

import type { CfBudgetGuard } from "./lifecycle";

export type CfBudgetKv = Readonly<{
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
}>;

export type CfBudgetOptions = Readonly<{
  /**
   * Maximum CF API calls within the rolling window before `tryAcquire`
   * returns false. Default 1000 — matches the conservative interpretation
   * of CF's per-token guidance.
   */
  threshold?: number;
  /**
   * Window length in seconds. Default 300 (5 minutes).
   */
  windowSeconds?: number;
  /**
   * Test seam — defaults to `Date.now`.
   */
  now?: () => number;
}>;

const DEFAULT_THRESHOLD = 1000;
const DEFAULT_WINDOW_SECONDS = 300;

export function createCfBudgetGuard(
  kv: CfBudgetKv,
  options: CfBudgetOptions = {}
): CfBudgetGuard {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const now = options.now ?? Date.now;
  return {
    async tryAcquire(): Promise<boolean> {
      const bucket = Math.floor(now() / 1000 / windowSeconds);
      const key = `cf:budget:${bucket}`;
      const current = await kv.get(key);
      const parsed = current === null ? 0 : Number.parseInt(current, 10);
      const count = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      if (count >= threshold) {
        return false;
      }
      // Set TTL to 2x the window so we never starve the next bucket.
      await kv.put(key, String(count + 1), {
        expirationTtl: windowSeconds * 2,
      });
      return true;
    },
  };
}
