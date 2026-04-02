import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import type { User } from "better-auth";
import type { Invitation, Member, Organization } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";

/**
 * Configures Better Auth's organization plugin with access control roles
 * and session enrichment for multi-tenancy.
 *
 * This plugin is opt-in. When added to the plugins array, it enables:
 * - Organization CRUD endpoints
 * - Member management (invite, add, remove, update roles)
 * - Invitation system with email notifications
 * - Session-level org context (activeOrganizationId, activeOrgRole)
 *
 * Session enrichment:
 * - On login: if user has org memberships, set first org as active
 * - On org switch (setActive): update activeOrgRole to match membership
 * - On member removal: invalidate sessions with that org active
 * - On role change: update activeOrgRole on affected sessions
 */
export function createOrganizationPlugin(
  db: DrizzleClient,
  sendInvitationEmailFn?: (
    data: {
      id: string;
      role: string;
      email: string;
      organization: Organization;
      invitation: Invitation;
      inviter: Member & { user: User };
    },
    request?: Request
  ) => Promise<void>
) {
  return organization({
    allowUserToCreateOrganization: false,
    organizationLimit: 5,
    creatorRole: "owner",
    membershipLimit: 100,

    // Invitation configuration
    invitationExpiresIn: 172_800, // 48 hours in seconds
    cancelPendingInvitationsOnReInvite: true,

    // Email sending (optional -- no-op if not configured)
    ...(sendInvitationEmailFn
      ? { sendInvitationEmail: sendInvitationEmailFn }
      : {}),

    // Lifecycle hooks for session consistency
    organizationHooks: {
      // When a member is removed, delete any sessions that have
      // that organization set as active. This prevents the removed
      // user from continuing to act under the old org context.
      afterRemoveMember: async ({ member }) => {
        try {
          await db
            .delete(schema.sessions)
            .where(
              and(
                eq(schema.sessions.userId, member.userId),
                eq(schema.sessions.activeOrganizationId, member.organizationId)
              )
            );
        } catch (err) {
          // Gracefully handle missing org columns during migration
          logger.error("Error removing sessions after member removal:", {
            error: err,
          });
        }
      },

      // When a member's role changes, update activeOrgRole on any
      // session that currently has that organization active. This
      // keeps the cached role in sync without requiring a full
      // session invalidation.
      afterUpdateMemberRole: async ({ member }) => {
        try {
          await db
            .update(schema.sessions)
            .set({ activeOrgRole: member.role })
            .where(
              and(
                eq(schema.sessions.userId, member.userId),
                eq(schema.sessions.activeOrganizationId, member.organizationId)
              )
            );
        } catch (err) {
          // Gracefully handle missing org columns during migration
          logger.error("Error updating sessions after member role change:", {
            error: err,
          });
        }
      },
    },
  });
}
