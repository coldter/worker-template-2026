import type { Principal } from "@repo/authorization";
import {
  createAuthorize,
  getAuthorizedResource,
} from "@repo/authorization/hono";
import type { Context } from "hono";
import type { AppEnv } from "@/lib/context";
import { buildPrincipal } from "./principal";
import { authorization } from "./registry";

/**
 * Extract a Principal from the Hono request context.
 * Exported so other code (e.g. capabilities route) can reuse the same logic
 * without duplicating the user/session field extraction.
 */
export function resolvePrincipalFromContext(
  c: Context<AppEnv>
): Principal | null {
  return resolvePrincipal(c);
}

function resolvePrincipal(c: Context<AppEnv>): Principal | null {
  const user = c.get("user");
  const session = c.get("session");
  if (!user) {
    return null;
  }
  const principal = buildPrincipal(
    {
      id: user.id,
      roleSlugs: (user as Record<string, unknown>).roleSlugs as
        | string[]
        | undefined,
      status: (user as Record<string, unknown>).status as string | undefined,
      email: (user as Record<string, unknown>).email as string | undefined,
      emailVerified: (user as Record<string, unknown>).emailVerified as
        | boolean
        | undefined,
    },
    {
      activeOrganizationId: session
        ? ((session as Record<string, unknown>).activeOrganizationId as
            | string
            | undefined)
        : undefined,
      activeOrgRole: session
        ? ((session as Record<string, unknown>).activeOrgRole as
            | string
            | undefined)
        : undefined,
    }
  );
  // The generic Principal type uses never for TOrgRoles by default; cast is safe
  // because the runtime value satisfies the base Principal contract.
  return principal as unknown as Principal;
}

function resolveDb(c: Context<AppEnv>) {
  return c.var.db;
}

export const authorize = createAuthorize<
  typeof authorization.resources,
  AppEnv
>(authorization, { resolvePrincipal, resolveDb });

export { getAuthorizedResource };
