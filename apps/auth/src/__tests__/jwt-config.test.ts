import type { Tenant } from "@repo/tenancy";
import { describe, expect, it } from "vitest";
import {
  buildJwtPayload,
  deriveJwtAudience,
  deriveJwtIssuer,
  type JwtConfigEnv,
} from "../jwt-config";
import type { UserWithStatusFields } from "../plugins/user-status";

const stubEnv: JwtConfigEnv = {
  APP_URL: "https://app.example.com",
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
  sessionVersion: 7,
  suspendedAt: null,
  deletedAt: null,
});

type UserShape = { id: string; email: string } & Partial<UserWithStatusFields>;

const baseUser: UserShape = {
  id: "user_1",
  email: "user@acme.com",
  roleSlugs: ["tenant_admin"],
};

const baseSession = {
  platform: "web" as const,
};

describe("deriveJwtIssuer", () => {
  it("returns the URL-form host for a subdomain tenant", () => {
    expect(deriveJwtIssuer(subdomainTenant, stubEnv)).toBe(
      "https://acme.app.example.com"
    );
  });

  it("returns the URL-form host for a custom-hostname tenant", () => {
    expect(deriveJwtIssuer(customTenant, stubEnv)).toBe("https://app.acme.com");
  });

  it("falls back to env.APP_URL when tenant is null", () => {
    expect(deriveJwtIssuer(null, stubEnv)).toBe("https://app.example.com");
  });
});

describe("deriveJwtAudience", () => {
  it("returns the URL-form host for a subdomain tenant", () => {
    expect(deriveJwtAudience(subdomainTenant, stubEnv)).toBe(
      "https://acme.app.example.com"
    );
  });

  it("returns the URL-form host for a custom-hostname tenant", () => {
    expect(deriveJwtAudience(customTenant, stubEnv)).toBe(
      "https://app.acme.com"
    );
  });

  it("falls back to env.APP_URL when tenant is null", () => {
    expect(deriveJwtAudience(null, stubEnv)).toBe("https://app.example.com");
  });
});

describe("buildJwtPayload", () => {
  it("builds payload with org claim for a subdomain tenant", () => {
    const payload = buildJwtPayload(baseUser, baseSession, subdomainTenant);
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

  it("threads sessionVersion from tenant.sessionVersion not from a re-read", () => {
    const payload = buildJwtPayload(baseUser, baseSession, customTenant);
    expect(payload.org).toEqual({
      id: "org_acme",
      host: "app.acme.com",
      sessionVersion: 7,
    });
  });

  it("returns org=null when tenant is null", () => {
    const payload = buildJwtPayload(baseUser, baseSession, null);
    expect(payload.org).toBeNull();
  });

  it("defaults roleSlugs to [] for legacy users without that field", () => {
    const legacyUser: UserShape = { id: "user_2", email: "legacy@acme.com" };
    const payload = buildJwtPayload(legacyUser, baseSession, subdomainTenant);
    expect(payload.roleSlugs).toEqual([]);
  });
});
