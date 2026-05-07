// Hooks shape: BA 1.6+ uses [{ matcher, handler }] array for hooks.before.
// Runs BEFORE the IdP token exchange to prevent confused-deputy attacks where
// one tenant's IdP callback URL is replayed at another tenant's endpoint.
import type { DrizzleClient } from "@repo/db";
import type { Tenant } from "@repo/tenancy";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

const CALLBACK_PREFIX = "/sso/callback/";

export function ssoCallbackGuardPlugin(
  db: DrizzleClient,
  tenant: Tenant | null
): BetterAuthPlugin {
  return {
    id: "sso-callback-guard",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            typeof ctx.path === "string" &&
            ctx.path.startsWith(CALLBACK_PREFIX),
          handler: createAuthMiddleware(async (ctx) => {
            if (!tenant) {
              throw new APIError("FORBIDDEN", {
                message: "Tenant required for SSO callback",
              });
            }

            const providerId =
              typeof ctx.path === "string"
                ? ctx.path.slice(CALLBACK_PREFIX.length)
                : undefined;

            if (!providerId) {
              throw new APIError("FORBIDDEN", {
                message: "Provider does not belong to this tenant",
              });
            }

            const provider = await db.query.ssoProviders.findFirst({
              where: { providerId: { eq: providerId } },
              columns: { organizationId: true },
            });

            if (
              !provider ||
              provider.organizationId !== tenant.organizationId
            ) {
              throw new APIError("FORBIDDEN", {
                message: "Provider does not belong to this tenant",
              });
            }
          }),
        },
      ],
    },
  };
}
