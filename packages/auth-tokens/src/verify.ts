import { errors as joseErrors, jwtVerify } from "jose";
import {
  checkAudience,
  checkIssuer,
  checkOrgClaim,
  checkSessionVersion,
  parseClaims,
} from "./invariants";
import type { AuthorizedClaims, VerifyError, VerifyOpts } from "./types";

type DecodedOk = {
  ok: true;
  payload: unknown;
  aud: string | undefined;
  iss: string | undefined;
};
type DecodedFail = { ok: false; error: VerifyError };
type Decoded = DecodedOk | DecodedFail;

/**
 * Runs jose's `jwtVerify` (which validates the JWS signature, the algorithm
 * header, and `exp` automatically) and normalises the result into a
 * `Decoded` discriminated union so the invariant pipeline below stays free
 * of try/catch noise.
 */
async function decodeAndCheckSignature(
  token: string,
  jwks: VerifyOpts["jwks"]
): Promise<Decoded> {
  try {
    // boundary: jose's `jwtVerify` second argument has a generic resolver
    // shape; our `JWKSResolver` matches it structurally at runtime.
    //
    // Security: pin `algorithms` to EdDSA to block alg-confusion attacks
    // where an attacker signs HS256 tokens with the JWKS public-key bytes
    // as the HMAC secret. Must stay in lock-step with the minter alg in
    // `apps/auth/src/instance.ts`.
    const verified = await jwtVerify(
      token,
      jwks as unknown as Parameters<typeof jwtVerify>[1],
      { algorithms: ["EdDSA"] }
    );
    const audClaim = verified.payload.aud;
    const aud = Array.isArray(audClaim) ? audClaim[0] : audClaim;
    return {
      ok: true,
      payload: verified.payload,
      aud,
      iss: verified.payload.iss,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { ok: false, error: { kind: "expired" } };
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { ok: false, error: { kind: "bad_signature" } };
    }
    // Any other jose failure (claim shape, JWS parse, alg mismatch) is a
    // signature/integrity failure from the caller's perspective.
    return { ok: false, error: { kind: "bad_signature" } };
  }
}

/**
 * Applies invariants 2..5 in a fixed order. Order matters: aud/iss are
 * checked before claim parsing because a wrong-tenant token should report
 * `wrong_aud` rather than the more generic `malformed_claims`.
 */
function applyInvariants(
  payload: unknown,
  aud: string | undefined,
  iss: string | undefined,
  expectedHost: string,
  expectedOrgId: string,
  currentSessionVersion: number
): AuthorizedClaims | VerifyError {
  const audErr = checkAudience(aud, expectedHost);
  if (audErr) {
    return audErr;
  }
  const issErr = checkIssuer(iss, expectedHost);
  if (issErr) {
    return issErr;
  }
  const parsed = parseClaims(payload);
  if (!parsed.ok) {
    return { kind: "malformed_claims" };
  }
  const orgErr = checkOrgClaim(parsed.claims.org, expectedHost, expectedOrgId);
  if (orgErr) {
    return orgErr;
  }
  const verErr = checkSessionVersion(
    parsed.claims.org.sessionVersion,
    currentSessionVersion
  );
  if (verErr) {
    return verErr;
  }
  return parsed.claims;
}

/**
 * Stateless variant — the caller has already loaded (or otherwise knows)
 * the current `sessionVersion` and passes it as `expectedMinSessionVersion`.
 * Useful for edge consumers that already have the organization row in hand
 * (e.g., `c5-tenant-operations`).
 */
export async function verifyTenantJwtStateless(
  token: string,
  opts: VerifyOpts & { expectedMinSessionVersion: number }
): Promise<AuthorizedClaims | VerifyError> {
  const decoded = await decodeAndCheckSignature(token, opts.jwks);
  if (!decoded.ok) {
    return decoded.error;
  }
  return applyInvariants(
    decoded.payload,
    decoded.aud,
    decoded.iss,
    opts.expectedHost,
    opts.expectedOrgId,
    opts.expectedMinSessionVersion
  );
}

type SessionVersionLookup = {
  query: {
    organizations: {
      findFirst: (args: {
        // The `deletedAt: { isNull: true }` predicate enforces the
        // soft-delete invariant: a deleted tenant must not validate a JWT
        // even if its sessionVersion is still current.
        where: {
          AND: [{ id: { eq: string } }, { deletedAt: { isNull: true } }];
        };
        columns: { sessionVersion: true };
      }) => Promise<{ sessionVersion: number } | null | undefined>;
    };
  };
};

/**
 * Stateful variant — looks up the current `sessionVersion` from the
 * `organizations` row using the injected Drizzle client. Skips the DB
 * lookup if `org.id` already mismatches the expected tenant (cheap
 * short-circuit).
 */
export async function verifyTenantJwt(
  token: string,
  opts: VerifyOpts & { db: SessionVersionLookup }
): Promise<AuthorizedClaims | VerifyError> {
  const decoded = await decodeAndCheckSignature(token, opts.jwks);
  if (!decoded.ok) {
    return decoded.error;
  }

  const audErr = checkAudience(decoded.aud, opts.expectedHost);
  if (audErr) {
    return audErr;
  }
  const issErr = checkIssuer(decoded.iss, opts.expectedHost);
  if (issErr) {
    return issErr;
  }
  const parsed = parseClaims(decoded.payload);
  if (!parsed.ok) {
    return { kind: "malformed_claims" };
  }
  const orgErr = checkOrgClaim(
    parsed.claims.org,
    opts.expectedHost,
    opts.expectedOrgId
  );
  if (orgErr) {
    return orgErr;
  }

  // AND-merge `deletedAt IS NULL` with the id lookup so a soft-deleted
  // tenant's JWT fails verification (treated as wrong_org).
  const row = await opts.db.query.organizations.findFirst({
    where: {
      AND: [
        { id: { eq: parsed.claims.org.id } },
        { deletedAt: { isNull: true } },
      ],
    },
    columns: { sessionVersion: true },
  });
  if (!row) {
    return {
      kind: "wrong_org",
      actual: parsed.claims.org.id,
      expected: opts.expectedOrgId,
    };
  }
  const verErr = checkSessionVersion(
    parsed.claims.org.sessionVersion,
    row.sessionVersion
  );
  if (verErr) {
    return verErr;
  }
  return parsed.claims;
}
