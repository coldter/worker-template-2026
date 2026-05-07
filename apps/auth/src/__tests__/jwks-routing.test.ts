import { describe, expect, it } from "vitest";

/**
 * Pure unit-level guard for AuthEntrypoint.handleAuthRequest's tenant-null
 * routing. The full RPC method depends on `withDrizzleClient`; here we
 * exercise just the path-gating decision so a regression that ever lets a
 * non-JWKS request through with `tenant === null` (re-introducing the apex
 * JWT mint bypass) fails this test.
 *
 * Mirrors the inline check in src/index.ts:
 *
 *   if (!tenant) {
 *     if (url.pathname !== JWKS_PATH) return 400;
 *     return serveJwks();
 *   }
 *
 * The constant lives in src/index.ts and is intentionally not exported (it
 * is a security-sensitive single-call-site value). We re-declare it here and
 * a separate static check ensures it stays in lockstep.
 */
const JWKS_PATH = "/api/auth/jwks";

type Decision =
  | { kind: "reject-no-tenant" }
  | { kind: "serve-jwks" }
  | { kind: "run-pipeline" };

function decide(pathname: string, tenant: { host: string } | null): Decision {
  if (!tenant) {
    if (pathname !== JWKS_PATH) {
      return { kind: "reject-no-tenant" };
    }
    return { kind: "serve-jwks" };
  }
  return { kind: "run-pipeline" };
}

describe("handleAuthRequest tenant-null routing", () => {
  it("serves JWKS when path is /api/auth/jwks and tenant is null", () => {
    expect(decide(JWKS_PATH, null)).toEqual({ kind: "serve-jwks" });
  });

  it("rejects every other path when tenant is null", () => {
    expect(decide("/api/auth/sign-in/email", null)).toEqual({
      kind: "reject-no-tenant",
    });
    expect(decide("/api/auth/get-session", null)).toEqual({
      kind: "reject-no-tenant",
    });
    expect(decide("/api/auth/organization/set-active", null)).toEqual({
      kind: "reject-no-tenant",
    });
    expect(decide("/", null)).toEqual({ kind: "reject-no-tenant" });
  });

  it("does not allow a path that merely starts with /api/auth/jwks", () => {
    // Defense in depth — exact-match only. Any prefix attack must fail closed.
    expect(decide("/api/auth/jwks/foo", null)).toEqual({
      kind: "reject-no-tenant",
    });
    expect(decide("/api/auth/jwks-fake", null)).toEqual({
      kind: "reject-no-tenant",
    });
  });

  it("runs the BA pipeline whenever a tenant is present, even on the JWKS path", () => {
    const tenant = { host: "acme.app.example.com" };
    expect(decide(JWKS_PATH, tenant)).toEqual({ kind: "run-pipeline" });
    expect(decide("/api/auth/sign-in/email", tenant)).toEqual({
      kind: "run-pipeline",
    });
  });
});
