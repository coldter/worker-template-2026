/**
 * Defense-in-depth guard for `session.update.before`.
 *
 * `session.create.before` already pins `activeOrganizationId` to the host's
 * tenant. This hook rejects any later attempt to switch to a different org
 * via `setActive` while the host is pinned. Without this guard, a malicious
 * client on tenant A's host could `setActive({ activeOrganizationId: B })`
 * and continue to operate against tenant B's data through the session.
 */
import type { Tenant } from "@repo/tenancy";
import { APIError } from "better-auth/api";

export function assertSameTenantOnUpdate(
  tenant: Tenant | null,
  updateData: Record<string, unknown>
): void {
  if (!tenant) {
    return;
  }
  if (!Object.hasOwn(updateData, "activeOrganizationId")) {
    return;
  }
  const next = updateData.activeOrganizationId;
  if (next === null || next === undefined) {
    return;
  }
  if (next !== tenant.organizationId) {
    throw new APIError("FORBIDDEN", {
      message: "Cannot switch tenant via setActive",
    });
  }
}
