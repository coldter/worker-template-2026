import type { createRemoteJWKSet } from "jose";

export type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

/**
 * Cooldown between JWKS rebuilds. Forged tokens delivered in rapid succession
 * accumulate strikes, but the rebuild is gated by this window so an attacker
 * cannot weaponize the cache into an outbound DoS against the team's
 * `/cdn-cgi/access/certs` endpoint.
 */
const REBUILD_BACKOFF_MS = 30_000;

/**
 * Cache for the team's CF Access JWKS. Three consecutive verification failures
 * trigger a rebuild on the next `get()` to handle silent key rotation; a
 * successful verification resets the strike counter so the rebuild only fires
 * when failures genuinely accumulate. Concurrent `get()` calls de-duplicate
 * onto a single in-flight factory promise.
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
   * Force-refresh the JWKS. Prefer `recordFailure()` which gates the rebuild
   * via the strike + backoff policy; this is exported only for tests.
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
    // Gate the rebuild by `REBUILD_BACKOFF_MS` so a burst of forged tokens
    // cannot cause repeated outbound JWKS fetches.
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
