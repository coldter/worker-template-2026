import { SYSTEM_ROLES } from "@repo/shared/roles";
import type { User } from "better-auth";
import { z } from "zod";

import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";

export const createUserCreateBeforeHook = () => (user: User) => {
  const email = z.string().safeParse(user.email);

  return Promise.resolve({
    data: {
      ...user,
      email: email.success ? email.data.trim().toLowerCase() : user.email,
      failedLoginAttempts: 0,
      roleSlugs: [SYSTEM_ROLES.USER.slug],
      status: "active" as const,
      twoFactorEnabled: false,
    },
  });
};

export const createUserCreateAfterHook =
  (env: AuthBindings, ctx: MinimalExecutionContext) =>
  (user: User): Promise<void> => {
    ctx.waitUntil(
      (async () => {
        try {
          await env.API.onUserCreated({
            email: user.email,
            id: user.id,
            name: user.name,
          });
        } catch (error) {
          console.error("Failed to trigger onboarding workflow:", error);
        }
      })()
    );

    return Promise.resolve();
  };
