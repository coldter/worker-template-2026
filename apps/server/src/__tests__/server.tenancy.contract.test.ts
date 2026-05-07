import { describe, expect, it, vi } from "vitest";

// Stub transitive pg / drizzle deps so the module graph resolves without a
// real Postgres connection (same pattern as route-coverage.test.ts).
vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

// Stub the DB middleware — no real Postgres.
vi.mock("@/middlewares/db", () => ({
  dbMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set("db", {});
    await next();
  },
}));

// Stub the analytics middleware (accesses env bindings).
vi.mock("@/middlewares/analytics", () => ({
  analyticsMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Stub rate-limit middleware (accesses Durable Object binding).
vi.mock("@/middlewares/rate-limit", () => ({
  rateLimitMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Stub the audit-context middleware.
vi.mock("@/middlewares/audit-context", () => ({
  auditContextMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

// Stub auth-context middleware.
vi.mock("@/middlewares/auth-context", () => ({
  authContextMiddleware: async (_c: unknown, next: () => Promise<void>) =>
    next(),
}));

// Stub the tenancy middleware wrapper in apps/server so we control resolution.
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

// boundary: test fixture reflection — bindings are stubbed for contract tests;
// the test exercises middleware routing, not the bindings themselves.
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
  },
  ONBOARDING_WF: {},
  EMAIL_NOTIFICATION_WF: {},
  PUSH_NOTIFICATION_WF: {},
} as unknown as CloudflareBindings;

// boundary: test fixture reflection — ExecutionContext stub for tests
const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

describe("A2.9 server tenancy contract", () => {
  it("returns 404 on ghost (unknown-tenant) host via tenancy middleware", async () => {
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://ghost.app.localhost/api/users", {
        headers: { Host: "ghost.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(404);
  });

  it("auth proxy route /api/auth/* requires tenant middleware (A3.6)", async () => {
    const { default: app } = await import("../server");
    // A3.6: auth proxy now runs inside /api/* middleware scope so tenancy runs
    // first. A ghost host is rejected by tenancy before reaching the auth proxy.
    const r = await app.fetch(
      new Request("https://ghost.app.localhost/api/auth/session", {
        headers: { Host: "ghost.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(404);
  });

  it("auth proxy route /api/auth/* forwards to AUTH binding for known tenant", async () => {
    const { default: app } = await import("../server");
    // For a known tenant (acme), the tenancy middleware sets the tenant, and
    // auth proxy calls AUTH.handleAuthRequest. The stub returns 400 (not tenant
    // resolution). We verify the request reaches the AUTH binding.
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: { Host: "acme.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    // The AUTH stub returns 400 (handleAuthRequest not implemented in stub)
    // rather than 404 from tenancy, which confirms auth proxy ran.
    expect(r.status).not.toBe(404);
  });
});
