import { describe, expect, it } from "vitest";
import {
  checkAudience,
  checkIssuer,
  checkOrgClaim,
  checkSessionVersion,
  parseClaims,
} from "../invariants";

const baseClaims = {
  sub: "usr_1",
  email: "a@example.com",
  roleSlugs: ["admin"],
  platform: "web" as const,
  org: { id: "org_1", host: "acme.app.example.com", sessionVersion: 5 },
};

describe("invariants", () => {
  it("parseClaims rejects payloads missing org block", () => {
    const r = parseClaims({
      sub: "u",
      email: "e",
      roleSlugs: [],
      platform: "web",
    });
    expect(r.ok).toBe(false);
  });

  it("parseClaims accepts a valid payload", () => {
    const r = parseClaims(baseClaims);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.org.id).toBe("org_1");
      expect(r.claims.platform).toBe("web");
    }
  });

  it("parseClaims rejects an invalid platform", () => {
    const r = parseClaims({ ...baseClaims, platform: "wat" });
    expect(r.ok).toBe(false);
  });

  it("checkAudience returns wrong_aud when audience differs", () => {
    const r = checkAudience("https://wrong.host", "acme.app.example.com");
    expect(r).toEqual({
      kind: "wrong_aud",
      actual: "https://wrong.host",
      expected: "https://acme.app.example.com",
    });
  });

  it("checkAudience returns null when audience matches", () => {
    expect(
      checkAudience("https://acme.app.example.com", "acme.app.example.com")
    ).toBeNull();
  });

  it("checkIssuer returns wrong_iss on mismatch", () => {
    const r = checkIssuer("https://other.host", "acme.app.example.com");
    expect(r?.kind).toBe("wrong_iss");
  });

  it("checkOrgClaim flags wrong_host", () => {
    const ok = checkOrgClaim(baseClaims.org, "acme.app.example.com", "org_1");
    expect(ok).toBeNull();
    const wrongHost = checkOrgClaim(
      { ...baseClaims.org, host: "evil.example.com" },
      "acme.app.example.com",
      "org_1"
    );
    expect(wrongHost?.kind).toBe("wrong_host");
  });

  it("checkOrgClaim flags wrong_org", () => {
    const r = checkOrgClaim(
      { ...baseClaims.org, id: "org_2" },
      "acme.app.example.com",
      "org_1"
    );
    expect(r?.kind).toBe("wrong_org");
  });

  it("checkSessionVersion rejects stale claim", () => {
    expect(checkSessionVersion(3, 5)).toEqual({
      kind: "stale_session",
      claim: 3,
      current: 5,
    });
    expect(checkSessionVersion(5, 5)).toBeNull();
    expect(checkSessionVersion(7, 5)).toBeNull();
  });
});
