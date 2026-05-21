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
      // Pinning RS256 (CF Access's signing algorithm) prevents acceptance of
      // HS-signed forgeries that would otherwise verify against JWKS key
      // material.
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

  // CF Access service tokens carry `common_name` and no `email`; user
  // identity tokens carry `email` and never `common_name`. The `type` claim
  // varies between deployments and is unreliable for this discrimination.
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
      // Case-insensitive compare so legacy mixed-case rows still match the
      // normalized JWT email. The atomic-claim guarantee still holds because
      // the UPDATE below is keyed on candidate id and `cfAccessSub IS NULL`.
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

export async function authenticateOperatorByEmail(
  c: AuthenticateOperatorByEmailContext,
  deps: AuthenticateOperatorByEmailDeps
): Promise<AuthResult> {
  const email = deps.email.toLowerCase().trim();
  const admin =
    (await deps.db.query.globalAdmins.findFirst({
      where: { email: { eq: email } },
    })) ?? null;

  if (admin) {
    return finalizeAdmin(c, deps.db, admin);
  }

  // Case-insensitive fallback for legacy rows inserted before the
  // email-normalization invariant was added.
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
