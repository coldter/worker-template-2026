/**
 * Tenant-aware database hook for `session.create.before` (D34, D32).
 *
 * Runs BEFORE BA mints the JWT so the org claim composer in `definePayload`
 * can read the per-session tenant fields without an extra DB query. The hook:
 *   - is a no-op for the apex / null-tenant case (the apex page has no tenant)
 *   - rejects sign-ins for tenants where `suspended_at IS NOT NULL`
 *   - rejects sign-ins for users who are not members of the resolved tenant
 *   - sets `activeOrganizationId` and `activeOrgRole` from the membership row
 *   - copies the resolved tenant fields onto the session so the JWT mint can
 *     stamp them as `org` without a re-query
 *
 * Defense in depth — `apps/server` also enforces suspension at the API
 * boundary (A6.6). This guards the auth boundary so a session minted while
 * suspension is mid-flight still trips here on the next attempt.
 */
import type { DrizzleClient } from "@repo/db";
import { liveOrganizations } from "@repo/db";
import * as schema from "@repo/db/schema";
import type { Tenant } from "@repo/tenancy";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

export type TenantSessionFields = {
  activeOrganizationId: string;
  activeOrgRole: string;
  tenantOrgId: string;
  tenantHost: string;
  tenantSessionVersion: number;
};

type SessionInput = { userId: string } & Record<string, unknown>;

export async function enforceTenantMembership(
  db: DrizzleClient,
  tenant: Tenant | null,
  session: SessionInput
): Promise<TenantSessionFields | null> {
  if (!tenant) {
    return null;
  }

  // Read the org row to assert it is not suspended. This is a defense-in-
  // depth check on top of the API-side gate; using `liveOrganizations`
  // also filters out soft-deleted tenants — a row that was deleted between
  // resolver and hook surfaces as `org === undefined` and is rejected.
  const [org] = await liveOrganizations(db).selectById(
    {
      id: schema.organizations.id,
      suspendedAt: schema.organizations.suspendedAt,
      sessionVersion: schema.organizations.sessionVersion,
    },
    tenant.organizationId
  );

  if (!org) {
    throw new APIError("FORBIDDEN", { message: "Tenant not found" });
  }
  if (org.suspendedAt) {
    throw new APIError("FORBIDDEN", { message: "Tenant is suspended" });
  }

  const [member] = await db
    .select({
      role: schema.members.role,
    })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.userId, session.userId),
        eq(schema.members.organizationId, tenant.organizationId)
      )
    )
    .limit(1);

  if (!member) {
    throw new APIError("FORBIDDEN", {
      message: "No membership in this tenant",
    });
  }

  return {
    activeOrganizationId: tenant.organizationId,
    activeOrgRole: member.role,
    tenantOrgId: tenant.organizationId,
    tenantHost: tenant.host,
    tenantSessionVersion: org.sessionVersion,
  };
}
