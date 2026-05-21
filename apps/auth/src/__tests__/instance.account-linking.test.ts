import type { DrizzleClient } from "@repo/db";
import { describe, expect, it, vi } from "vitest";
import type { AllowedHostsSnapshot } from "../host-config";
import { type AuthBindings, createAuth } from "../instance";

// boundary: vendor-SDK generic variance — DrizzleClient is structurally
// erased to a few query helpers used by the BA hooks; the tests only assert
// configuration shape (auth.options) and never execute hooks against a real
// DB, so a stub object satisfies the runtime path.
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
  customHosts: Object.freeze([]),
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

describe("BA accountLinking config", () => {
  it("disables allowDifferentEmails and pins trustedProviders to []", () => {
    // Silence drizzleAdapter warnings during options construction.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const auth = createAuth(stubDb, stubEnv, stubCtx, {
        tenant: null,
        allowedHostsSnapshot: snapshot,
      });
      // boundary: BA's `auth` instance exposes `options` only at runtime; the
      // public types omit it, so reach via a structural cast.
      const options = (auth as unknown as { options?: { account?: unknown } })
        .options;
      const account = options?.account as
        | {
            accountLinking?: {
              allowDifferentEmails?: boolean;
              trustedProviders?: readonly string[];
            };
          }
        | undefined;
      expect(account).toBeDefined();
      expect(account?.accountLinking).toBeDefined();
      expect(account?.accountLinking?.allowDifferentEmails).toBe(false);
      expect(account?.accountLinking?.trustedProviders).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
