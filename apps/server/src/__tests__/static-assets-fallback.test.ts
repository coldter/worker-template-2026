// B4.6 — apps/server forwards non-`/api/*` traffic to the STATIC_ASSETS
// service binding (which points at apps/app, D40, D45). API routes must NOT
// hit the binding — they 404 with the JSON envelope. Custom non-API paths
// (e.g. `/accept-invite/:id`) MUST hit the binding so the SPA shell can
// hydrate via `not_found_handling: "single-page-application"`.

import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

vi.mock("@/middlewares/db", () => ({
  dbMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set("db", {});
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

vi.mock("@/middlewares/tenancy", () => ({
  tenancyMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set("tenant", {
      organizationId: "org_acme",
      slug: "acme",
      host: "acme.app.localhost",
      kind: "subdomain",
      enforceSSO: false,
      sessionVersion: 0,
      suspendedAt: null,
      deletedAt: null,
    });
    await next();
  },
}));

function buildEnv(overrides: Partial<CloudflareBindings>): CloudflareBindings {
  // boundary: test fixture — bindings are stubbed end-to-end so the cast is
  // the only way to satisfy `app.fetch(req, env, ctx)`.
  return {
    WILDCARD_SUFFIX: ".app.localhost",
    ADMIN_HOST: "admin.localhost",
    FALLBACK_HOST: "fallback.localhost",
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
      handleAuthRequest: async () => new Response("ok", { status: 200 }),
      getSession: async () => null,
      getToken: async () => null,
    },
    ONBOARDING_WF: {},
    EMAIL_NOTIFICATION_WF: {},
    PUSH_NOTIFICATION_WF: {},
    ...overrides,
  } as unknown as CloudflareBindings;
}

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

describe("apps/server STATIC_ASSETS fallback", () => {
  it("forwards non-/api/* requests to STATIC_ASSETS.fetch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<!doctype html>", {
          headers: { "content-type": "text/html" },
        })
    );
    const { default: app } = await import("../server");
    const res = await app.fetch(
      new Request("https://acme.app.localhost/dashboard", {
        headers: { host: "acme.app.localhost" },
      }),
      buildEnv({ STATIC_ASSETS: { fetch: fetchMock } as unknown as Fetcher }),
      mockCtx
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does NOT forward /api/* requests to STATIC_ASSETS", async () => {
    const fetchMock = vi.fn();
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/this-route-does-not-exist", {
        headers: { host: "acme.app.localhost" },
      }),
      buildEnv({ STATIC_ASSETS: { fetch: fetchMock } as unknown as Fetcher }),
      mockCtx
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards /accept-invite/inv_xxx (custom route) to STATIC_ASSETS — apex/SPA fallback works", async () => {
    const fetchMock = vi.fn(async () => new Response("<!doctype html>"));
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/accept-invite/inv_1", {
        headers: { host: "acme.app.localhost" },
      }),
      buildEnv({ STATIC_ASSETS: { fetch: fetchMock } as unknown as Fetcher }),
      mockCtx
    );
    expect(fetchMock).toHaveBeenCalled();
  });
});
