import type { DrizzleClient } from "@repo/db";
import type { Tenant } from "@repo/tenancy";
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { enforceTenantMembership } from "../session-create-before";

type Row = Record<string, unknown>;

function makeStubDb(rows: { organizations: Row[]; members: Row[] }) {
  function buildSelect(table: "organizations" | "members") {
    // Both shapes are needed so the stub satisfies both the membership
    // lookup (`.select(...).from(...).where(...).limit(...)`) and the
    // organizations lookup via the `liveOrganizations` helper
    // (`.select(...).from(...).where(...)` — awaited directly, no
    // `.limit()`).
    return {
      from: () => ({
        where: () => {
          const promise = Promise.resolve(rows[table]);
          return Object.assign(promise, {
            limit: () => Promise.resolve(rows[table]),
          });
        },
      }),
    };
  }

  return {
    // boundary: BA Drizzle adapter generic — the hook uses the narrow
    // `select(...).from(...).where(...)[.limit(...)]` chain, so a stub
    // matching that shape is sufficient.
    select: (input: Record<string, unknown>) => {
      const keys = Object.keys(input);
      // Heuristic: "suspendedAt" is unique to the organizations select, "role"
      // is unique to the members select. We match on field presence so the
      // stub mirrors the real query order.
      if (keys.includes("suspendedAt")) {
        return buildSelect("organizations");
      }
      if (keys.includes("role")) {
        return buildSelect("members");
      }
      return buildSelect("organizations");
    },
  } as unknown as DrizzleClient;
}

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

describe("enforceTenantMembership", () => {
  it("is a no-op when tenant is null (apex)", async () => {
    const db = makeStubDb({ organizations: [], members: [] });
    const result = await enforceTenantMembership(db, null, { userId: "u1" });
    expect(result).toBeNull();
  });

  it("throws FORBIDDEN when no membership row exists for the tenant", async () => {
    const db = makeStubDb({
      organizations: [{ id: "org_acme", suspendedAt: null, sessionVersion: 0 }],
      members: [],
    });
    await expect(
      enforceTenantMembership(db, subdomainTenant, { userId: "u1" })
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
  });

  it("throws FORBIDDEN when the tenant is suspended", async () => {
    const db = makeStubDb({
      organizations: [
        {
          id: "org_acme",
          suspendedAt: new Date("2026-01-01T00:00:00Z"),
          sessionVersion: 5,
        },
      ],
      members: [{ role: "owner" }],
    });
    await expect(
      enforceTenantMembership(db, subdomainTenant, { userId: "u1" })
    ).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
  });

  it("returns activeOrgId/role and copies tenant org claim onto fields", async () => {
    const db = makeStubDb({
      organizations: [{ id: "org_acme", suspendedAt: null, sessionVersion: 4 }],
      members: [{ role: "tenant_admin" }],
    });
    const result = await enforceTenantMembership(db, subdomainTenant, {
      userId: "u1",
    });
    expect(result).toEqual({
      activeOrganizationId: "org_acme",
      activeOrgRole: "tenant_admin",
      tenantOrgId: "org_acme",
      tenantHost: "acme.app.example.com",
      tenantSessionVersion: 4,
    });
  });

  it("throws FORBIDDEN when the tenant row vanishes (race)", async () => {
    const db = makeStubDb({
      organizations: [],
      members: [{ role: "tenant_admin" }],
    });
    await expect(
      enforceTenantMembership(db, subdomainTenant, { userId: "u1" })
    ).rejects.toBeInstanceOf(APIError);
  });
});
