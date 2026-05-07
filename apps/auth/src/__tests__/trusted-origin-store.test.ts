import { afterEach, describe, expect, it } from "vitest";
import {
  __resetTrustedOriginStoreForTests,
  getTrustedOriginsForTenant,
  normalizeIssuerOrigin,
  registerTrustedOriginForTenant,
} from "../trusted-origin-store";

afterEach(() => {
  __resetTrustedOriginStoreForTests();
});

describe("A4.4 normalizeIssuerOrigin", () => {
  it("accepts a bare https URL with no path and returns the origin", () => {
    expect(normalizeIssuerOrigin("https://idp.example.com")).toBe(
      "https://idp.example.com"
    );
  });

  it("accepts https URL with trailing slash and returns the origin", () => {
    expect(normalizeIssuerOrigin("https://idp.example.com/")).toBe(
      "https://idp.example.com"
    );
  });

  it("accepts https URL with port", () => {
    expect(normalizeIssuerOrigin("https://idp.example.com:8443")).toBe(
      "https://idp.example.com:8443"
    );
  });

  it("rejects non-https schemes", () => {
    expect(normalizeIssuerOrigin("http://idp.example.com")).toBeNull();
    expect(normalizeIssuerOrigin("ftp://idp.example.com")).toBeNull();
    expect(normalizeIssuerOrigin("file:///etc/passwd")).toBeNull();
  });

  it("rejects URLs with userinfo", () => {
    expect(normalizeIssuerOrigin("https://user@idp.example.com")).toBeNull();
    expect(normalizeIssuerOrigin("https://user:pw@idp.example.com")).toBeNull();
  });

  it("accepts URLs with paths and returns only the origin", () => {
    expect(normalizeIssuerOrigin("https://idp.example.com/oauth")).toBe(
      "https://idp.example.com"
    );
    expect(
      normalizeIssuerOrigin("https://idp.example.com/.well-known/openid")
    ).toBe("https://idp.example.com");
  });

  it("rejects URLs with search or hash", () => {
    expect(normalizeIssuerOrigin("https://idp.example.com?foo=bar")).toBeNull();
    expect(normalizeIssuerOrigin("https://idp.example.com#frag")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(normalizeIssuerOrigin("not a url")).toBeNull();
    expect(normalizeIssuerOrigin("")).toBeNull();
  });
});

describe("A4.4 trusted-origin store", () => {
  it("returns empty list for unknown tenant", () => {
    expect(getTrustedOriginsForTenant("org_missing")).toEqual([]);
  });

  it("returns empty list for null/undefined tenant", () => {
    expect(getTrustedOriginsForTenant(null)).toEqual([]);
    expect(getTrustedOriginsForTenant(undefined)).toEqual([]);
  });

  it("registers and retrieves an origin scoped to a tenant", () => {
    registerTrustedOriginForTenant("org_acme", "https://idp.example.com");
    expect(getTrustedOriginsForTenant("org_acme")).toContain(
      "https://idp.example.com"
    );
    // Other tenant must not see acme's registration.
    expect(getTrustedOriginsForTenant("org_globex")).toEqual([]);
  });

  it("deduplicates repeat registrations of the same origin", () => {
    registerTrustedOriginForTenant("org_acme", "https://idp.example.com");
    registerTrustedOriginForTenant("org_acme", "https://idp.example.com");
    const list = getTrustedOriginsForTenant("org_acme");
    expect(list).toEqual(["https://idp.example.com"]);
  });

  it("supports multiple distinct origins per tenant", () => {
    registerTrustedOriginForTenant("org_acme", "https://idp1.example.com");
    registerTrustedOriginForTenant("org_acme", "https://idp2.example.com");
    const list = getTrustedOriginsForTenant("org_acme");
    expect(list).toContain("https://idp1.example.com");
    expect(list).toContain("https://idp2.example.com");
    expect(list).toHaveLength(2);
  });

  it("ignores empty tenantId on register", () => {
    registerTrustedOriginForTenant("", "https://idp.example.com");
    expect(getTrustedOriginsForTenant("")).toEqual([]);
  });
});
