import { AuthorizationError, type Principal } from "@repo/authorization";
import type {
  ApiBindingRpc,
  StatusMutationResult,
} from "@repo/shared/api-binding";
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
import { z } from "zod";

type ManageUserStatusAction = "activate" | "deactivate" | "unlock";

type AuthSessionUser = {
  email?: string;
  emailVerified?: boolean;
  id: string;
  roleSlugs?: string[];
  status?: string;
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

function assertStatusMutationResult(result: StatusMutationResult): void {
  if (result.success) {
    return;
  }

  if (result.reason === "not_found") {
    throw new APIError("NOT_FOUND", { message: "User not found" });
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
export const adminPlugin = (apiBinding: ApiBindingRpc) => {
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

          const result = await apiBinding.adminDeactivateUser({
            userId: ctx.body.userId,
            actorId: currentUser.id,
            reason: ctx.body.reason ?? null,
          });
          assertStatusMutationResult(result);

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

          const result = await apiBinding.adminActivateUser({
            userId: ctx.body.userId,
            actorId: currentUser.id,
          });
          assertStatusMutationResult(result);

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

          const result = await apiBinding.adminUnlockUser({
            userId: ctx.body.userId,
            actorId: currentUser.id,
          });
          assertStatusMutationResult(result);

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
