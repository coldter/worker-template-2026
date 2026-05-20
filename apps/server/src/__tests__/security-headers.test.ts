// B4.8 — CSP allows the per-tenant branding CDN host in `img-src` only.
// Final shape verified in B6 once branding upload pipeline lands.

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
    // boundary: test fixture — bindings are stubbed end-to-end so the cast
    // is the only way to satisfy `app.fetch(req, env, ctx)`.
  } as unknown as CloudflareBindings;
}

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

const IMG_SRC_BRANDING_RE = /img-src[^;]*branding\.example\.com/;
const DEFAULT_SRC_RE = /default-src 'self'/;
const SCRIPT_SRC_RE = /script-src 'self'/;
const STYLE_SRC_INLINE_RE = /style-src[^;]*'unsafe-inline'/;
const HSTS_MAX_AGE_RE = /max-age=31536000/;
const HSTS_INCLUDE_SUBDOMAINS_RE = /includeSubDomains/i;

describe("Content-Security-Policy", () => {
  it("includes BRANDING_HOST in img-src", async () => {
    const { default: app } = await import("../server");
    const res = await app.fetch(
      new Request("https://acme.app.localhost/dashboard", {
        headers: { host: "acme.app.localhost" },
      }),
      buildEnv({
        BRANDING_HOST: "branding.example.com",
        STATIC_ASSETS: {
          fetch: async () => new Response("<!doctype html>"),
        } as unknown as Fetcher,
      }),
      mockCtx
    );
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(IMG_SRC_BRANDING_RE);
    expect(csp).toMatch(DEFAULT_SRC_RE);
    expect(csp).toMatch(SCRIPT_SRC_RE);
    expect(csp).not.toMatch(STYLE_SRC_INLINE_RE);
  });

  it("emits Strict-Transport-Security with subdomain coverage", async () => {
    const { default: app } = await import("../server");
    const res = await app.fetch(
      new Request("https://acme.app.localhost/dashboard", {
        headers: { host: "acme.app.localhost" },
      }),
      buildEnv({
        STATIC_ASSETS: {
          fetch: async () => new Response("<!doctype html>"),
        } as unknown as Fetcher,
      }),
      mockCtx
    );
    const hsts = res.headers.get("strict-transport-security") ?? "";
    expect(hsts).toMatch(HSTS_MAX_AGE_RE);
    expect(hsts).toMatch(HSTS_INCLUDE_SUBDOMAINS_RE);
  });
});
