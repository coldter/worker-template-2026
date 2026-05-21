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
  const user = c.get("user");
  if (!user) {
    return null;
  }
  return buildAuthorizationPrincipal(user, c.get("session") ?? {});
}

function resolveDb(c: Context<AppEnv>) {
  return c.var.db;
}

export const authorize = createAuthorize<
  typeof authorization.resources,
  AppEnv
>(authorization, { resolvePrincipal, resolveDb });

export { getAuthorizedResource };
