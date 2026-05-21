import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

// Organizations are created via direct Drizzle insert by the admin worker.
// No BA endpoint should ever be able to create an organization.

export function disableOrgCreate(): BetterAuthPlugin {
  return {
    id: "disable-org-create",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/organization/create",
          handler: createAuthMiddleware(async () => {
            throw new APIError("FORBIDDEN", {
              message: "Organization creation is disabled",
            });
          }),
        },
      ],
    },
  };
}
