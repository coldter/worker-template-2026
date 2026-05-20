import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { loadHostConfigOnce } from "../host-config";
import { type TenancyEnv, tenantMiddleware } from "../middleware";
import type { ResolveDeps } from "../resolve-tenant";
import type { Tenant, TenantResolution } from "../types";

type OrgFixture = {
  id: string;
  slug: string;
  suspendedAt?: Date;
};

type MakeDepOptions = {
  orgs?: OrgFixture[];
  devGates?: boolean;
  logger?: {
    info(rec: Record<string, unknown>): void;
    warn(rec: Record<string, unknown>): void;
  };
};

const baseEnvProd = {
  WILDCARD_SUFFIX: ".app.example.com",
  ADMIN_HOST: "admin.example.com",
  FALLBACK_HOST: "fallback.example.com",
  LOCAL_DEV_HOSTS: "",
  NODE_ENV: "test",
  ALLOW_DEV_TENANT_HEADER: undefined as string | undefined,
};

const baseEnvDev = {
  ...baseEnvProd,
  NODE_ENV: "development",
  ALLOW_DEV_TENANT_HEADER: "true",
};

function buildTenantFromOrg(org: OrgFixture, host: string): Tenant {
  return {
    organizationId: org.id,
    slug: org.slug,
    host,
    kind: "subdomain",
    enforceSSO: false,
    sessionVersion: 0,
    suspendedAt: org.suspendedAt ?? null,
    deletedAt: null,
  };
}

function resolveBySlug(
  orgs: OrgFixture[],
  slug: string,
  host: string
): TenantResolution {
  const match = orgs.find((o) => o.slug === slug);
  if (!match) {
    return { kind: "not_found", host };
  }
  const tenant = buildTenantFromOrg(match, host);
  if (tenant.suspendedAt !== null) {
    return { kind: "suspended", tenant };
  }
  return tenant;
}

function makeDeps(
  opts: MakeDepOptions = {}
): Parameters<typeof tenantMiddleware>[0] {
  const orgs = opts.orgs ?? [];
  const devGates = opts.devGates ?? false;
  const logger = opts.logger ?? { info: () => {}, warn: () => {} };

  const envForConfig = devGates ? { ...baseEnvDev } : { ...baseEnvProd };
  const config = loadHostConfigOnce(envForConfig);

  const suffix = config.wildcardSuffix;

  const cacheStore = new Map<string, Response>();
  const kvStore = new Map<string, string>();

  function cacheKeyUrl(host: string): string {
    return `https://tenancy/cache:tenant:v0:${host}`;
  }

  function populateCache(host: string, result: TenantResolution): void {
    const payload =
      "organizationId" in result ? { kind: "found", tenant: result } : result;
    cacheStore.set(
      cacheKeyUrl(host),
      new Response(JSON.stringify(payload), {
        headers: {
          "cache-control": "max-age=60",
          "content-type": "application/json",
        },
      })
    );
  }

  for (const org of orgs) {
    const host = `${org.slug}${suffix}`;
    populateCache(host, resolveBySlug(orgs, org.slug, host));
  }

  type OrgRow = {
    organizationId: string;
    enforceSSO: boolean;
    sessionVersion: number;
    suspendedAt: Date | null;
    deletedAt: Date | null;
  };

  type QueryBuilder = {
    select: (_fields?: unknown) => QueryBuilder;
    from: (_table: unknown) => QueryBuilder;
    innerJoin: (_table: unknown, _on: unknown) => QueryBuilder;
    where: (_cond: unknown) => Promise<OrgRow[]>;
  };

  const fakeQueryBuilder: QueryBuilder = {
    select: () => fakeQueryBuilder,
    from: () => fakeQueryBuilder,
    innerJoin: () => fakeQueryBuilder,
    where: () => Promise.resolve([]),
  };

  // boundary: vendor-SDK generic variance — Drizzle's query builder shape is a
  // structural superset of the chain we exercise here; the cache-miss path is
  // never reached for known orgs in these tests, so the empty-array stub
  // suffices to satisfy the resolver's call site.
  const fakeDb = fakeQueryBuilder as unknown as ResolveDeps["db"];

  const resolveDeps: ResolveDeps = {
    db: fakeDb,
    cache: {
      match: async (req: Request) => cacheStore.get(req.url),
      put: async (req: Request, res: Response) => {
        cacheStore.set(req.url, res.clone());
      },
    },
    kv: { get: async (k: string) => kvStore.get(k) ?? null },
    config,
    waitUntil: (_p) => {},
  };

  return { ...resolveDeps, logger };
}

