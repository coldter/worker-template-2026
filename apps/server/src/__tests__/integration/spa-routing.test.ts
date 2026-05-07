// B4.9 — integration coverage for the SPA STATIC_ASSETS forwarding path.
// Three host shapes must all hit the binding for non-`/api/*` traffic:
//   - default tenant subdomain (`acme.app.localhost`)
//   - tenant custom hostname (`app.acme.com`)
//   - apex of `APP_WILDCARD_HOST` (`app.localhost`)
//
// Per-host behavior on the SPA side (apex = static "Find your team" page,
// subdomains = SPA shell) is the responsibility of `apps/app`.

import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

vi.mock("@/middlewares/host-guard", () => ({
  hostHeaderGuard: async (_c: unknown, next: () => Promise<void>) => next(),
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
    c.set("tenant", null);
    await next();
  },
}));

function buildEnv(overrides: Partial<CloudflareBindings>): CloudflareBindings {
  return {
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
      handleAuthRequest: async () => new Response("ok", { status: 200 }),
      getSession: async () => null,
      getToken: async () => null,
    },
    ONBOARDING_WF: {},
    EMAIL_NOTIFICATION_WF: {},
    PUSH_NOTIFICATION_WF: {},
    ...overrides,
    // boundary: test fixture — bindings are stubbed end-to-end.
  } as unknown as CloudflareBindings;
}

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

const fixtures = [
  { host: "acme.app.localhost", desc: "default subdomain" },
  { host: "app.acme.com", desc: "tenant custom hostname" },
  { host: "app.localhost", desc: "wildcard apex" },
];

describe("SPA routing via STATIC_ASSETS", () => {
  for (const f of fixtures) {
    it(`forwards ${f.desc} non-API requests to STATIC_ASSETS`, async () => {
      const fetchMock = vi.fn(
        async (req: Request) =>
          new Response(`html for ${new URL(req.url).host}`, {
            headers: { "content-type": "text/html" },
          })
      );
      const { default: app } = await import("../../server");
      const res = await app.fetch(
        new Request(`https://${f.host}/dashboard`, {
          headers: { host: f.host },
        }),
        buildEnv({ STATIC_ASSETS: { fetch: fetchMock } as unknown as Fetcher }),
        mockCtx
      );
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalled();
      const passedReq = fetchMock.mock.calls[0]?.[0];
      if (!passedReq) {
        throw new Error("expected request to be forwarded");
      }
      expect(new URL(passedReq.url).host).toBe(f.host);
    });
  }
});
