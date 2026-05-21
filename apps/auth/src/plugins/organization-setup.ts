import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import type { User } from "better-auth";
import type { Invitation, Member, Organization } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";

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

    invitationExpiresIn: 172_800,
    cancelPendingInvitationsOnReInvite: true,

    ...(sendInvitationEmailFn
      ? { sendInvitationEmail: sendInvitationEmailFn }
      : {}),

    organizationHooks: {
      // Delete sessions with the removed member's org set as active so the
      // removed user cannot continue to act under the old org context.
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
          // Tolerate missing org columns during migration.
          logger.error("Error removing sessions after member removal:", {
            error: err,
          });
        }
      },

      // Update activeOrgRole on any session that has the org active so the
      // cached role stays in sync without a full session invalidation.
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
          // Tolerate missing org columns during migration.
          logger.error("Error updating sessions after member role change:", {
            error: err,
          });
        }
      },
    },
  });
}
