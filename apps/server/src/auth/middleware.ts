import type { Principal } from "@repo/authorization";
import {
  createAuthorize,
  getAuthorizedResource,
} from "@repo/authorization/hono";
import {
  buildAuthorizationPrincipal,
  toBaseAuthorizationPrincipal,
} from "@repo/shared/authorization";
import type { Context } from "hono";
import type { AppEnv } from "@/lib/context";
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
  const cached = c.get("principal");
  if (cached !== undefined) {
    return cached;
  }

  const user = c.get("user");
  const principal = user
    ? toBaseAuthorizationPrincipal(
        buildAuthorizationPrincipal(user, c.get("session") ?? {})
      )
    : null;

  c.set("principal", principal);
  return principal;
}

function resolveDb(c: Context<AppEnv>) {
  return c.var.db;
}

export const authorize = createAuthorize<
  typeof authorization.resources,
  AppEnv
>(authorization, { resolvePrincipal, resolveDb });

export { getAuthorizedResource };
