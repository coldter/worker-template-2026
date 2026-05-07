/**
 * cf-budget defense-in-depth semaphore. The KV is stubbed in-memory; we
 * fix `now` so the bucket key is deterministic across calls.
 */
import { describe, expect, it } from "vitest";
import {
  type CfBudgetKv,
  createCfBudgetGuard,
} from "@/modules/tenancy/cf-budget";

function makeKv(): CfBudgetKv & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("cf-budget guard", () => {
  it("acquires up to the threshold and refuses past it", async () => {
    const kv = makeKv();
    const now = () => 1_700_000_000_000;
    const guard = createCfBudgetGuard(kv, {
      threshold: 3,
      windowSeconds: 300,
      now,
    });
    expect(await guard.tryAcquire()).toBe(true);
    expect(await guard.tryAcquire()).toBe(true);
    expect(await guard.tryAcquire()).toBe(true);
    expect(await guard.tryAcquire()).toBe(false);
  });

  it("rolls over to a new bucket when the window advances", async () => {
    const kv = makeKv();
    let t = 1_700_000_000_000;
    const guard = createCfBudgetGuard(kv, {
      threshold: 1,
      windowSeconds: 300,
      now: () => t,
    });
    expect(await guard.tryAcquire()).toBe(true);
    expect(await guard.tryAcquire()).toBe(false);
    t += 301 * 1000;
    // New bucket — counter resets implicitly because the bucket key changes.
    expect(await guard.tryAcquire()).toBe(true);
  });

  it("treats malformed counter values as zero", async () => {
    const kv = makeKv();
    const now = () => 1_700_000_000_000;
    const bucket = Math.floor(now() / 1000 / 300);
    kv.store.set(`cf:budget:${bucket}`, "not-a-number");
    const guard = createCfBudgetGuard(kv, {
      threshold: 5,
      windowSeconds: 300,
      now,
    });
    expect(await guard.tryAcquire()).toBe(true);
  });
});
