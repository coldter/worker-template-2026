import { describe, expect, it, vi } from "vitest";

// Stub transitive pg / drizzle deps so the module graph resolves without a
// real Postgres connection (matches the pattern used in
// `server.tenancy.contract.test.ts`).
vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

// The /api/tenancy/current handler runs a select against drizzle. Stub a tiny
// query builder that returns a single canned row keyed off the captured
// organizationId from the tenancy stub.
type OrgRow = {
  id: string;
  name: string;
  slug: string | null;
  enforceSSO: boolean;
  branding: {
    primaryColor?: string;
    appName?: string;
    logoUrl?: string;
    logoVersion?: number;
    logoExt?: string;
  };
};

const orgRow: OrgRow = {
  id: "org_acme",
  name: "Acme, Inc.",
  slug: "acme",
  enforceSSO: false,
  branding: {
    primaryColor: "#2563eb",
    appName: "Acme",
    logoVersion: 1_714_972_800_000,
    logoExt: "png",
  },
};

let dbStubReturnsRow = true;

vi.mock("@/middlewares/db", () => ({
  dbMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set("db", {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(dbStubReturnsRow ? [orgRow] : []),
        }),
      }),
    });
    await next();
  },
}));

vi.mock("@/middlewares/analytics", () => ({
  analyticsMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("@/middlewares/rate-limit", () => ({
  rateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("@/middlewares/audit-context", () => ({
  auditContextMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

vi.mock("@/middlewares/auth-context", () => ({
  authContextMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

// The invalidator middleware reads caches.default — provide a tiny stub.
vi.mock("@/middlewares/invalidator", () => ({
  invalidatorMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    next(),
  createServerInvalidator: () => ({
    invalidateOwn: async () => {
      /* noop */
    },
    bumpOwnVersion: async () => "v0",
    fanOut: async () => {
      /* noop */
    },
    fanOutBumpVersion: async () => {
      /* noop */
    },
  }),
}));

vi.mock("@/middlewares/tenancy", () => ({
  tenancyMiddleware: async (
    c: {
      req: { header: (h: string) => string | undefined };
      notFound: () => Response;
      set: (k: string, v: unknown) => void;
    },
    next: () => Promise<void>
  ) => {
    const host = c.req.header("Host") ?? "";
    if (host.startsWith("ghost.")) {
      c.set("tenant", null);
      return c.notFound();
    }
    c.set("tenant", {
      organizationId: "org_acme",
      slug: "acme",
      host,
      kind: "subdomain",
      enforceSSO: false,
      sessionVersion: 0,
      suspendedAt: null,
      deletedAt: null,
    });
    return next();
  },
}));

// boundary: test fixture reflection — bindings stubbed end-to-end.
const mockEnv = {
  WILDCARD_SUFFIX: ".app.localhost",
  ADMIN_HOST: "admin.localhost",
  FALLBACK_HOST: "app.localhost",
  LOCAL_DEV_HOSTS: "",
  NODE_ENV: "development",
  APP_URL: "http://localhost:8787",
  CORS_ORIGINS: "http://localhost:3001",
  EMAIL_FROM: "noreply@example.com",
  APP_NAME: "App",
  COMPANY_NAME: "Acme Inc.",
  SUPPORT_EMAIL: "support@example.com",
  LOGO_TEXT: "App",
  BRAND_PRIMARY_COLOR: "#2563eb",
  FCM_PROVIDER: "firebase",
  BRANDING_BASE_URL: "https://cdn.example.com/branding",
  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: "stub",
  RESEND_API_KEY: "stub",
  VAULT_MASTER_KEY: "stub",
  CACHE: {},
  HYPERDRIVE: {},
  ANALYTICS: {},
  PRODUCT_ANALYTICS: {},
  AUDIT_LOG_QUEUE: {},
  RATE_LIMITER: {},
  AUTH: {
    fetch: async () => new Response("auth stub", { status: 503 }),
    handleAuthRequest: async () => new Response("auth stub", { status: 400 }),
    getSession: async () => null,
    getToken: async () => null,
    invalidateTenant: async () => {
      /* noop */
    },
    bumpTenantCacheVersion: async () => "v0",
  },
  ONBOARDING_WF: {},
  EMAIL_NOTIFICATION_WF: {},
  PUSH_NOTIFICATION_WF: {},
} as unknown as CloudflareBindings;

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => {
    /* noop */
  },
  passThroughOnException: () => {
    /* noop */
  },
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

describe("D78 GET /api/tenancy/current contract", () => {
  it("returns 200 with the locked response shape for a resolved tenant", async () => {
    dbStubReturnsRow = true;
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/tenancy/current", {
        headers: { Host: "acme.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({
      id: "org_acme",
      slug: "acme",
      host: "acme.app.localhost",
      name: "Acme, Inc.",
      enforceSso: false,
      branding: {
        primaryColor: "#2563eb",
        logoUrl: "https://cdn.example.com/branding/acme/1714972800000.png",
        appName: "Acme",
        logoVersion: 1_714_972_800_000,
      },
    });
  });

  it("returns 404 when the tenancy middleware did not resolve a tenant", async () => {
    dbStubReturnsRow = true;
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://ghost.app.localhost/api/tenancy/current", {
        headers: { Host: "ghost.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(404);
  });

  it("does not require a session (auth-context is bypassed)", async () => {
    dbStubReturnsRow = true;
    // No Cookie / Authorization header — handler should still return 200.
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/tenancy/current", {
        headers: { Host: "acme.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(200);
  });
});
