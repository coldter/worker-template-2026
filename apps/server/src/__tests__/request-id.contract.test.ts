// A7.7 — request-id propagation contract. Asserts the request-id middleware
// (a) mints a fresh UUID when the inbound header is missing, (b) replaces a
// malformed inbound id with a fresh UUID, (c) echoes a valid inbound id on
// the response, (d) is set on error responses (404 from tenancy), and
// (e) propagates to the AUTH service binding when a request fans out
// through the auth proxy.

import { describe, expect, it, vi } from "vitest";

// Stub transitive pg / drizzle deps so the module graph resolves without a
// real Postgres connection.
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

let observedRequestId: string | null = null;

function buildEnv(): CloudflareBindings {
  // boundary: test fixture — bindings are stubbed end-to-end so the cast is
  // the only way to satisfy `app.fetch(req, env, ctx)`.
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
      handleAuthRequest: async (req: Request) => {
        observedRequestId = req.headers.get("X-Request-Id");
        return new Response("ok", { status: 200 });
      },
      getSession: async () => null,
      getToken: async () => null,
    },
    ONBOARDING_WF: {},
    EMAIL_NOTIFICATION_WF: {},
    PUSH_NOTIFICATION_WF: {},
  } as unknown as CloudflareBindings;
}

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

const UUIDV4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ID = "11111111-1111-4111-8111-111111111111";

describe("A7.7 request-id propagation contract", () => {
  it("echoes a valid inbound X-Request-Id on the response", async () => {
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/users", {
        headers: { Host: "acme.app.localhost", "X-Request-Id": VALID_ID },
      }),
      buildEnv(),
      mockCtx
    );
    expect(r.headers.get("X-Request-Id")).toBe(VALID_ID);
  });

  it("mints a fresh UUID when no inbound id is present", async () => {
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/users", {
        headers: { Host: "acme.app.localhost" },
      }),
      buildEnv(),
      mockCtx
    );
    const id = r.headers.get("X-Request-Id");
    expect(id).toBeTruthy();
    expect(id ?? "").toMatch(UUIDV4_RE);
  });

  it("replaces a malformed inbound X-Request-Id with a fresh UUID", async () => {
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/users", {
        headers: {
          Host: "acme.app.localhost",
          "X-Request-Id": "not-a-uuid; DROP TABLE users;--",
        },
      }),
      buildEnv(),
      mockCtx
    );
    const id = r.headers.get("X-Request-Id");
    expect(id).toBeTruthy();
    expect(id ?? "").not.toBe("not-a-uuid; DROP TABLE users;--");
    expect(id ?? "").toMatch(UUIDV4_RE);
  });

  it("404 from tenant resolution still carries X-Request-Id", async () => {
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://ghost.app.localhost/api/users", {
        headers: { Host: "ghost.app.localhost", "X-Request-Id": VALID_ID },
      }),
      buildEnv(),
      mockCtx
    );
    expect(r.status).toBe(404);
    expect(r.headers.get("X-Request-Id")).toBe(VALID_ID);
  });

  it("propagates X-Request-Id across the AUTH service binding hop", async () => {
    observedRequestId = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: { Host: "acme.app.localhost", "X-Request-Id": VALID_ID },
      }),
      buildEnv(),
      mockCtx
    );
    // The AUTH binding's handleAuthRequest receives the inbound request
    // (auth-proxy.ts forwards `c.req.raw`). The test asserts the request-id
    // header survives the cross-worker hop.
    expect(observedRequestId).toBe(VALID_ID);
  });
});
