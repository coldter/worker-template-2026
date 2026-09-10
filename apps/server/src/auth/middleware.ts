import type { Principal } from "@repo/authorization";
import {
  createAuthorize,
  getAuthorizedResource,
} from "@repo/authorization/hono";
import { buildAuthorizationPrincipal } from "@repo/shared/authorization";
import type { Context } from "hono";
import type { AppEnv } from "@/lib/context";
import { authorization } from "./registry";

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
    ? buildAuthorizationPrincipal(user, c.get("session") ?? {})
    : null;

  c.set("principal", principal);
  return principal;
}

export const authorize = createAuthorize<
  typeof authorization.resources,
  AppEnv
>(authorization, { resolvePrincipal });

export { getAuthorizedResource };
