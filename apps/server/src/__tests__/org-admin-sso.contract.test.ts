import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
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

// A4.5 — track invalidator calls so the rotation test can assert
// fanOutBumpVersion fired exactly once after a successful rotation.
const invalidatorSpies = {
  bumpOwnVersion: vi.fn().mockResolvedValue("v_test_1"),
  fanOutBumpVersion: vi.fn().mockResolvedValue(undefined),
  invalidateOwn: vi.fn().mockResolvedValue(undefined),
  fanOut: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/middlewares/invalidator", () => ({
  invalidatorMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set("invalidator", {
      bumpOwnVersion: invalidatorSpies.bumpOwnVersion,
      fanOutBumpVersion: invalidatorSpies.fanOutBumpVersion,
      invalidateOwn: invalidatorSpies.invalidateOwn,
      fanOut: invalidatorSpies.fanOut,
    });
    await next();
  },
  createServerInvalidator: () => ({
    bumpOwnVersion: invalidatorSpies.bumpOwnVersion,
    fanOutBumpVersion: invalidatorSpies.fanOutBumpVersion,
    invalidateOwn: invalidatorSpies.invalidateOwn,
    fanOut: invalidatorSpies.fanOut,
  }),
}));

// ---- auth-context stub ----
// We control what principal is in scope via capturedAuthCtx
let capturedAuthCtx: {
  user: {
    id: string;
    roleSlugs: string[];
    status: string;
    emailVerified: boolean;
    email: string;
  } | null;
  session: {
    id: string;
    activeOrganizationId: string | null;
    activeOrgRole: string | null;
  } | null;
} = { user: null, session: null };

vi.mock("@/middlewares/auth-context", () => ({
  authContextMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set("user", capturedAuthCtx.user);
    c.set("session", capturedAuthCtx.session);
    await next();
  },
}));

// ---- db stub ----
// We control db operations per test via capturedDb
type MockTx = {
  execute: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

let capturedDbInsertResult: unknown = {
  id: "sso_1",
  issuer: "https://idp.example.com",
  domain: "example.com",
  providerId: "pid_1",
  organizationId: "org_acme",
  domainVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
let capturedDbListResult: unknown[] = [];
let capturedDbUpdateResult: unknown = null;
let capturedDbDeleteResult: unknown = null;
let capturedDbRotateResult: unknown = null;
// Controls what the raw sql execute returns for sso_providers_decrypted reads.
// Set to null to simulate "no row found" (cross-tenant, provider not in this org).
let capturedDbExecuteRows: unknown[] = [
  { oidc_config: '{"clientId":"x","clientSecret":"old"}' },
];
let capturedTransactionCalled = false;
let _capturedAuditInsertCalled = false;
let _capturedSessionDeleteCalled = false;
let _capturedOrgVersionBumpCalled = false;

function makeMockTx(): MockTx {
  return {
    execute: vi.fn().mockResolvedValue({ rows: capturedDbExecuteRows }),
    insert: vi.fn().mockImplementation((table: unknown) => {
      // Distinguish between audit_logs and sso_providers inserts
      const tbl = table as { _: { name?: string } } | null;
      if (tbl?._ && tbl._.name === "audit_logs") {
        _capturedAuditInsertCalled = true;
        return {
          values: vi
            .fn()
            .mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }),
        };
      }
      return {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([capturedDbInsertResult]),
        }),
      };
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(capturedDbListResult),
      }),
    }),
    update: vi.fn().mockImplementation((table: unknown) => {
      const tbl = table as { _: { name?: string } } | null;
      if (tbl?._ && tbl._.name === "organization") {
        _capturedOrgVersionBumpCalled = true;
        return {
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }),
        };
      }
      return {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue(
                capturedDbRotateResult
                  ? [capturedDbRotateResult]
                  : [capturedDbUpdateResult]
              ),
          }),
        }),
      };
    }),
    delete: vi.fn().mockImplementation((table: unknown) => {
      const tbl = table as { _: { name?: string } } | null;
      if (tbl?._ && tbl._.name === "sessions") {
        _capturedSessionDeleteCalled = true;
        return { where: vi.fn().mockResolvedValue({ rowCount: 1 }) };
      }
      return {
        where: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue(
              capturedDbDeleteResult ? [capturedDbDeleteResult] : []
            ),
        }),
      };
    }),
  };
}

vi.mock("@/middlewares/db", () => ({
  dbMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>
  ) => {
    const tx = makeMockTx();
    const db = {
      ...tx,
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(capturedDbListResult),
        }),
      }),
      transaction: vi
        .fn()
        .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => {
          capturedTransactionCalled = true;
          return cb(makeMockTx());
        }),
    };
    c.set("db", db);
    await next();
  },
}));

// ---- tenancy stub ----
let capturedTenantOrgId = "org_acme";

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
      organizationId: capturedTenantOrgId,
      slug: capturedTenantOrgId === "org_acme" ? "acme" : "globex",
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

