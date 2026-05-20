import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { JWKSResolver } from "../types";
import { verifyTenantJwtStateless } from "../verify";

const HOST = "acme.app.example.com";
const ORG = "org_acme";

type Signer = {
  sign: (
    claims: Record<string, unknown>,
    opts?: { expSecondsFromNow?: number }
  ) => Promise<string>;
  jwks: JWKSResolver;
};

let signer: Signer;

async function makeSigner(): Promise<Signer> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  const pubJwk = await exportJWK(publicKey);
  const sign = async (
    claims: Record<string, unknown>,
    opts?: { expSecondsFromNow?: number }
  ) => {
    const exp = Math.floor(Date.now() / 1000) + (opts?.expSecondsFromNow ?? 60);
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setExpirationTime(exp)
      .sign(privateKey);
  };
  // boundary: jose's importJWK returns a CryptoKey/KeyObject union that
  // satisfies our JWKSResolver's KeyLike alias structurally.
  const jwks: JWKSResolver = async () =>
    (await importJWK(pubJwk, "EdDSA")) as Awaited<ReturnType<JWKSResolver>>;
  return { sign, jwks };
}

const validClaims = () => ({
  sub: "usr_1",
  email: "a@example.com",
  roleSlugs: ["member"],
  platform: "web",
  iss: `https://${HOST}`,
  aud: `https://${HOST}`,
  org: { id: ORG, host: HOST, sessionVersion: 5 },
});

beforeAll(async () => {
  signer = await makeSigner();
});

describe("verifyTenantJwtStateless — 5 invariants", () => {
  it("accepts a fully valid token", async () => {
    const token = await signer.sign(validClaims());
    const result = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in result).toBe(false);
    if ("kind" in result) {
      return;
    }
    expect(result.org.id).toBe(ORG);
    expect(result.org.sessionVersion).toBe(5);
  });

  it("rejects wrong aud", async () => {
    const token = await signer.sign({
      ...validClaims(),
      aud: "https://evil.example.com",
    });
    const r = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("wrong_aud");
  });

  it("rejects wrong iss", async () => {
    const token = await signer.sign({
      ...validClaims(),
      iss: "https://evil.example.com",
    });
    const r = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("wrong_iss");
  });

  it("rejects wrong org.host", async () => {
    const claims = validClaims();
    const token = await signer.sign({
      ...claims,
      org: { ...claims.org, host: "evil.example.com" },
    });
    const r = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("wrong_host");
  });

  it("rejects wrong org.id", async () => {
    const claims = validClaims();
    const token = await signer.sign({
      ...claims,
      org: { ...claims.org, id: "org_other" },
    });
    const r = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("wrong_org");
  });

  it("rejects stale session_version", async () => {
    const claims = validClaims();
    const token = await signer.sign({
      ...claims,
      org: { ...claims.org, sessionVersion: 4 },
    });
    const r = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("stale_session");
  });

  it("rejects expired tokens", async () => {
    const token = await signer.sign(validClaims(), { expSecondsFromNow: -10 });
    const r = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("expired");
  });

  it("rejects bad signature", async () => {
    const other = await makeSigner();
    const token = await other.sign(validClaims());
    const r = await verifyTenantJwtStateless(token, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("bad_signature");
  });

  it("rejects HS256-signed tokens even when the HMAC secret would otherwise verify (alg-confusion guard)", async () => {
    const secret = new TextEncoder().encode(
      "any-symmetric-secret-attacker-controls"
    );
    const hsToken = await new SignJWT(validClaims())
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret);
    const r = await verifyTenantJwtStateless(hsToken, {
      expectedHost: HOST,
      expectedOrgId: ORG,
      expectedMinSessionVersion: 5,
      jwks: signer.jwks,
    });
    expect("kind" in r && r.kind).toBe("bad_signature");
  });
});
