import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import type { User } from "better-auth";
import type { Invitation, Member, Organization } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { tolerateMissingOrgTables } from "../lib/org-tables";

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
      afterRemoveMember: async ({ member }) => {
        await tolerateMissingOrgTables(
          () =>
            db
              .delete(schema.sessions)
              .where(
                and(
                  eq(schema.sessions.userId, member.userId),
                  eq(
                    schema.sessions.activeOrganizationId,
                    member.organizationId
                  )
                )
              ),
          {
            reason:
              "Skipping session cleanup after member removal: org tables missing",
            meta: {
              userId: member.userId,
              organizationId: member.organizationId,
            },
          }
        );
      },

      afterUpdateMemberRole: async ({ member }) => {
        // Sync existing sessions in place rather than invalidating; keeps users signed in while updating their cached org role.
        await tolerateMissingOrgTables(
          () =>
            db
              .update(schema.sessions)
              .set({ activeOrgRole: member.role })
              .where(
                and(
                  eq(schema.sessions.userId, member.userId),
                  eq(
                    schema.sessions.activeOrganizationId,
                    member.organizationId
                  )
                )
              ),
          {
            reason:
              "Skipping session role sync after member role change: org tables missing",
            meta: {
              userId: member.userId,
              organizationId: member.organizationId,
            },
          }
        );
      },
    },
  });
}
