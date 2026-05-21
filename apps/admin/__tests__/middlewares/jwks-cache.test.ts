import { describe, expect, it, vi } from "vitest";
import { JwksCache } from "@/middlewares/jwks-cache";

function buildClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("JwksCache", () => {
  it("cache miss invokes factory once; cache hit reuses", async () => {
    const factory = vi.fn(async () => ({ tag: "jwks-1" }));
    const cache = new JwksCache(factory as never);
    const a = await cache.get();
    const b = await cache.get();
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("reset() clears the cached value so next get re-fetches", async () => {
    const factory = vi.fn(async () => ({ tag: Math.random() }));
    const cache = new JwksCache(factory as never);
    await cache.get();
    cache.reset();
    await cache.get();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("rebuilds after 3 strikes once the backoff window has elapsed", async () => {
    const clock = buildClock();
    const factory = vi.fn(async () => ({ tag: "jwks-1" }));
    const cache = new JwksCache(factory as never, { now: clock.now });
    await cache.get();
    expect(factory).toHaveBeenCalledTimes(1);
    // Move past the rebuild backoff window so the first rebuild is allowed.
    clock.advance(31_000);
    cache.recordFailure();
    cache.recordFailure();
    await cache.get();
    expect(factory).toHaveBeenCalledTimes(1);
    cache.recordFailure();
    await cache.get();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("3 strikes inside the backoff window do NOT trigger a rebuild", async () => {
    const clock = buildClock();
    const factory = vi.fn(async () => ({ tag: "jwks-1" }));
    const cache = new JwksCache(factory as never, { now: clock.now });
    await cache.get();
    expect(factory).toHaveBeenCalledTimes(1);
    // Three forged tokens arrive within 30s of the initial build — strikes
    // accumulate, but the cache must NOT refetch because that would let an
    // attacker pin the worker to repeated outbound JWKS calls.
    cache.recordFailure();
    cache.recordFailure();
    cache.recordFailure();
    await cache.get();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("recordSuccess clears the strike counter", async () => {
    const clock = buildClock();
    const factory = vi.fn(async () => ({ tag: "jwks-1" }));
    const cache = new JwksCache(factory as never, { now: clock.now });
    await cache.get();
    clock.advance(31_000);
    cache.recordFailure();
    cache.recordFailure();
    cache.recordSuccess();
    cache.recordFailure();
    cache.recordFailure();
    await cache.get();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("de-dupes concurrent get() calls onto a single factory promise", async () => {
    let resolveFn: ((v: { tag: string }) => void) | null = null;
    const factory = vi.fn(
      () =>
        new Promise<{ tag: string }>((resolve) => {
          resolveFn = resolve;
        })
    );
    const cache = new JwksCache(factory as never);
    const a = cache.get();
    const b = cache.get();
    const c = cache.get();
    if (!resolveFn) {
      throw new Error("factory was not invoked");
    }
    // boundary: vitest's overload-resolution sees `resolveFn` as `null` after
    // the guard above; cast through a parameter typed as the resolve fn.
    (resolveFn as (v: { tag: string }) => void)({ tag: "jwks-1" });
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
