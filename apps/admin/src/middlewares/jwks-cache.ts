import type { createRemoteJWKSet } from "jose";

export type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

/**
 * Audit-fix #6 — cooldown between consecutive JWKS rebuilds. Three forged
 * tokens delivered in rapid succession to the same isolate must NOT trigger
 * three back-to-back JWKS refetches; the strikes accumulate, but the rebuild
 * itself is gated by this window so an attacker cannot weaponize the cache
 * into an outbound DoS against the team's `/cdn-cgi/access/certs` endpoint.
 */
const REBUILD_BACKOFF_MS = 30_000;

/**
 * Cache for the team's CF Access JWKS (D69). On three consecutive verification
 * failures the next `get()` rebuilds the JWKSet — handles silent key rotation
 * without enabling DoS via a flood of forged tokens. A successful verification
 * resets the strike counter so the rebuild only fires when failures genuinely
 * accumulate.
 *
 * Audit-fix #6 — concurrent `get()` calls during a cold-start or rebuild
 * de-duplicate onto a single in-flight factory promise, and consecutive
 * rebuilds are throttled by `REBUILD_BACKOFF_MS` so a flood of failed
 * verifications cannot pin the worker to a JWKS refetch loop.
 *
 * The class is generic over the cached value so unit tests can stub the
 * factory without touching `jose`.
 */
export class JwksCache<T = RemoteJwks> {
  private cached: T | null = null;
  private strikes = 0;
  private lastRebuildAt = 0;
  private inFlight: Promise<T> | null = null;
  private readonly factory: () => Promise<T>;
  private readonly now: () => number;

  constructor(factory: () => Promise<T>, options: { now?: () => number } = {}) {
    this.factory = factory;
    this.now = options.now ?? (() => Date.now());
  }

  async get(): Promise<T> {
    if (this.cached) {
      return this.cached;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    const pending = (async () => {
      try {
        const value = await this.factory();
        this.cached = value;
        this.lastRebuildAt = this.now();
        return value;
      } finally {
        this.inFlight = null;
      }
    })();
    this.inFlight = pending;
    return pending;
  }

  /**
   * Force-refresh the JWKS. Public callers should prefer `recordFailure()`
   * which gates the rebuild via the strike + backoff policy. Internal use
   * only — kept exported for tests that want to clear state explicitly.
   */
  reset(): void {
    this.cached = null;
    this.strikes = 0;
    this.inFlight = null;
  }

  recordFailure(): void {
    this.strikes += 1;
    if (this.strikes < 3) {
      return;
    }
    // Strike threshold met. Only actually trigger the rebuild if at least
    // `REBUILD_BACKOFF_MS` has passed since the last rebuild — otherwise the
    // strike accumulator stays satisfied but the cache is preserved so a
    // burst of forged tokens cannot cause repeated outbound JWKS fetches.
    if (this.now() - this.lastRebuildAt < REBUILD_BACKOFF_MS) {
      return;
    }
    this.cached = null;
    this.strikes = 0;
    this.inFlight = null;
  }

  recordSuccess(): void {
    this.strikes = 0;
  }
}
