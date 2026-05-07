import type { DrizzleClient } from "@repo/db";
import type { Tenant } from "@repo/tenancy";
import { describe, expect, it, vi } from "vitest";
import type { AllowedHostsSnapshot } from "../host-config";
import { type AuthBindings, createAuth } from "../instance";

// boundary: vendor-SDK generic variance — DrizzleClient is structurally
// erased; the JWT config tests only assert shape on auth.options and never
// execute hooks against a real DB.
const stubDb = {
  query: { users: { findFirst: async () => null } },
  select: () => ({
    from: () => ({
      where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
    }),
  }),
  delete: () => ({ where: async () => undefined }),
} as unknown as DrizzleClient;

const snapshot: AllowedHostsSnapshot = Object.freeze({
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  customHosts: Object.freeze(["app.acme.com"]),
  localDevHosts: Object.freeze([]),
});

const stubEnv = {
  BETTER_AUTH_SECRET: "a-very-long-secret-for-testing-only-32chars",
  RESEND_API_KEY: "stub",
  APP_URL: "https://app.example.com",
  APP_NAME: "App",
  COMPANY_NAME: "Acme Inc.",
  SUPPORT_EMAIL: "support@example.com",
  LOGO_TEXT: "App",
  BRAND_PRIMARY_COLOR: "#2563eb",
  EMAIL_FROM: "noreply@example.com",
  NODE_ENV: "test",
  WILDCARD_SUFFIX: ".app.example.com",
  ADMIN_HOST: "admin.example.com",
  CACHE: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
  API: {
    onUserCreated: async () => undefined,
    onNewDeviceLogin: async () => undefined,
  },
  HYPERDRIVE: { connectionString: "" },
} as unknown as AuthBindings;

const stubCtx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
};

const subdomainTenant: Tenant = Object.freeze({
  organizationId: "org_acme",
  slug: "acme",
  host: "acme.app.example.com",
  kind: "subdomain",
  enforceSSO: false,
  sessionVersion: 0,
  suspendedAt: null,
  deletedAt: null,
});

const customTenant: Tenant = Object.freeze({
  organizationId: "org_acme",
  slug: "acme",
  host: "app.acme.com",
  kind: "custom",
  enforceSSO: false,
  sessionVersion: 3,
  suspendedAt: null,
  deletedAt: null,
});

type JwtPluginConfig = {
  jwt?: {
    issuer?: string;
    audience?: string;
    expirationTime?: string;
    definePayload?: (input: {
      user: Record<string, unknown>;
      session: Record<string, unknown>;
    }) => unknown;
  };
};

function getJwtPluginConfig(options: {
  tenant: Tenant | null;
  allowedHostsSnapshot: AllowedHostsSnapshot;
}): JwtPluginConfig {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const auth = createAuth(stubDb, stubEnv, stubCtx, options);
    // boundary: BA's `auth` instance exposes `options.plugins` only at runtime
    // and the public types omit it. We reach via a structural cast for tests.
    const opts = (
      auth as unknown as {
        options?: { plugins?: Array<{ id: string; options?: unknown }> };
      }
    ).options;
    const jwtPlugin = opts?.plugins?.find((p) => p.id === "jwt");
    if (!jwtPlugin) {
      throw new Error("jwt plugin missing from auth options");
    }
    return (jwtPlugin.options ?? {}) as JwtPluginConfig;
  } finally {
    warnSpy.mockRestore();
  }
}

describe("A6.3 BA JWT plugin per-tenant config", () => {
  it("subdomain tenant: aud/iss are URL-form for tenant.host", () => {
    const cfg = getJwtPluginConfig({
      tenant: subdomainTenant,
      allowedHostsSnapshot: snapshot,
    });
    expect(cfg.jwt?.issuer).toBe("https://acme.app.example.com");
    expect(cfg.jwt?.audience).toBe("https://acme.app.example.com");
    expect(cfg.jwt?.expirationTime).toBe("15m");
  });

  it("subdomain tenant: definePayload returns org claim with id/host/sessionVersion", () => {
    const cfg = getJwtPluginConfig({
      tenant: subdomainTenant,
      allowedHostsSnapshot: snapshot,
    });
    const payload = cfg.jwt?.definePayload?.({
      user: {
        id: "user_1",
        email: "user@acme.com",
        roleSlugs: ["tenant_admin"],
      },
      session: { platform: "web" },
    });
    expect(payload).toEqual({
      sub: "user_1",
      email: "user@acme.com",
      roleSlugs: ["tenant_admin"],
      platform: "web",
      org: {
        id: "org_acme",
        host: "acme.app.example.com",
        sessionVersion: 0,
      },
    });
  });

  it("custom-hostname tenant: aud/iss are URL-form for the custom host", () => {
    const cfg = getJwtPluginConfig({
      tenant: customTenant,
      allowedHostsSnapshot: snapshot,
    });
    expect(cfg.jwt?.issuer).toBe("https://app.acme.com");
    expect(cfg.jwt?.audience).toBe("https://app.acme.com");
  });

  it("custom-hostname tenant: definePayload threads sessionVersion from tenant", () => {
    const cfg = getJwtPluginConfig({
      tenant: customTenant,
      allowedHostsSnapshot: snapshot,
    });
    const payload = cfg.jwt?.definePayload?.({
      user: { id: "u", email: "u@a.com", roleSlugs: ["tenant_admin"] },
      session: { platform: "mobile" },
    }) as { org: { sessionVersion: number; host: string } };
    expect(payload.org.sessionVersion).toBe(3);
    expect(payload.org.host).toBe("app.acme.com");
  });

  it("apex / no tenant: aud/iss fall back to env.APP_URL and org=null", () => {
    const cfg = getJwtPluginConfig({
      tenant: null,
      allowedHostsSnapshot: snapshot,
    });
    expect(cfg.jwt?.issuer).toBe("https://app.example.com");
    expect(cfg.jwt?.audience).toBe("https://app.example.com");
    const payload = cfg.jwt?.definePayload?.({
      user: { id: "u", email: "u@a.com", roleSlugs: [] },
      session: { platform: "web" },
    }) as { org: unknown };
    expect(payload.org).toBeNull();
  });
});