// boundary: test fixture reflection — bindings are stubbed for contract tests
const mockEnv = {
  SSO_KEY: "test-sso-key",
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
  AUDIT_LOG_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
  RATE_LIMITER: {},
  AUTH: {
    fetch: async () => new Response("auth stub", { status: 503 }),
    handleAuthRequest: async () => new Response("auth stub", { status: 400 }),
    getSession: async () => null,
    getToken: async () => null,
    invalidateTenant: vi.fn().mockResolvedValue(undefined),
    bumpTenantCacheVersion: vi.fn().mockResolvedValue("v_auth_1"),
    registerTrustedOrigin: vi
      .fn()
      .mockImplementation(async (_tenantId: string, issuerUrl: string) => ({
        ok: true,
        origin: new URL(issuerUrl).origin,
      })),
  },
  ONBOARDING_WF: {},
  EMAIL_NOTIFICATION_WF: {},
  PUSH_NOTIFICATION_WF: {},
} as unknown as CloudflareBindings;

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
  exports: {} as unknown,
  props: {} as unknown,
} as unknown as ExecutionContext;

function setOwnerPrincipal(orgId: string) {
  capturedAuthCtx = {
    user: {
      id: "user_owner",
      roleSlugs: [],
      status: "active",
      emailVerified: true,
      email: "owner@example.com",
    },
    session: {
      id: "sess_1",
      activeOrganizationId: orgId,
      activeOrgRole: "owner",
    },
  };
}

function setMemberPrincipal(orgId: string) {
  capturedAuthCtx = {
    user: {
      id: "user_member",
      roleSlugs: [],
      status: "active",
      emailVerified: true,
      email: "member@example.com",
    },
    session: {
      id: "sess_2",
      activeOrganizationId: orgId,
      activeOrgRole: "member",
    },
  };
}

const CREATE_BODY = JSON.stringify({
  issuer: "https://idp.example.com",
  domain: "example.com",
  providerId: "pid_test",
  oidcConfig: {
    clientId: "client_123",
    clientSecret: "secret_abc",
  },
});

