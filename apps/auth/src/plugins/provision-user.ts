// provisionUser runs AFTER IdP token exchange. The earlier-fail gate is
// ssoCallbackGuardPlugin, which validates the tenant binding before the token
// exchange occurs.

import type { SSOOptions, SSOProvider } from "@better-auth/sso";
import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import type { Tenant } from "@repo/tenancy";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

type ProvisionUserArgs = NonNullable<
  Parameters<NonNullable<SSOOptions["provisionUser"]>>[0]
>;

export function provisionUserCallback(
  db: DrizzleClient,
  _tenant: Tenant | null
): NonNullable<SSOOptions["provisionUser"]> {
  return async ({ user, userInfo, provider }: ProvisionUserArgs) => {
    if (!userInfo.email_verified) {
      throw new APIError("FORBIDDEN", { message: "Email not verified by IdP" });
    }

    const typedProvider = provider as SSOProvider<SSOOptions>;
    const orgId =
      "organizationId" in typedProvider
        ? (typedProvider.organizationId as string | undefined)
        : undefined;
    if (!orgId) {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "SSO provider missing org",
      });
    }

    const domainVerified =
      "domainVerified" in typedProvider
        ? (typedProvider.domainVerified as boolean)
        : false;
    if (!domainVerified) {
      throw new APIError("FORBIDDEN", { message: "SSO domain not verified" });
    }

    // If an existing user has the same email, they must be a member of the
    // provider's org. Without this check, an attacker could claim an account
    // via SSO if they control an IdP that asserts an existing user's email.
    const email = userInfo.email as string | undefined;
    if (email) {
      const existingUser = await db.query.users.findFirst({
        where: { email: { eq: email } },
        columns: { id: true },
      });
      if (existingUser && existingUser.id !== user.id) {
        const [membership] = await db
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(
            and(
              eq(schema.members.userId, existingUser.id),
              eq(schema.members.organizationId, orgId)
            )
          )
          .limit(1);
        if (!membership) {
          throw new APIError("FORBIDDEN", {
            message: "Email belongs to a user without membership in this org",
          });
        }
      }
    }
  };
}
