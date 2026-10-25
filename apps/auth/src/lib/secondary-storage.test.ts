/* oxlint-disable vitest/prefer-to-be-truthy, vitest/prefer-to-be-falsy -- strict boolean assertions are intentional */
import { describe, expect, it } from "vitest";

import { createSecondaryStorage } from "./secondary-storage";

interface PutRecord {
  expirationTtl?: number;
  key: string;
  value: string;
}

const createFakeKv = () => {
  const store = new Map<string, string>();
  const puts: PutRecord[] = [];
  let putError: Error | null = null;

  // SAFETY: createSecondaryStorage only calls get/put/delete and this stub implements all three with KV-compatible signatures.
  const cache = {
    delete: (key: string) => {
      store.delete(key);

      return Promise.resolve();
    },
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string, options?: { expirationTtl?: number }) => {
      if (putError) {
        throw putError;
      }

      store.set(key, value);
      puts.push({ expirationTtl: options?.expirationTtl, key, value });

      return Promise.resolve();
    },
  } as KVNamespace;

  return {
    cache,
    puts,
    setPutError: (error: Error | null) => {
      putError = error;
    },
    store,
  };
};

describe(createSecondaryStorage, () => {
  it("increment creates the counter with a ttl", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await expect(storage.increment("rate-limit:key", 60)).resolves.toBe(1);

    expect(puts).toStrictEqual([
      { expirationTtl: 60, key: "rate-limit:key", value: "1" },
    ]);
  });

  it("increment refreshes the ttl on later increments", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await storage.increment("rate-limit:key", 60);
    await expect(storage.increment("rate-limit:key", 120)).resolves.toBe(2);

    expect(puts).toHaveLength(2);
    expect(puts[0]?.expirationTtl).toBe(60);
    expect(puts[1]?.expirationTtl).toBe(120);
    expect(puts[1]?.value).toBe("2");
  });

  it("increment clamps the ttl to the kv minimum", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await storage.increment("rate-limit:key", 10);

    expect(puts[0]?.expirationTtl).toBe(60);
  });

  it("increment keeps counting when the kv write is rate limited", async () => {
    const { cache, puts, setPutError, store } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    setPutError(new Error("KV PUT failed: 429 Too Many Requests"));

    await expect(storage.increment("rate-limit:key", 60)).resolves.toBe(1);
    expect(store.has("rate-limit:key")).toBe(false);
    expect(puts).toHaveLength(0);
  });

  it("getAndDelete returns and removes the stored value", async () => {
    const { cache, store } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    store.set("otp:key", JSON.stringify("123456"));

    await expect(storage.getAndDelete("otp:key")).resolves.toBe("123456");
    await expect(storage.getAndDelete("otp:key")).resolves.toBeNull();
  });

  it("set stores a value with the requested ttl", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await storage.set("session:key", { token: "abc" }, 3600);

    expect(puts).toStrictEqual([
      {
        expirationTtl: 3600,
        key: "session:key",
        value: JSON.stringify({ token: "abc" }),
      },
    ]);
  });
});
