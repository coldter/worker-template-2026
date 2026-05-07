import { describe, expect, it, vi } from "vitest";

// Module-level cache stub. The auth invalidator captures `caches.default` at
// module load time (see `src/invalidator.ts`), so the stub MUST exist before
// any module under test imports it. Each test resets the inner store via
// `cacheStore.clear()` rather than reassigning the outer object.
const cacheStore = new Map<string, Response>();
const kvStore = new Map<string, string>();
// boundary: vendor-SDK generic variance — Workers exposes `caches.default`
// at runtime; the DOM `CacheStorage` typing doesn't model it. Stub here so
// the module-level capture in `src/invalidator.ts` resolves under vitest.
(globalThis as unknown as { caches: { default: Cache } }).caches = {
  default: {
    match: async (req: Request) => cacheStore.get(req.url),
    put: async (req: Request, res: Response) => {
      cacheStore.set(req.url, res);
    },
    delete: async (req: Request) => cacheStore.delete(req.url),
  } as unknown as Cache,
};

// Stub transitive pg / drizzle deps so the entrypoint module graph resolves
// without a real Postgres connection (matches the pattern used in
// `apps/server/src/__tests__`).
vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

// Stub `cloudflare:workers` so we can construct AuthEntrypoint in node tests.
// boundary: vendor-SDK generic variance — Cloudflare ships the WorkerEntrypoint
// runtime class in the special `cloudflare:workers` module that's only resolved
// on the platform; vitest needs a structural shim.
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

describe("A2.6 / A2.9 auth-worker invalidator RPC", () => {
  it("AuthEntrypoint exposes invalidateTenant + bumpTenantCacheVersion", async () => {
    const { AuthEntrypoint } = await import("../index");
    expect(typeof AuthEntrypoint.prototype.invalidateTenant).toBe("function");
    expect(typeof AuthEntrypoint.prototype.bumpTenantCacheVersion).toBe(
      "function"
    );
  });

  it("invalidateTenant clears the local cache entry for the host", async () => {
    cacheStore.clear();
    cacheStore.set(
      "https://tenancy/cache:tenant:v0:acme.app.example.com",
      new Response("x")
    );
    const env = {
      CACHE: {
        get: async () => "v0",
        put: async () => {
          /* noop */
        },
      },
    } as unknown as CloudflareBindings;
    const ctx = {
      waitUntil: () => {
        /* noop */
      },
    } as unknown as ExecutionContext;
    const { AuthEntrypoint } = await import("../index");
    // boundary: WorkerEntrypoint constructor (ctx, env) shape lives in the
    // `cloudflare:workers` runtime module; use the stub here.
    const ep = new AuthEntrypoint(ctx, env);
    await ep.invalidateTenant({
      kind: "subdomain",
      host: "acme.app.example.com",
    });
    expect(cacheStore.size).toBe(0);
  });

  it("bumpTenantCacheVersion writes a new monotonic version to KV", async () => {
    kvStore.clear();
    const env = {
      CACHE: {
        get: async (k: string) => kvStore.get(k) ?? null,
        put: async (k: string, v: string) => {
          kvStore.set(k, v);
        },
      },
    } as unknown as CloudflareBindings;
    const ctx = {
      waitUntil: () => {
        /* noop */
      },
    } as unknown as ExecutionContext;
    const { AuthEntrypoint } = await import("../index");
    const ep = new AuthEntrypoint(ctx, env);
    const v1 = await ep.bumpTenantCacheVersion();
    await new Promise((r) => setTimeout(r, 5));
    const v2 = await ep.bumpTenantCacheVersion();
    expect(v1.startsWith("v")).toBe(true);
    expect(v2.startsWith("v")).toBe(true);
    expect(Number(v2.slice(1))).toBeGreaterThan(Number(v1.slice(1)));
  });
});
