import { describe, expect, it } from "vitest";
import { KV_VERSION_KEY } from "../cache-key";
import { createFanOutInvalidator } from "../fan-out-invalidator";
import { createInvalidator } from "../invalidator";

describe("A2.6 Invalidator", () => {
  it("deletes the cache entry under current version", async () => {
    const cache = new Map<string, Response>();
    cache.set(
      "https://tenancy/cache:tenant:v0:acme.app.example.com",
      new Response("x")
    );
    const env = {
      CACHE: { get: async () => "v0", put: async () => {} },
      tenancyCache: {
        match: async (r: Request) => cache.get(r.url),
        put: async (r: Request, v: Response) => {
          cache.set(r.url, v);
        },
        delete: async (r: Request) => cache.delete(r.url),
      },
    };
    const inv = createInvalidator(env);
    await inv.invalidateOwn({
      kind: "subdomain",
      host: "acme.app.example.com",
    });
    expect(cache.size).toBe(0);
  });

  it("bumpOwnVersion writes a new monotonic version to KV", async () => {
    const kv = new Map<string, string>();
    const env = {
      CACHE: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string) => {
          kv.set(k, v);
        },
      },
      tenancyCache: {
        match: async () => undefined,
        put: async () => {},
        delete: async () => true,
      },
    };
    const inv = createInvalidator(env);
    await inv.bumpOwnVersion();
    const v1 = kv.get(KV_VERSION_KEY);
    await new Promise((r) => setTimeout(r, 5));
    await inv.bumpOwnVersion();
    const v2 = kv.get(KV_VERSION_KEY);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    if (v1 !== undefined && v2 !== undefined) {
      expect(Number(v2.slice(1))).toBeGreaterThan(Number(v1.slice(1)));
    }
  });
});

describe("A2.6 FanOutInvalidator", () => {
  it("fanOut calls peer bindings", async () => {
    const calls: string[] = [];
    const peer = (name: string) => ({
      invalidateTenant: async (spec: unknown) => {
        calls.push(`${name}:${JSON.stringify(spec)}`);
      },
    });
    const env = {
      CACHE: { get: async () => "v0", put: async () => {} },
      tenancyCache: {
        match: async () => undefined,
        put: async () => {},
        delete: async () => true,
      },
      API: peer("API"),
      AUTH: peer("AUTH"),
    };
    const fan = createFanOutInvalidator(env);
    await fan.fanOut({ kind: "subdomain", host: "acme.app.example.com" });
    expect(calls.sort()).toEqual([
      `API:{"kind":"subdomain","host":"acme.app.example.com"}`,
      `AUTH:{"kind":"subdomain","host":"acme.app.example.com"}`,
    ]);
  });
});
