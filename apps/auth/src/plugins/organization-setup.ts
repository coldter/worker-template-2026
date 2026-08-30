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
    cancelPendingInvitationsOnReInvite: true,
    creatorRole: "owner",

    invitationExpiresIn: 172_800,
    membershipLimit: 100,
    organizationLimit: 5,

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
            meta: {
              organizationId: member.organizationId,
              userId: member.userId,
            },
            reason:
              "Skipping session cleanup after member removal: org tables missing",
          }
        );
      },

      afterUpdateMemberRole: async ({ member }) => {
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
            meta: {
              organizationId: member.organizationId,
              userId: member.userId,
            },
            reason:
              "Skipping session role sync after member role change: org tables missing",
          }
        );
      },
    },
  });
}
