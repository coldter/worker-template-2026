import { z } from "@hono/zod-openapi";
import {
  type AuthorizedClaims,
  createRemoteJwksResolver,
  verifyTenantJwt as defaultVerifyTenantJwt,
  type JWKSResolver,
  type VerifyError,
  type VerifyOpts,
} from "@repo/auth-tokens";
import type { DrizzleClient } from "@repo/db";
import { createMiddleware } from "hono/factory";
import type { AppEnv, AuthSession, AuthUser } from "@/lib/context";

/**
 * Zod schema for validating the AUTH RPC `getSession` return shape at the
 * cross-worker boundary. Better Auth's vendor SDK types are intentionally
 * loose (`Record<string, unknown>`); we narrow the runtime shape here so the
 * downstream context vars carry validated data rather than untyped blobs.
 */
const rpcSessionSchema = z
  .object({
    user: z.record(z.string(), z.unknown()).nullable().optional(),
    session: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .nullable();

const BEARER_PREFIX = "Bearer ";

/**
 * Per-isolate cache for the JWKS resolver. Each worker isolate boots once
 * with the auth worker's JWKS URL and reuses the resolver across requests.
 */
let cachedJwksResolver: JWKSResolver | null = null;
let cachedJwksKey: string | null = null;

function getJwksResolver(jwksUrl: string): JWKSResolver {
  if (cachedJwksResolver && cachedJwksKey === jwksUrl) {
    return cachedJwksResolver;
  }
  cachedJwksResolver = createRemoteJwksResolver(new URL(jwksUrl));
  cachedJwksKey = jwksUrl;
  return cachedJwksResolver;
}

function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("Authorization");
  if (!auth?.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = auth.slice(BEARER_PREFIX.length).trim();
  return token === "" ? null : token;
}

function isVerifyError(
  value: AuthorizedClaims | VerifyError
): value is VerifyError {
  return "kind" in value && typeof (value as VerifyError).kind === "string";
}

/**
 * Map verified JWT claims to the (AuthUser, AuthSession) tuple stored in
 * `c.var.user` and `c.var.session`. The AUTH RPC path produces the same
 * shapes from Better Auth's session row.
 */
function claimsToContext(
  claims: AuthorizedClaims,
  tenant: { organizationId: string } | null
): { user: AuthUser; session: AuthSession } {
  // boundary: the auth-tokens claim shape is the canonical contract; we
  // adapt it to the AuthorizationUserInput / AuthorizationSessionInput
  // structural aliases used downstream.
  const user = {
    id: claims.sub,
    email: claims.email,
    roleSlugs: claims.roleSlugs,
  } as unknown as AuthUser;
  const session = {
    id: claims.sub,
    activeOrganizationId: tenant?.organizationId ?? claims.org.id,
    platform: claims.platform,
  } as unknown as AuthSession;
  return { user, session };
}

export const authContextMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const tenant = c.var.tenant ?? null;

    const bearer = extractBearerToken(c.req.raw.headers);
    const jwksUrl = c.env.AUTH_JWKS_URL;

    // Stateless fast path: if a bearer token is present and we have JWKS
    // configured + a resolved tenant, attempt local verification before
    // falling back to the cross-worker AUTH RPC. Verification failures with
    // `expired` fall through to the RPC path so the auth worker can perform
    // refresh-token rotation; signature failures short-circuit (auth fail).
    if (bearer && jwksUrl && tenant) {
      const resolver = getJwksResolver(jwksUrl);
      const verifyOpts: VerifyOpts & { db: DrizzleClient } = {
        expectedHost: tenant.host,
        expectedOrgId: tenant.organizationId,
        jwks: resolver,
        db: c.var.db,
      };
      const result = await verifyIncomingTenantJwt(bearer, verifyOpts);
      if (!isVerifyError(result)) {
        const { user, session } = claimsToContext(result, tenant);
        c.set("user", user);
        c.set("session", session);
        await next();
        return;
      }
      // bad_signature / wrong_aud / wrong_iss / wrong_org / wrong_host /
      // stale_session / malformed_claims => do not fall through to RPC; the
      // bearer is invalid for this tenant so treat as anonymous.
      // `expired` falls through so the RPC path can refresh.
      if (result.kind !== "expired") {
        c.set("user", null);
        c.set("session", null);
        await next();
        return;
      }
    }

    const sessionResult = await c.env.AUTH.getSession(
      c.req.raw.headers,
      tenant
    );
    const parsed = rpcSessionSchema.safeParse(sessionResult);
    if (!parsed.success || parsed.data === null) {
      c.set("user", null);
      c.set("session", null);
      await next();
      return;
    }
    // boundary: vendor-SDK generic variance — AUTH RPC returns a plain object
    // shape validated above; the server treats the session fields as
    // AuthUser/AuthSession aliases (Better Auth Session generics).
    c.set("user", (parsed.data.user ?? null) as unknown as AuthUser | null);
    c.set(
      "session",
      (parsed.data.session ?? null) as unknown as AuthSession | null
    );
    await next();
  }
);

/**
 * Thin delegate around `@repo/auth-tokens.verifyTenantJwt`. Exposed as a
 * module-level export so contract tests can swap the verifier without
 * round-tripping through the auth worker. Production call sites (incoming
 * tenant JWTs from edge clients) pass the resolved tenant's host + orgId
 * plus the request-scoped Drizzle client.
 */
export type IncomingTenantJwtOpts = VerifyOpts & { db: DrizzleClient };
export type IncomingTenantJwtVerifier = typeof defaultVerifyTenantJwt;

export function verifyIncomingTenantJwt(
  token: string,
  opts: IncomingTenantJwtOpts,
  verify: IncomingTenantJwtVerifier = defaultVerifyTenantJwt
): Promise<AuthorizedClaims | VerifyError> {
  return verify(token, opts);
}
