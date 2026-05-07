import { describe, expect, it, vi } from "vitest";

// Stub transitive pg / drizzle deps so the module graph resolves without a
// real Postgres connection (matches the pattern used in
// `server.tenancy.contract.test.ts`).
vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    env: unknown;
    ctx: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

describe("A2.6 / A2.9 server-side invalidator wiring", () => {
  it("createServerInvalidator returns a FanOutInvalidator-shaped object", async () => {
    // Provide caches.default for the module-level boundary cast.
    const cacheStore = new Map<string, Response>();
    (globalThis as unknown as { caches: { default: Cache } }).caches = {
      default: {
        match: async (req: Request) => cacheStore.get(req.url),
        put: async (req: Request, res: Response) => {
          cacheStore.set(req.url, res);
        },
        delete: async (req: Request) => cacheStore.delete(req.url),
      } as unknown as Cache,
    };
    const { createServerInvalidator } = await import(
      "@/middlewares/invalidator"
    );
    const peerCalls: string[] = [];
    const env = {
      CACHE: {
        get: async () => "v0",
        put: async () => {
          /* noop */
        },
      },
      AUTH: {
        invalidateTenant: async (spec: {
          kind: "subdomain" | "custom";
          host: string;
        }) => {
          peerCalls.push(`AUTH:${spec.host}`);
        },
        bumpTenantCacheVersion: async () => "v1",
      },
    } as unknown as Parameters<typeof createServerInvalidator>[0];
    const inv = createServerInvalidator(env);
    expect(typeof inv.invalidateOwn).toBe("function");
    expect(typeof inv.bumpOwnVersion).toBe("function");
    expect(typeof inv.fanOut).toBe("function");
    expect(typeof inv.fanOutBumpVersion).toBe("function");

    // Pre-populate cache for the host so invalidateOwn has something to clear.
    const cacheReq = new Request(
      "https://tenancy/cache:tenant:v0:acme.app.example.com"
    );
    cacheStore.set(cacheReq.url, new Response("x"));
    await inv.invalidateOwn({
      kind: "subdomain",
      host: "acme.app.example.com",
    });
    expect(cacheStore.size).toBe(0);

    // fanOut should additionally call AUTH binding.
    cacheStore.set(cacheReq.url, new Response("x"));
    await inv.fanOut({ kind: "subdomain", host: "acme.app.example.com" });
    expect(peerCalls).toEqual(["AUTH:acme.app.example.com"]);
    expect(cacheStore.size).toBe(0);
  });

  it("ApiEntrypoint exposes invalidateTenant + bumpTenantCacheVersion", async () => {
    (globalThis as unknown as { caches: { default: Cache } }).caches = {
      default: {
        match: async () => undefined,
        put: async () => {
          /* noop */
        },
        delete: async () => true,
      } as unknown as Cache,
    };
    const { ApiEntrypoint } = await import("@/entrypoint");
    expect(typeof ApiEntrypoint.prototype.invalidateTenant).toBe("function");
    expect(typeof ApiEntrypoint.prototype.bumpTenantCacheVersion).toBe(
      "function"
    );

    const kv = new Map<string, string>();
    const env = {
      CACHE: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string) => {
          kv.set(k, v);
        },
      },
    } as unknown as CloudflareBindings;
    const ctx = {
      waitUntil: () => {
        /* noop */
      },
    } as unknown as ExecutionContext;
    const ep = new ApiEntrypoint(ctx, env);
    const version = await ep.bumpTenantCacheVersion();
    expect(version.startsWith("v")).toBe(true);
  });
});
