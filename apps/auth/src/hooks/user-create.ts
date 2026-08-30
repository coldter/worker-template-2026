import { SYSTEM_ROLES } from "@repo/shared/roles";
import type { User } from "better-auth";
import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";

export function createUserCreateBeforeHook() {
  return async (user: User & Record<string, unknown>) => ({
    data: {
      ...user,
      failedLoginAttempts: 0,
      roleSlugs: [SYSTEM_ROLES.USER.slug],
      status: "active" as const,
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
        email: user.email,
        id: user.id,
        name: user.name,
      }).catch((err: unknown) => {
        console.error("Failed to trigger onboarding workflow:", err);
      })
    );
  };
}
