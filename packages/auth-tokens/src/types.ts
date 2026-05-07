import type { JWK, JWTPayload } from "jose";

/**
 * jose 6 exposes the verifier key union as `CryptoKey | KeyObject | JWK |
 * Uint8Array`. We re-alias it locally so callers (and tests) don't need to
 * pull `KeyObject` from `node:crypto` to satisfy our resolver shape.
 */
export type VerifyKey = CryptoKey | JWK | Uint8Array;

/**
 * The validated claim shape produced by the verifier when all five invariants
 * pass. Mirrors the BA payload built by `apps/auth/src/jwt-config.ts`
 * (`buildJwtPayload`) — the verifier and minter share this contract.
 */
export type AuthorizedClaims = {
  sub: string;
  email: string;
  roleSlugs: string[];
  platform: "web" | "mobile";
  org: { id: string; host: string; sessionVersion: number };
};

/**
 * Discriminated error variants returned (not thrown) when a token fails one
 * of the five invariants, signature, or expiry. Returning errors instead of
 * throwing keeps the call sites in middleware ergonomic and avoids leaking
 * jose internals.
 */
export type VerifyError =
  | { kind: "expired" }
  | { kind: "wrong_aud"; actual: string; expected: string }
  | { kind: "wrong_iss"; actual: string; expected: string }
  | { kind: "wrong_org"; actual: string; expected: string }
  | { kind: "wrong_host"; actual: string; expected: string }
  | { kind: "stale_session"; claim: number; current: number }
  | { kind: "bad_signature" }
  | { kind: "malformed_claims" };

/**
 * JWKS resolver shape. Matches jose's `createRemoteJWKSet` return type closely
 * but is expressed as a structural alias so callers can stub it in tests
 * without importing jose's exact generic.
 */
export type JWKSResolver = (
  header: { kid?: string; alg?: string },
  payload: JWTPayload
) => Promise<VerifyKey>;

/**
 * Common input options for both the stateful and stateless verifier
 * variants. The expected host and org id are sourced from the resolved
 * tenant snapshot (`@repo/tenancy`).
 */
export type VerifyOpts = {
  expectedHost: string;
  expectedOrgId: string;
  jwks: JWKSResolver;
};
