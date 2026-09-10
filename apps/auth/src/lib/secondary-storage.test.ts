import { describe, expect, test } from "vitest";
import { createSecondaryStorage } from "./secondary-storage";

interface PutRecord {
  expirationTtl?: number;
  key: string;
  value: string;
}

function createFakeKv() {
  const store = new Map<string, string>();
  const puts: PutRecord[] = [];
  let putError: Error | null = null;

  const cache = {
    delete: async (key: string) => {
      store.delete(key);
    },
    get: async (key: string) => store.get(key) ?? null,
    put: async (
      key: string,
      value: string,
      options?: { expirationTtl?: number }
    ) => {
      if (putError) {
        throw putError;
      }
      store.set(key, value);
      puts.push({ expirationTtl: options?.expirationTtl, key, value });
    },
  } as unknown as KVNamespace;

  return {
    cache,
    puts,
    setPutError: (error: Error | null) => {
      putError = error;
    },
    store,
  };
}

describe("createSecondaryStorage", () => {
  test("increment creates the counter with a ttl", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await expect(storage.increment("rate-limit:key", 60)).resolves.toBe(1);

    expect(puts).toEqual([
      { expirationTtl: 60, key: "rate-limit:key", value: "1" },
    ]);
  });

  test("increment refreshes the ttl on later increments", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await storage.increment("rate-limit:key", 60);
    await expect(storage.increment("rate-limit:key", 120)).resolves.toBe(2);

    expect(puts).toHaveLength(2);
    expect(puts[0]?.expirationTtl).toBe(60);
    expect(puts[1]?.expirationTtl).toBe(120);
    expect(puts[1]?.value).toBe("2");
  });

  test("increment clamps the ttl to the kv minimum", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await storage.increment("rate-limit:key", 10);

    expect(puts[0]?.expirationTtl).toBe(60);
  });

  test("increment keeps counting when the kv write is rate limited", async () => {
    const { cache, puts, setPutError, store } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    setPutError(new Error("KV PUT failed: 429 Too Many Requests"));

    await expect(storage.increment("rate-limit:key", 60)).resolves.toBe(1);
    expect(store.has("rate-limit:key")).toBe(false);
    expect(puts).toHaveLength(0);
  });

  test("getAndDelete returns and removes the stored value", async () => {
    const { cache, store } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    store.set("otp:key", JSON.stringify("123456"));

    await expect(storage.getAndDelete("otp:key")).resolves.toBe("123456");
    await expect(storage.getAndDelete("otp:key")).resolves.toBeNull();
  });

  test("set stores a value with the requested ttl", async () => {
    const { cache, puts } = createFakeKv();
    const storage = createSecondaryStorage(cache);

    await storage.set("session:key", { token: "abc" }, 3600);

    expect(puts).toEqual([
      {
        expirationTtl: 3600,
        key: "session:key",
        value: JSON.stringify({ token: "abc" }),
      },
    ]);
  });
});
