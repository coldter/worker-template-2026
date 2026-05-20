import type { DrizzleClient } from "@repo/db";
import { type GlobalAdmin, globalAdmins } from "@repo/db/schema";
import { safeWaitUntil } from "@repo/shared/safe-wait-until";
import { and, eq, isNull, sql } from "drizzle-orm";
import { jwtVerify } from "jose";
import type { AuthFailure } from "@/lib/auth-failure";
import type { JwksCache } from "@/middlewares/jwks-cache";

const TRAILING_SLASH_RE = /\/$/;

export type AuthResult =
  | { ok: true; admin: GlobalAdmin }
  | { ok: false; failure: AuthFailure };

/**
 * Minimal context shape consumed by `authenticateOperator`. Mirrors the
 * runtime fields the function actually touches (request headers, env, and
 * `executionCtx.waitUntil`) so the function can be unit-tested without
 * spinning up Hono.
 */
export type AuthenticateOperatorContext = {
  req: { header(name: string): string | undefined };
  env: {
    CF_ACCESS_TEAM_DOMAIN: string;
    CF_ACCESS_AUD: string;
  };
  executionCtx: { waitUntil(p: Promise<unknown>): void };
};

export type AuthenticateOperatorDeps = {
  jwks: JwksCache;
  db: DrizzleClient;
};

/**
 * Shared post-resolution flow: gates deactivated rows and schedules a
 * fire-and-forget `lastActiveAt` ping. Used by both the production CF Access
 * path and the dev-mode email-resolution adapter so the deactivation gate
 * and ping behavior live in exactly one place.
 */
function finalizeAdmin(
  c: Pick<AuthenticateOperatorContext, "executionCtx">,
  db: DrizzleClient,
  admin: GlobalAdmin
): AuthResult {
  if (admin.deactivatedAt) {
    return { ok: false, failure: { kind: "deactivated" } };
  }

  const ping = Promise.resolve(
    db
      .update(globalAdmins)
      .set({ lastActiveAt: new Date() })
      .where(eq(globalAdmins.id, admin.id))
  );
  // Hono's `c.executionCtx` getter throws synchronously in tests with no ctx.
  let execCtx: AuthenticateOperatorContext["executionCtx"] | undefined;
  try {
    execCtx = c.executionCtx;
  } catch {
    execCtx = undefined;
  }
  safeWaitUntil(execCtx, ping);

  return { ok: true, admin };
}

/**
 * D52 — unified operator authentication. Verifies the Cloudflare Access JWT,
 * rejects service tokens (D19), looks up the `global_admins` row by `cfAccessSub`,
 * runs the enrollment-token claim flow (D31) on miss, gates deactivated rows,
 * and schedules a fire-and-forget `lastActiveAt` ping. Returns a discriminated
 * `AuthResult` so the caller (a Hono middleware) can map failures to HTTP
 * responses centrally.
 */
