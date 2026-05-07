import type { Tenant } from "@repo/tenancy";
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { assertSameTenantOnUpdate } from "../session-update-before";

const tenant: Tenant = Object.freeze({
  organizationId: "org_acme",
  slug: "acme",
  host: "acme.app.example.com",
  kind: "subdomain",
  enforceSSO: false,
  sessionVersion: 0,
  suspendedAt: null,
  deletedAt: null,
});

describe("assertSameTenantOnUpdate (A6.5)", () => {
  it("throws FORBIDDEN when setActive targets a foreign org", () => {
    expect(() =>
      assertSameTenantOnUpdate(tenant, {
        activeOrganizationId: "org_other",
      })
    ).toThrow(APIError);
  });

  it("passes when setActive targets the resolved tenant", () => {
    expect(() =>
      assertSameTenantOnUpdate(tenant, {
        activeOrganizationId: "org_acme",
      })
    ).not.toThrow();
  });

  it("is a no-op when tenant is null (apex)", () => {
    expect(() =>
      assertSameTenantOnUpdate(null, {
        activeOrganizationId: "org_other",
      })
    ).not.toThrow();
  });

  it("is a no-op when activeOrganizationId is not in the update payload", () => {
    expect(() =>
      assertSameTenantOnUpdate(tenant, {
        expiresAt: new Date(),
      })
    ).not.toThrow();
  });

  it("is a no-op when activeOrganizationId is set to null (clearing)", () => {
    expect(() =>
      assertSameTenantOnUpdate(tenant, {
        activeOrganizationId: null,
      })
    ).not.toThrow();
  });
});