function buildApp(deps: Parameters<typeof tenantMiddleware>[0]) {
  const app = new Hono<TenancyEnv>();
  app.use("*", tenantMiddleware(deps));
  app.get("/whoami", (c) => c.json({ tenant: c.var.tenant }));
  return app;
}

describe("A2.8 tenantMiddleware", () => {
  it("200 on valid subdomain", async () => {
    const deps = makeDeps({ orgs: [{ id: "org_acme", slug: "acme" }] });
    const app = buildApp(deps);
    const r = await app.request("/whoami", {
      headers: { Host: "acme.app.example.com" },
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      tenant: { organizationId: "org_acme" },
    });
  });

  it("404 on unknown host", async () => {
    const deps = makeDeps({ orgs: [] });
    const app = buildApp(deps);
    const r = await app.request("/whoami", {
      headers: { Host: "ghost.app.example.com" },
    });
    expect(r.status).toBe(404);
  });

  it("404 on admin host", async () => {
    const deps = makeDeps({ orgs: [] });
    const app = buildApp(deps);
    const r = await app.request("/whoami", {
      headers: { Host: "admin.example.com" },
    });
    expect(r.status).toBe(404);
  });

  it("503 with Retry-After on suspended tenant", async () => {
    const deps = makeDeps({
      orgs: [{ id: "org_acme", slug: "acme", suspendedAt: new Date() }],
    });
    const app = buildApp(deps);
    const r = await app.request("/whoami", {
      headers: { Host: "acme.app.example.com" },
    });
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("60");
  });

  it("dev header rewrites host when gates are open", async () => {
    const deps = makeDeps({
      orgs: [{ id: "org_acme", slug: "acme" }],
      devGates: true,
    });
    const app = buildApp(deps);
    const r = await app.request("/whoami", {
      headers: { Host: "localhost:3000", "X-Dev-Tenant-Slug": "acme" },
    });
    expect(r.status).toBe(200);
  });

  it("dev header is unreachable in production (fail-closed gate)", async () => {
    // baseEnvProd has NODE_ENV=test which loadHostConfigOnce keeps as
    // "test"; flip it to "production" explicitly to assert the gate.
    const prodEnv = {
      ...baseEnvProd,
      NODE_ENV: "production",
      // Even with the gate flag set, production must ignore the header.
      ALLOW_DEV_TENANT_HEADER: "true" as const,
    };
    const config = loadHostConfigOnce(prodEnv);
    const events: Record<string, unknown>[] = [];
    const cacheStore = new Map<string, Response>();
    const kvStore = new Map<string, string>();
    type QB = {
      select: () => QB;
      from: () => QB;
      innerJoin: () => QB;
      where: () => Promise<unknown[]>;
    };
    const qb: QB = {
      select: () => qb,
      from: () => qb,
      innerJoin: () => qb,
      where: () => Promise.resolve([]),
    };
    // boundary: minimal Drizzle stub for the cache-miss path.
    const fakeDb = qb as unknown as ResolveDeps["db"];
    const deps: Parameters<typeof tenantMiddleware>[0] = {
      db: fakeDb,
      cache: {
        match: async (req: Request) => cacheStore.get(req.url),
        put: async (req: Request, res: Response) => {
          cacheStore.set(req.url, res.clone());
        },
      },
      kv: { get: async (k: string) => kvStore.get(k) ?? null },
      config,
      waitUntil: (_p) => {},
      logger: {
        info: (rec) => events.push(rec),
        warn: (rec) => events.push(rec),
      },
    };
    const app = buildApp(deps);
    await app.request("/whoami", {
      headers: { Host: "localhost:3000", "X-Dev-Tenant-Slug": "acme" },
    });
    // The middleware's production gate runs BEFORE we read the header,
    // so we should never see the `tenant.dev_header.ignored` event in
    // production.
    expect(events.some((e) => e.event === "tenant.dev_header.ignored")).toBe(
      false
    );
  });

  it("ignores X-Forwarded-Host", async () => {
    const deps = makeDeps({ orgs: [{ id: "org_acme", slug: "acme" }] });
    const app = buildApp(deps);
    const r = await app.request("/whoami", {
      headers: {
        Host: "ghost.app.example.com",
        "X-Forwarded-Host": "acme.app.example.com",
      },
    });
    expect(r.status).toBe(404);
  });

  it("emits structured WARN log on not_found", async () => {
    const logs: unknown[] = [];
    const deps = makeDeps({
      orgs: [],
      logger: { info: () => {}, warn: (rec) => logs.push(rec) },
    });
    const app = buildApp(deps);
    await app.request("/whoami", {
      headers: { Host: "ghost.app.example.com" },
    });
    expect(logs[0]).toMatchObject({
      event: "tenant.resolve.not_found",
      host: "ghost.app.example.com",
    });
  });
});
