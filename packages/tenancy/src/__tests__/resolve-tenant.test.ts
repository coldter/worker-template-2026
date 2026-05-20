import { createDrizzleClient } from "@repo/db";
import { organizations, tenantCustomHostnames } from "@repo/db/schema";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadHostConfigOnce } from "../host-config";
import { resolveTenant } from "../resolve-tenant";

const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://postgres:postgres@localhost:5432/app_test";

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request): Promise<Response | undefined> {
    return this.store.get(req.url);
  }
  async put(req: Request, res: Response): Promise<void> {
    this.store.set(req.url, res.clone());
  }
  async delete(req: Request): Promise<boolean> {
    return this.store.delete(req.url);
  }
}
class FakeKV {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}

const env = {
  WILDCARD_SUFFIX: ".app.example.com",
  ADMIN_HOST: "admin.example.com",
  FALLBACK_HOST: "fallback.example.com",
  LOCAL_DEV_HOSTS: "",
  NODE_ENV: "test",
};

describe("A2.5 resolveTenant", () => {
  let rootClient: Client;
  let client: Client;
  let db: ReturnType<typeof createDrizzleClient>;
  let cache: FakeCache;
  let kv: FakeKV;

  beforeAll(async () => {
    rootClient = new Client({ connectionString: TEST_DB_URL });
    await rootClient.connect();
    await rootClient.query("DROP SCHEMA IF EXISTS public CASCADE");
    await rootClient.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await rootClient.query("CREATE SCHEMA public");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const tempDb = drizzle({ client: rootClient });
    await migrate(tempDb, {
      migrationsFolder: new URL(
        "../../node_modules/@repo/db/src/migrations",
        import.meta.url
      ).pathname,
    });
  }, 60_000);

  afterAll(async () => {
    await rootClient?.end();
  });

  beforeEach(async () => {
    client = new Client({ connectionString: TEST_DB_URL });
    await client.connect();
    db = createDrizzleClient(client);
    cache = new FakeCache();
    kv = new FakeKV();
    await db.delete(tenantCustomHostnames);
    await db.delete(organizations);
    await db.insert(organizations).values({
      id: "org_acme",
      name: "Acme",
      slug: "acme",
      enforceSSO: false,
      sessionVersion: 0,
      branding: {},
    });
  });

  it("subdomain hit reads DB, writes positive cache", async () => {
    const cfg = loadHostConfigOnce(env);
    const r = await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toMatchObject({
      organizationId: "org_acme",
      slug: "acme",
      kind: "subdomain",
    });
    expect(cache.store.size).toBe(1);
    await client.end();
  });

  it("returns TenantNotFound for unknown slug; cache TTL is 5s", async () => {
    const cfg = loadHostConfigOnce(env);
    const r = await resolveTenant("ghost.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toEqual({ kind: "not_found", host: "ghost.app.example.com" });
    const cached = await cache.match(
      new Request("https://tenancy/cache:tenant:v0:ghost.app.example.com")
    );
    expect(cached?.headers.get("cache-control")).toContain("max-age=5");
    await client.end();
  });

  it("custom host joins tenant_custom_hostnames", async () => {
    await db.insert(tenantCustomHostnames).values({
      organizationId: "org_acme",
      hostname: "app.acme.com",
      lifecycleStatus: "active",
      verificationToken: "tok",
    });
    const cfg = loadHostConfigOnce(env);
    const r = await resolveTenant("app.acme.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toMatchObject({
      organizationId: "org_acme",
      kind: "custom",
      host: "app.acme.com",
    });
    await client.end();
  });

  it("filters soft-deleted orgs", async () => {
    await db.update(organizations).set({ deletedAt: new Date() });
    const cfg = loadHostConfigOnce(env);
    const r = await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toEqual({ kind: "not_found", host: "acme.app.example.com" });
    await client.end();
  });

  it("returns TenantSuspended without 404", async () => {
    await db.update(organizations).set({ suspendedAt: new Date() });
    const cfg = loadHostConfigOnce(env);
    const r = await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toMatchObject({
      kind: "suspended",
      tenant: { organizationId: "org_acme" },
    });
    await client.end();
  });

  it("cache hit returns without DB", async () => {
    const cfg = loadHostConfigOnce(env);
    await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    await client.end();
    const cachedR = await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(cachedR).toMatchObject({ organizationId: "org_acme" });
  });

  it("treats malformed cache entries as a miss and evicts them", async () => {
    const cfg = loadHostConfigOnce(env);
    const cacheKey = new Request(
      "https://tenancy/cache:tenant:v0:acme.app.example.com"
    );
    await cache.put(
      cacheKey,
      new Response(JSON.stringify({ kind: "unexpected_shape", oops: true }), {
        headers: {
          "cache-control": "max-age=60",
          "content-type": "application/json",
        },
      })
    );
    const evicted: string[] = [];
    const cacheWithDelete = {
      match: (req: Request) => cache.match(req),
      put: (req: Request, res: Response) => cache.put(req, res),
      delete: async (req: Request) => {
        evicted.push(req.url);
        return await cache.delete(req);
      },
    };
    const r = await resolveTenant("acme.app.example.com", {
      db,
      cache: cacheWithDelete,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toMatchObject({
      organizationId: "org_acme",
      slug: "acme",
      kind: "subdomain",
    });
    expect(evicted).toContain(cacheKey.url);
    await client.end();
  });

  it("falls back to DB on unparseable cache text (non-JSON)", async () => {
    const cfg = loadHostConfigOnce(env);
    const cacheKey = new Request(
      "https://tenancy/cache:tenant:v0:acme.app.example.com"
    );
    await cache.put(
      cacheKey,
      new Response("not-json-at-all", {
        headers: {
          "cache-control": "max-age=60",
          "content-type": "application/json",
        },
      })
    );
    const r = await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toMatchObject({ organizationId: "org_acme" });
    await client.end();
  });

  it("version bump invalidates entries under old version", async () => {
    const cfg = loadHostConfigOnce(env);
    await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    await kv.put("cache:tenant:version", "v1");
    const r = await resolveTenant("acme.app.example.com", {
      db,
      cache,
      kv,
      config: cfg,
      waitUntil: (_p) => {},
    });
    expect(r).toMatchObject({ organizationId: "org_acme" });
    expect(cache.store.size).toBe(2);
    await client.end();
  });
});