export async function authenticateOperator(
  c: AuthenticateOperatorContext,
  deps: AuthenticateOperatorDeps
): Promise<AuthResult> {
  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) {
    return { ok: false, failure: { kind: "missing_token" } };
  }

  const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN.replace(TRAILING_SLASH_RE, "");
  const keyset = await deps.jwks.get();

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, keyset, {
      issuer: teamDomain,
      audience: c.env.CF_ACCESS_AUD,
      clockTolerance: 60,
      // CF Access signs identity tokens with RS256 (per
      // https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/).
      // Pinning the algorithm prevents accidental acceptance of HS-signed
      // forgeries that would otherwise verify against a JWKS-derived key
      // material misuse.
      algorithms: ["RS256"],
    });
    deps.jwks.recordSuccess();
    // boundary: jose's JWTPayload has an open index signature; widen to a
    // record so we can narrow each claim explicitly below.
    payload = result.payload as unknown as Record<string, unknown>;
  } catch {
    deps.jwks.recordFailure();
    return { ok: false, failure: { kind: "invalid_token" } };
  }

  const subRaw = payload.sub;
  const emailRaw = payload.email;
  const cnRaw = payload.common_name;

  // Per CF Access docs (cloudflare-one/identity/authorization-cookie/
  // application-token), self-hosted application identity tokens are
  // user-tokens: they carry `email` and never `common_name`. Service
  // tokens carry `common_name` (the service-token name) and have no
  // `email`. We discriminate solely on `common_name` — the `type` claim
  // varies between deployments (e.g., "self-hosted" vs "saas") and was
  // an unreliable filter that would reject legitimate identity tokens.
  if (cnRaw) {
    return { ok: false, failure: { kind: "service_token_rejected" } };
  }
  if (typeof subRaw !== "string" || typeof emailRaw !== "string") {
    return { ok: false, failure: { kind: "service_token_rejected" } };
  }
  const sub = subRaw;
  const email = emailRaw.toLowerCase().trim();

  let admin: GlobalAdmin | null =
    (await deps.db.query.globalAdmins.findFirst({
      where: { cfAccessSub: { eq: sub } },
    })) ?? null;

  if (!admin) {
    const enrollmentToken = c.req.header("x-admin-enrollment-token");
    if (enrollmentToken) {
      const candidate = await deps.db.query.globalAdmins.findFirst({
        where: {
          enrollmentToken: { eq: enrollmentToken },
          enrollmentTokenExpiresAt: { gt: new Date() },
          cfAccessSub: { isNull: true },
        },
      });
      // Audit-fix #3 — case-insensitive email comparison. Both sides are
      // lowercased + trimmed so a legacy row inserted with mixed case still
      // matches the JWT-claimed `email` (which is normalized above). The
      // claim WHERE clause below is independently keyed on the candidate id
      // and `cfAccessSub IS NULL`, so case-folding here does not relax the
      // atomic-claim guarantee.
      if (candidate && candidate.email.toLowerCase().trim() === email) {
        const claimed = await deps.db
          .update(globalAdmins)
          .set({
            cfAccessSub: sub,
            enrollmentToken: null,
            enrollmentTokenExpiresAt: null,
            lastActiveAt: new Date(),
          })
          .where(
            and(
              eq(globalAdmins.id, candidate.id),
              isNull(globalAdmins.cfAccessSub),
              sql`lower(${globalAdmins.email}) = ${email}`
            )
          )
          .returning();
        if (claimed.length === 1) {
          admin = claimed[0] ?? null;
        }
      }
    }
  }

  if (!admin) {
    return { ok: false, failure: { kind: "enrollment_required" } };
  }

  return finalizeAdmin(c, deps.db, admin);
}

export type AuthenticateOperatorByEmailContext = Pick<
  AuthenticateOperatorContext,
  "executionCtx"
>;

export type AuthenticateOperatorByEmailDeps = {
  db: DrizzleClient;
  email: string;
};

/**
 * D52 — dev-mode operator resolution. Looks up `global_admins` by `email`
 * (the row seeded for `LOCAL_DEV_ADMIN_EMAIL`) instead of by JWT `sub`. Runs
 * the same deactivation gate and `lastActiveAt` ping as the production path
 * so `c.var.globalAdmin` ends up populated by the same code regardless of
 * which entry point resolved the row.
 */
export async function authenticateOperatorByEmail(
  c: AuthenticateOperatorByEmailContext,
  deps: AuthenticateOperatorByEmailDeps
): Promise<AuthResult> {
  // Audit-fix #3 — normalize both sides. The dev caller already lowercases +
  // trims the env value, but mirror it here so direct callers in tests can
  // pass mixed-case input safely. The follow-up filter on the result set is
  // a defensive case-fold equality check.
  const email = deps.email.toLowerCase().trim();
  const admin =
    (await deps.db.query.globalAdmins.findFirst({
      where: { email: { eq: email } },
    })) ?? null;

  if (admin) {
    return finalizeAdmin(c, deps.db, admin);
  }

  // Fallback: case-insensitive lookup via raw SQL for legacy rows that may
  // have been inserted before the email-normalization invariant was added.
  const fallbackRows = await deps.db
    .select()
    .from(globalAdmins)
    .where(sql`lower(${globalAdmins.email}) = ${email}`)
    .limit(1);
  const fallback = fallbackRows[0] ?? null;
  if (!fallback) {
    return { ok: false, failure: { kind: "enrollment_required" } };
  }
  return finalizeAdmin(c, deps.db, fallback);
}
