import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { JWKSResolver } from "../types";
import { verifyTenantJwt } from "../verify";

const HOST = "acme.app.example.com";
const ORG = "org_acme";

let jwks: JWKSResolver;
let sign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  const pubJwk = await exportJWK(publicKey);
  sign = async (c) =>
    await new SignJWT(c)
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(privateKey);
  // boundary: importJWK returns a CryptoKey/KeyObject union that satisfies
  // our resolver's KeyLike alias structurally.
  jwks = async () =>
    (await importJWK(pubJwk, "EdDSA")) as Awaited<ReturnType<JWKSResolver>>;
});

const validClaims = (sessionVersion = 5) => ({
  sub: "usr_1",
  email: "a@example.com",
  roleSlugs: ["member"],
  platform: "web",
  iss: `https://${HOST}`,
  aud: `https://${HOST}`,
  org: { id: ORG, host: HOST, sessionVersion },
});

function fakeDb(currentSessionVersion: number | null) {
  return {
    query: {
      organizations: {
        findFirst: vi.fn(async () =>
          currentSessionVersion === null
            ? null
            : { sessionVersion: currentSessionVersion }
        ),
      },
    },
  };
}

describe("verifyTenantJwt — stateful (DB-backed sessionVersion)", () => {
  it("looks up sessionVersion and accepts when claim equals db", async () => {
    const db = fakeDb(5);
    const token = await sign(validClaims(5));
    const r = await verifyTenantJwt(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      jwks,
      db,
    });
    expect("kind" in r).toBe(false);
    expect(db.query.organizations.findFirst).toHaveBeenCalledTimes(1);
  });

  it("accepts when claim sessionVersion exceeds db (forward-compatible)", async () => {
    const db = fakeDb(5);
    const token = await sign(validClaims(7));
    const r = await verifyTenantJwt(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      jwks,
      db,
    });
    expect("kind" in r).toBe(false);
  });

  it("rejects when DB sessionVersion has advanced past claim", async () => {
    const db = fakeDb(7);
    const token = await sign(validClaims(5));
    const r = await verifyTenantJwt(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      jwks,
      db,
    });
    expect("kind" in r && r.kind).toBe("stale_session");
  });

  it("returns wrong_org without DB lookup when org.id mismatches expected", async () => {
    const db = fakeDb(5);
    const claims = validClaims(5);
    const token = await sign({
      ...claims,
      org: { ...claims.org, id: "org_other" },
    });
    const r = await verifyTenantJwt(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      jwks,
      db,
    });
    expect("kind" in r && r.kind).toBe("wrong_org");
    expect(db.query.organizations.findFirst).not.toHaveBeenCalled();
  });

  it("returns wrong_org when the DB row is missing", async () => {
    const db = fakeDb(null);
    const token = await sign(validClaims(5));
    const r = await verifyTenantJwt(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      jwks,
      db,
    });
    expect("kind" in r && r.kind).toBe("wrong_org");
  });
});
