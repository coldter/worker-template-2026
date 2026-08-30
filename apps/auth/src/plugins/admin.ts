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
    email: user.email,
    emailVerified: user.emailVerified,
    id: user.id,
    roleSlugs: user.roleSlugs ?? [],
    status: user.status,
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
      throw new APIError("FORBIDDEN", {
        cause: error,
        message: "Permission denied",
      });
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

export const adminPlugin = (apiBinding: ApiBindingRpc) => {
  return {
    endpoints: {
      activateUser: createAuthEndpoint(
        "/admin/activate-user",
        {
          body: z.object({
            userId: z.string().min(1),
          }),
          metadata: {
            openapi: {
              description:
                "Sets user status to active and clears deactivation info",
              operationId: "activateUser",
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          success: { type: "boolean" },
                        },
                        type: "object",
                      },
                    },
                  },
                  description: "User activated successfully",
                },
              },
              summary: "Activate a user",
            },
          },
          method: "POST",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          // boundary: better-auth plugin endpoint ctx lacks $Infer narrowing for user-status additional fields.
          const currentUser = ctx.context.session.user as AuthSessionUser;

          await assertCanManageUserStatusWithApiError(
            currentUser,
            "activate",
            ctx.body.userId
          );

          const result = await apiBinding.adminActivateUser({
            actorId: currentUser.id,
            userId: ctx.body.userId,
          });
          assertStatusMutationResult(result);

          return ctx.json({ success: true });
        }
      ),
      deactivateUser: createAuthEndpoint(
        "/admin/deactivate-user",
        {
          body: z.object({
            reason: z.string().optional(),
            userId: z.string().min(1),
          }),
          metadata: {
            openapi: {
              description:
                "Sets user status to inactive and revokes all sessions",
              operationId: "deactivateUser",
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          success: { type: "boolean" },
                        },
                        type: "object",
                      },
                    },
                  },
                  description: "User deactivated successfully",
                },
              },
              summary: "Deactivate a user",
            },
          },
          method: "POST",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          // boundary: better-auth plugin endpoint ctx lacks $Infer narrowing for user-status additional fields.
          const currentUser = ctx.context.session.user as AuthSessionUser;

          await assertCanManageUserStatusWithApiError(
            currentUser,
            "deactivate",
            ctx.body.userId
          );

          const result = await apiBinding.adminDeactivateUser({
            actorId: currentUser.id,
            reason: ctx.body.reason ?? null,
            userId: ctx.body.userId,
          });
          assertStatusMutationResult(result);

          return ctx.json({ success: true });
        }
      ),

      unlockUser: createAuthEndpoint(
        "/admin/unlock-user",
        {
          body: z.object({
            userId: z.string().min(1),
          }),
          metadata: {
            openapi: {
              description: "Resets lockout status and failed login attempts",
              operationId: "unlockUser",
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          success: { type: "boolean" },
                        },
                        type: "object",
                      },
                    },
                  },
                  description: "User unlocked successfully",
                },
              },
              summary: "Unlock a user",
            },
          },
          method: "POST",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          // boundary: better-auth plugin endpoint ctx lacks $Infer narrowing for user-status additional fields.
          const currentUser = ctx.context.session.user as AuthSessionUser;

          await assertCanManageUserStatusWithApiError(
            currentUser,
            "unlock",
            ctx.body.userId
          );

          const result = await apiBinding.adminUnlockUser({
            actorId: currentUser.id,
            userId: ctx.body.userId,
          });
          assertStatusMutationResult(result);

          return ctx.json({ success: true });
        }
      ),
    },
    id: "admin",
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
