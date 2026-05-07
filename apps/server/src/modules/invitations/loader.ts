/**
 * Loads and guards a BA org-plugin invitation row before the accept flow
 * starts mutating user state. Rejects on:
 *   - missing row (404)
 *   - row scoped to a different tenant (404 — never leak existence)
 *   - non-pending status (already accepted / canceled)
 *   - expired
 *
 * The caller passes a `Drizzle`-shaped executor so this can run on the
 * surrounding transaction or a plain client.
 */
import type { DrizzleClient } from "@repo/db";
import { firstOrNull } from "@repo/db";
import { invitations } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

export type InvitationRow = typeof invitations.$inferSelect;

export type LoadInvitationOutcome =
  | { kind: "ok"; invitation: InvitationRow }
  | { kind: "not_found" }
  | { kind: "wrong_tenant" }
  | { kind: "not_pending"; status: string }
  | { kind: "expired" };

export async function loadAndGuardInvitation(
  invitationId: string,
  organizationId: string,
  db: Pick<DrizzleClient, "select">
): Promise<LoadInvitationOutcome> {
  const inv = await firstOrNull(
    db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.organizationId, organizationId)
        )
      )
  );
  if (!inv) {
    // Whether the row is missing entirely or belongs to a different tenant we
    // return the same 404-equivalent — do not leak existence across tenants.
    return { kind: "not_found" };
  }
  if (inv.status !== "pending") {
    return { kind: "not_pending", status: inv.status };
  }
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
    return { kind: "expired" };
  }
  return { kind: "ok", invitation: inv };
}
