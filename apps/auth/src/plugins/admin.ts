import { AuthorizationError, type Principal } from "@repo/authorization";
import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import {
  authorization,
  buildAuthorizationPrincipal,
  toBaseAuthorizationPrincipal,
} from "@repo/shared/authorization";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

type UserId = string;
type ManageUserStatusAction = "activate" | "deactivate" | "unlock";

type AuthSessionUser = {
  email?: string;
  emailVerified?: boolean;
  id: string;
  roleSlugs?: string[];
  status?: string;
};

/** Minimal interface for the API service binding to avoid circular dependency */
type ApiBinding = {
  onUserStatusChange(params: {
    userId: string;
    newStatus: string;
    previousStatus: string;
    reason: string | null;
  }): Promise<void>;
};

function getAuthorizationActor(user: AuthSessionUser) {
  return {
    id: user.id,
    roleSlugs: user.roleSlugs ?? [],
    status: user.status,
    email: user.email,
    emailVerified: user.emailVerified,
  };
}

async function assertCanManageUserStatusWithApiError(
  actor: AuthSessionUser,
  action: ManageUserStatusAction,
  targetUserId: string
) {
  try {
    await assertCanManageUserStatus(actor, action, targetUserId);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw new APIError("FORBIDDEN", { message: "Permission denied" });
    }
    throw error;
  }
}

/**
 * Admin Plugin
 *
 * Provides endpoints for user management:
 * - Deactivate user (admin sets user to inactive)
 * - Activate user (admin reactivates a user)
 * - Unlock user (admin unlocks a locked user)
 */
export const adminPlugin = (db: DrizzleClient, apiBinding: ApiBinding) => {
  return {
    id: "admin",
    endpoints: {
      /**
       * Deactivate a user - sets status to "inactive"
       * Revokes all user sessions
       */
      deactivateUser: createAuthEndpoint(
        "/admin/deactivate-user",
        {
          method: "POST",
          use: [sessionMiddleware],
          body: z.object({
            userId: z.string().min(1),
            reason: z.string().optional(),
          }),
          metadata: {
            openapi: {
              operationId: "deactivateUser",
              summary: "Deactivate a user",
              description:
                "Sets user status to inactive and revokes all sessions",
              responses: {
                200: {
                  description: "User deactivated successfully",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          const currentUser = ctx.context.session.user as AuthSessionUser;

          await assertCanManageUserStatusWithApiError(
            currentUser,
            "deactivate",
            ctx.body.userId
          );

          if (ctx.body.userId === currentUser.id) {
            throw new APIError("BAD_REQUEST", {
              message: "Cannot deactivate yourself",
            });
          }

          const targetUser = await db.query.users.findFirst({
            where: { id: { eq: ctx.body.userId as UserId } },
          });

          if (!targetUser) {
            throw new APIError("NOT_FOUND", { message: "User not found" });
          }

          await db
            .update(schema.users)
            .set({
              status: "inactive",
              deactivatedAt: new Date(),
              deactivatedBy: currentUser.id,
              deactivatedReason: ctx.body.reason ?? null,
            })
            .where(eq(schema.users.id, ctx.body.userId));

          await db
            .delete(schema.sessions)
            .where(eq(schema.sessions.userId, ctx.body.userId));

          await apiBinding.onUserStatusChange({
            userId: ctx.body.userId,
            newStatus: "inactive",
            previousStatus: targetUser.status,
            reason: ctx.body.reason ?? "admin_deactivated",
          });

          return ctx.json({ success: true });
        }
      ),

      /**
       * Activate a user - sets status back to "active"
       * Clears deactivation fields
       */
      activateUser: createAuthEndpoint(
        "/admin/activate-user",
        {
          method: "POST",
          use: [sessionMiddleware],
          body: z.object({
            userId: z.string().min(1),
          }),
          metadata: {
            openapi: {
              operationId: "activateUser",
              summary: "Activate a user",
              description:
                "Sets user status to active and clears deactivation info",
              responses: {
                200: {
                  description: "User activated successfully",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          const currentUser = ctx.context.session.user as AuthSessionUser;

          await assertCanManageUserStatusWithApiError(
            currentUser,
            "activate",
            ctx.body.userId
          );

          const targetUser = await db.query.users.findFirst({
            where: { id: { eq: ctx.body.userId as UserId } },
          });

          if (!targetUser) {
            throw new APIError("NOT_FOUND", { message: "User not found" });
          }

          await db
            .update(schema.users)
            .set({
              status: "active",
              deactivatedAt: null,
              deactivatedBy: null,
              deactivatedReason: null,
            })
            .where(eq(schema.users.id, ctx.body.userId));

          await apiBinding.onUserStatusChange({
            userId: ctx.body.userId,
            newStatus: "active",
            previousStatus: targetUser.status,
            reason: null,
          });

          return ctx.json({ success: true });
        }
      ),

      /**
       * Unlock a user - resets lockout status
       * Clears failed login attempts and lockedUntil
       */
      unlockUser: createAuthEndpoint(
        "/admin/unlock-user",
        {
          method: "POST",
          use: [sessionMiddleware],
          body: z.object({
            userId: z.string().min(1),
          }),
          metadata: {
            openapi: {
              operationId: "unlockUser",
              summary: "Unlock a user",
              description: "Resets lockout status and failed login attempts",
              responses: {
                200: {
                  description: "User unlocked successfully",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          success: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          const currentUser = ctx.context.session.user as AuthSessionUser;

          await assertCanManageUserStatusWithApiError(
            currentUser,
            "unlock",
            ctx.body.userId
          );

          const targetUser = await db.query.users.findFirst({
            where: { id: { eq: ctx.body.userId as UserId } },
          });

          if (!targetUser) {
            throw new APIError("NOT_FOUND", { message: "User not found" });
          }

          await db
            .update(schema.users)
            .set({
              status: "active",
              lockedUntil: null,
              failedLoginAttempts: 0,
            })
            .where(eq(schema.users.id, ctx.body.userId));

          return ctx.json({ success: true });
        }
      ),
    },
  } satisfies BetterAuthPlugin;
};

export async function assertCanManageUserStatus(
  actor: AuthSessionUser,
  action: ManageUserStatusAction,
  targetUserId: string
) {
  const principal = buildAuthorizationPrincipal(getAuthorizationActor(actor));
  const basePrincipal: Principal = toBaseAuthorizationPrincipal(principal);

  await authorization.assertCan(basePrincipal, "user", action, {
    resource: { id: targetUserId },
  });
}