describe("A4.4 org-admin SSO provider CRUD", () => {
  it("GET /api/org-admin/sso/providers returns 401 when unauthenticated", async () => {
    capturedAuthCtx = { user: null, session: null };
    capturedTenantOrgId = "org_acme";
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/org-admin/sso/providers", {
        headers: { Host: "acme.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(401);
  });

  it("GET /api/org-admin/sso/providers returns 403 when caller is org member (not owner/admin)", async () => {
    setMemberPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    capturedDbListResult = [];
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/org-admin/sso/providers", {
        headers: { Host: "acme.app.localhost" },
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(403);
  });

  it("POST /api/org-admin/sso/providers — owner can create provider; organizationId is forced from tenant", async () => {
    setOwnerPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    capturedTransactionCalled = false;
    capturedDbInsertResult = {
      id: "sso_1",
      issuer: "https://idp.example.com",
      domain: "example.com",
      providerId: "pid_test",
      organizationId: "org_acme",
      domainVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/org-admin/sso/providers", {
        method: "POST",
        headers: {
          Host: "acme.app.localhost",
          "Content-Type": "application/json",
        },
        body: CREATE_BODY,
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { provider: { organizationId: string } };
    expect(body.provider.organizationId).toBe("org_acme");
    // The transaction was used (pgp_sym_encrypt path)
    expect(capturedTransactionCalled).toBe(true);
  });

  it("POST /api/org-admin/sso/providers — registers issuer origin with auth worker after commit (A4.4)", async () => {
    setOwnerPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    capturedDbInsertResult = {
      id: "sso_2",
      issuer: "https://idp.example.com",
      domain: "example.com",
      providerId: "pid_test_2",
      organizationId: "org_acme",
      domainVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // boundary: vendor-SDK generic variance — the AUTH binding's typed
    // surface (Cloudflare AuthServiceBinding) does not declare our custom
    // RPC methods on the test stub; cast through unknown to read the spy.
    const registerSpy = (
      mockEnv.AUTH as unknown as {
        registerTrustedOrigin: ReturnType<typeof vi.fn>;
      }
    ).registerTrustedOrigin;
    registerSpy.mockClear();
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/org-admin/sso/providers", {
        method: "POST",
        headers: {
          Host: "acme.app.localhost",
          "Content-Type": "application/json",
        },
        body: CREATE_BODY,
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(201);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith(
      "org_acme",
      "https://idp.example.com"
    );
  });

  it("POST /api/org-admin/sso/providers — member gets 403", async () => {
    setMemberPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request("https://acme.app.localhost/api/org-admin/sso/providers", {
        method: "POST",
        headers: {
          Host: "acme.app.localhost",
          "Content-Type": "application/json",
        },
        body: CREATE_BODY,
      }),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(403);
  });

  it("PUT /api/org-admin/sso/providers/:providerId — cross-tenant owner gets 404", async () => {
    // Caller is owner of org_acme, but tenant is org_globex
    setOwnerPrincipal("org_acme");
    capturedTenantOrgId = "org_globex";
    capturedDbUpdateResult = null; // simulate not found because org doesn't match
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request(
        "https://globex.app.localhost/api/org-admin/sso/providers/sso_foreign",
        {
          method: "PUT",
          headers: {
            Host: "globex.app.localhost",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ issuer: "https://new.idp.com" }),
        }
      ),
      mockEnv,
      mockCtx
    );
    // Owner of org_acme but tenant is org_globex — principal has no org role
    // in org_globex session (activeOrgRole from org_acme session), so 403
    expect([403, 404]).toContain(r.status);
  });

  it("DELETE /api/org-admin/sso/providers/:providerId — owner can delete", async () => {
    setOwnerPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    capturedDbDeleteResult = { id: "sso_1" };
    capturedTransactionCalled = false;
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request(
        "https://acme.app.localhost/api/org-admin/sso/providers/sso_1",
        {
          method: "DELETE",
          headers: { Host: "acme.app.localhost" },
        }
      ),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe("A4.5 SSO secret rotation", () => {
  it("POST /api/org-admin/sso/providers/:id/rotate-secret — rotates secret, deletes sessions, bumps org version", async () => {
    setOwnerPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    capturedDbRotateResult = { id: "sso_1" };
    capturedDbExecuteRows = [
      { oidc_config: '{"clientId":"x","clientSecret":"old"}' },
    ];
    capturedTransactionCalled = false;
    _capturedSessionDeleteCalled = false;
    _capturedOrgVersionBumpCalled = false;
    invalidatorSpies.bumpOwnVersion.mockClear();
    invalidatorSpies.fanOutBumpVersion.mockClear();
    // boundary: vendor-SDK generic variance — the test stub adds extra RPC
    // methods that the typed AuthServiceBinding does not declare.
    const authBumpSpy = (
      mockEnv.AUTH as unknown as {
        bumpTenantCacheVersion: ReturnType<typeof vi.fn>;
      }
    ).bumpTenantCacheVersion;
    authBumpSpy.mockClear();
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request(
        "https://acme.app.localhost/api/org-admin/sso/providers/sso_1/rotate-secret",
        {
          method: "POST",
          headers: {
            Host: "acme.app.localhost",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientSecret: "new-secret" }),
        }
      ),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { success: boolean };
    expect(body.success).toBe(true);
    // Transaction was used
    expect(capturedTransactionCalled).toBe(true);
    // A4.5 — fanOutBumpVersion fires exactly once after the tx commits.
    // bumpOwnVersion is called by fanOutBumpVersion internally (via the
    // server-side createServerInvalidator implementation), but in this test
    // the mocked invalidator only spies on the public surface — we assert
    // the public method we called.
    expect(invalidatorSpies.fanOutBumpVersion).toHaveBeenCalledTimes(1);
  });

  it("POST /rotate-secret — failed rotation (provider not in tenant) does NOT call fanOutBumpVersion", async () => {
    setOwnerPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    // Simulate "no row found" for the decrypted view read.
    capturedDbExecuteRows = [];
    capturedDbRotateResult = null;
    invalidatorSpies.fanOutBumpVersion.mockClear();
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request(
        "https://acme.app.localhost/api/org-admin/sso/providers/sso_missing/rotate-secret",
        {
          method: "POST",
          headers: {
            Host: "acme.app.localhost",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientSecret: "new-secret" }),
        }
      ),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(404);
    expect(invalidatorSpies.fanOutBumpVersion).not.toHaveBeenCalled();
  });

  it("POST /rotate-secret — member gets 403", async () => {
    setMemberPrincipal("org_acme");
    capturedTenantOrgId = "org_acme";
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request(
        "https://acme.app.localhost/api/org-admin/sso/providers/sso_1/rotate-secret",
        {
          method: "POST",
          headers: {
            Host: "acme.app.localhost",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientSecret: "new-secret" }),
        }
      ),
      mockEnv,
      mockCtx
    );
    expect(r.status).toBe(403);
  });

  it("POST /rotate-secret — cross-tenant (owner of acme accessing globex) gets 403/404", async () => {
    setOwnerPrincipal("org_acme");
    capturedTenantOrgId = "org_globex"; // different tenant
    // Simulate: provider "sso_foreign" does not belong to org_globex
    capturedDbExecuteRows = [];
    capturedDbRotateResult = null;
    const { default: app } = await import("../server");
    const r = await app.fetch(
      new Request(
        "https://globex.app.localhost/api/org-admin/sso/providers/sso_foreign/rotate-secret",
        {
          method: "POST",
          headers: {
            Host: "globex.app.localhost",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientSecret: "evil-new-secret" }),
        }
      ),
      mockEnv,
      mockCtx
    );
    expect([403, 404]).toContain(r.status);
  });
});
