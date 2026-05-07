import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet } from "jose";
import type { AdminEnv } from "@/env";
import { authFailureToResponse } from "@/lib/auth-failure";
import {
  authenticateOperator,
  authenticateOperatorByEmail,
} from "@/middlewares/authenticate-operator";
import { JwksCache, type RemoteJwks } from "@/middlewares/jwks-cache";

const TRAILING_SLASH_RE = /\/$/;

const jwksCacheByTeam = new Map<string, JwksCache<RemoteJwks>>();

function jwksFor(teamDomain: string): JwksCache<RemoteJwks> {
  const existing = jwksCacheByTeam.get(teamDomain);
  if (existing) {
    return existing;
  }
  const created = new JwksCache<RemoteJwks>(async () =>
    createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
  );
  jwksCacheByTeam.set(teamDomain, created);
  return created;
}

/**
 * D52 / D38 — admin-perimeter middleware. Thin wrapper around
 * `authenticateOperator` (production CF Access path) and
 * `authenticateOperatorByEmail` (dev-mode email-resolution path). Both routes
 * funnel through the same finalize step inside `authenticate-operator.ts` so
 * `c.var.globalAdmin` is populated by exactly one code path. JWKS-cache
 * acquisition and `AuthFailure -> Response` mapping live here.
 */
export const cfAccessMiddleware = createMiddleware<AdminEnv>(
  async (c, next) => {
    if (
      c.env.NODE_ENV === "development" &&
      c.env.ALLOW_DEV_ADMIN_AUTH === "true" &&
      c.env.LOCAL_DEV_ADMIN_EMAIL
    ) {
      const email = c.env.LOCAL_DEV_ADMIN_EMAIL.toLowerCase().trim();
      const result = await authenticateOperatorByEmail(c, {
        db: c.var.db,
        email,
      });
      if (!result.ok) {
        return authFailureToResponse(result.failure);
      }
      c.set("accessIdentity", {
        sub: result.admin.cfAccessSub ?? `local-dev-${email}`,
        email: result.admin.email,
      });
      c.set("globalAdmin", result.admin);
      return await next();
    }
    if (c.env.NODE_ENV !== "development" && c.env.LOCAL_DEV_ADMIN_EMAIL) {
      return authFailureToResponse({ kind: "misconfigured" });
    }

    const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN.replace(
      TRAILING_SLASH_RE,
      ""
    );
    const result = await authenticateOperator(c, {
      jwks: jwksFor(teamDomain),
      db: c.var.db,
    });
    if (!result.ok) {
      return authFailureToResponse(result.failure);
    }

    c.set("accessIdentity", {
      sub: result.admin.cfAccessSub ?? "",
      email: result.admin.email,
    });
    c.set("globalAdmin", result.admin);
    return await next();
  }
);
