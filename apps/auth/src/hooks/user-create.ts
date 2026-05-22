import { SYSTEM_ROLES } from "@repo/shared/roles";
import type { User } from "better-auth";
import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";

export function createUserCreateBeforeHook() {
  return async (user: User & Record<string, unknown>) => ({
    data: {
      ...user,
      roleSlugs: [SYSTEM_ROLES.USER.slug],
      status: "active" as const,
      failedLoginAttempts: 0,
      twoFactorEnabled: false,
    },
  });
}

export function createUserCreateAfterHook(
  env: AuthBindings,
  ctx: MinimalExecutionContext
) {
  return async (user: User & Record<string, unknown>): Promise<void> => {
    ctx.waitUntil(
      env.API.onUserCreated({
        id: user.id,
        email: user.email,
        name: user.name,
      }).catch((err: unknown) => {
        console.error("Failed to trigger onboarding workflow:", err);
      })
    );
  };
}
