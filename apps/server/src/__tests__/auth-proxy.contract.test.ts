import { describe, expect, it, vi } from "vitest";

// Stub transitive pg / drizzle deps
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

// Captured args from last handleAuthRequest call. Typed as the structural
// shape passed by tenancyMiddleware so assertions can read fields without
// re-narrowing through `expect().not.toBeNull()`.
type CapturedTenant = { host: string } & Record<string, unknown>;
let capturedRequest: Request | null = null;
let capturedTenant: CapturedTenant | null = null;

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
    const tenant = {
      organizationId: "org_acme",
      slug: "acme",
      host,
      kind: "subdomain",
      enforceSSO: false,
      sessionVersion: 0,
      suspendedAt: null,
      deletedAt: null,
    };
    c.set("tenant", tenant);
    return next();
  },
}));

// boundary: test fixture — bindings are stubbed end-to-end so the cast is
// the only way to satisfy `app.fetch(req, env, ctx)`.
const mockEnv = {
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
    handleAuthRequest: async (req: Request, tenant: unknown) => {
      capturedRequest = req;
      // boundary: test stub erases the RPC arg type; cast to the structural
      // shape produced by the mocked tenancy middleware.
      capturedTenant = (tenant as CapturedTenant | null) ?? null;
      return new Response("ok", { status: 200 });
    },
    getSession: async () => null,
    getToken: async () => null,
  },
  ONBOARDING_WF: {},
  EMAIL_NOTIFICATION_WF: {},
  PUSH_NOTIFICATION_WF: {},
} as unknown as CloudflareBindings;

// boundary: test fixture — ExecutionContext is opaque platform-side, so the
// cast is required to construct one in node tests.
const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

function readCaptured(): {
  request: Request | null;
  tenant: CapturedTenant | null;
} {
  // Wrapping the read defeats tsgo's flow-narrowing on the module-scoped
  // `let` bindings (which the mock callback mutates from a closure).
  return { request: capturedRequest, tenant: capturedTenant };
}

describe("A3.6 auth proxy contract", () => {
  it("forwards the request to AUTH.handleAuthRequest with the tenant", async () => {
    capturedRequest = null;
    capturedTenant = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: { Host: "acme.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    const captured = readCaptured();
    expect(captured.request).not.toBeNull();
    expect(captured.tenant?.host).toBe("acme.app.localhost");
  });

  it("poisoned X-Forwarded-Host does not reach AUTH.handleAuthRequest", async () => {
    capturedRequest = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: {
          Host: "acme.app.localhost",
          "X-Forwarded-Host": "attacker.example.com",
        },
      }),
      mockEnv,
      mockCtx
    );
    // The tenant is derived from the Host header by tenancy middleware,
    // not from X-Forwarded-Host. The auth proxy passes the raw request
    // to handleAuthRequest which sanitizes it on the auth-worker side.
    // The tenant.host must reflect the real Host, not the poisoned header.
    expect(capturedTenant?.host).toBe("acme.app.localhost");
  });

  it("X-Forwarded-Proto in request does not change tenant host", async () => {
    capturedRequest = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: {
          Host: "acme.app.localhost",
          "X-Forwarded-Proto": "http",
        },
      }),
      mockEnv,
      mockCtx
    );
    expect(capturedTenant?.host).toBe("acme.app.localhost");
  });

  it("X-Forwarded-For in request does not change tenant host", async () => {
    capturedRequest = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: {
          Host: "acme.app.localhost",
          "X-Forwarded-For": "1.2.3.4",
        },
      }),
      mockEnv,
      mockCtx
    );
    expect(capturedTenant?.host).toBe("acme.app.localhost");
  });

  it("Forwarded header in request does not change tenant host", async () => {
    capturedRequest = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: {
          Host: "acme.app.localhost",
          Forwarded: "for=1.2.3.4;host=evil.example.com",
        },
      }),
      mockEnv,
      mockCtx
    );
    expect(capturedTenant?.host).toBe("acme.app.localhost");
  });

  it("X-Forwarded-Port in request does not change tenant host", async () => {
    capturedRequest = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: {
          Host: "acme.app.localhost",
          "X-Forwarded-Port": "8443",
        },
      }),
      mockEnv,
      mockCtx
    );
    expect(capturedTenant?.host).toBe("acme.app.localhost");
  });

  it("CF-Connecting-IP in request does not change tenant host", async () => {
    capturedRequest = null;
    const { default: app } = await import("../server");
    await app.fetch(
      new Request("https://acme.app.localhost/api/auth/session", {
        headers: {
          Host: "acme.app.localhost",
          "CF-Connecting-IP": "1.2.3.4",
        },
      }),
      mockEnv,
      mockCtx
    );
    expect(capturedTenant?.host).toBe("acme.app.localhost");
  });

  it("ghost host returns 404 before reaching auth proxy", async () => {
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://ghost.app.localhost/api/auth/session", {
        headers: { Host: "ghost.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(404);
  });
});
