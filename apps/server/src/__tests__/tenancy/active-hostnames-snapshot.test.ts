import { describe, expect, it } from "vitest";
import {
  _resetSnapshotCacheForTests,
  ACTIVE_CUSTOM_HOSTNAMES_KEY,
  getActiveCustomHostnamesSnapshot,
  writeActiveCustomHostnamesSnapshot,
} from "@/modules/tenancy/active-hostnames-snapshot";

describe("A5 active-hostnames-snapshot", () => {
  it("returns an empty set when KV has no value", async () => {
    const env = { CACHE: { get: async () => null } };
    _resetSnapshotCacheForTests(env);
    const snapshot = await getActiveCustomHostnamesSnapshot(env);
    expect(snapshot.size).toBe(0);
  });

  it("parses a JSON array from KV into a Set", async () => {
    const env = {
      CACHE: {
        get: async (k: string) =>
          k === ACTIVE_CUSTOM_HOSTNAMES_KEY
            ? JSON.stringify(["app.acme.test", "store.example.io"])
            : null,
      },
    };
    _resetSnapshotCacheForTests(env);
    const snapshot = await getActiveCustomHostnamesSnapshot(env);
    expect(snapshot.has("app.acme.test")).toBe(true);
    expect(snapshot.has("store.example.io")).toBe(true);
  });

  it("memoizes within the TTL window so repeated reads do not hit KV", async () => {
    let calls = 0;
    const env = {
      CACHE: {
        get: async () => {
          calls += 1;
          return JSON.stringify(["a.test"]);
        },
      },
    };
    _resetSnapshotCacheForTests(env);
    const t0 = 1_000_000;
    await getActiveCustomHostnamesSnapshot(env, () => t0);
    await getActiveCustomHostnamesSnapshot(env, () => t0 + 1000);
    expect(calls).toBe(1);
  });

  it("falls back to an empty set when KV returns malformed JSON", async () => {
    const env = { CACHE: { get: async () => "not-json" } };
    _resetSnapshotCacheForTests(env);
    const snapshot = await getActiveCustomHostnamesSnapshot(env);
    expect(snapshot.size).toBe(0);
  });

  it("write helper stores a JSON-encoded array under the canonical key", async () => {
    const writes: Array<{ key: string; value: string }> = [];
    const cache = {
      put: async (key: string, value: string) => {
        writes.push({ key, value });
      },
    };
    await writeActiveCustomHostnamesSnapshot(cache, ["a.test", "b.test"]);
    expect(writes).toEqual([
      {
        key: ACTIVE_CUSTOM_HOSTNAMES_KEY,
        value: JSON.stringify(["a.test", "b.test"]),
      },
    ]);
  });
});
