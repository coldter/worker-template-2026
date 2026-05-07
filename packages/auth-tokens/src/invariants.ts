import type { AuthorizedClaims, VerifyError } from "./types";

type ParseResult = { ok: true; claims: AuthorizedClaims } | { ok: false };

/**
 * Pure validator that walks the decoded JWT payload and confirms every field
 * the verifier downstream expects. Centralised here so the stateless and
 * stateful variants share one source of truth for the claim shape.
 */
export function parseClaims(payload: unknown): ParseResult {
  // boundary: payload is jose's JWTPayload, which is opaque before we run
  // these structural checks. Each `typeof` below acts as the validator.
  const p = payload as Record<string, unknown>;
  if (typeof p.sub !== "string" || typeof p.email !== "string") {
    return { ok: false };
  }
  if (!Array.isArray(p.roleSlugs)) {
    return { ok: false };
  }
  if (p.platform !== "web" && p.platform !== "mobile") {
    return { ok: false };
  }
  // boundary: org claim is an unknown nested record before structural checks
  // below — this cast lets us inspect keys to validate them.
  const org = p.org as Record<string, unknown> | undefined;
  if (!org) {
    return { ok: false };
  }
  if (
    typeof org.id !== "string" ||
    typeof org.host !== "string" ||
    typeof org.sessionVersion !== "number"
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    claims: {
      sub: p.sub,
      email: p.email,
      roleSlugs: p.roleSlugs.filter(
        (slug): slug is string => typeof slug === "string"
      ),
      platform: p.platform,
      org: {
        id: org.id,
        host: org.host,
        sessionVersion: org.sessionVersion,
      },
    },
  };
}

/**
 * Invariant 2 — audience matches `https://${expectedHost}` (D12 URL-form).
 */
export function checkAudience(
  actual: string | undefined,
  expectedHost: string
): VerifyError | null {
  const expected = `https://${expectedHost}`;
  if (actual !== expected) {
    return { kind: "wrong_aud", actual: actual ?? "", expected };
  }
  return null;
}

/**
 * Invariant 3 — issuer matches `https://${expectedHost}` (D12 URL-form).
 */
export function checkIssuer(
  actual: string | undefined,
  expectedHost: string
): VerifyError | null {
  const expected = `https://${expectedHost}`;
  if (actual !== expected) {
    return { kind: "wrong_iss", actual: actual ?? "", expected };
  }
  return null;
}

/**
 * Invariant 4 — `org.host` matches the resolved tenant's host AND `org.id`
 * matches the resolved tenant's organization id. `org.id` is the stable
 * identity that survives custom-hostname swaps; `org.host` is the
 * transport-level scope that mirrors the tenant URL the request targeted.
 */
export function checkOrgClaim(
  org: AuthorizedClaims["org"],
  expectedHost: string,
  expectedOrgId: string
): VerifyError | null {
  if (org.host !== expectedHost) {
    return { kind: "wrong_host", actual: org.host, expected: expectedHost };
  }
  if (org.id !== expectedOrgId) {
    return { kind: "wrong_org", actual: org.id, expected: expectedOrgId };
  }
  return null;
}

/**
 * Invariant 5 — `claim.sessionVersion >= currentSessionVersion`. Tokens are
 * accepted as long as the claim is not older than the current row; future
 * rotations advance the row's `session_version`, which retroactively
 * invalidates older claims (revocation primitive).
 */
export function checkSessionVersion(
  claim: number,
  current: number
): VerifyError | null {
  if (claim < current) {
    return { kind: "stale_session", claim, current };
  }
  return null;
}
