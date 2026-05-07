import { describe, expect, it } from "vitest";
import { parseHostname } from "../parse-hostname";

const cfg = Object.freeze({
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  fallbackHost: "app.example.com",
  localDevHosts: [] as readonly string[],
  allowDevTenantHeader: false,
  nodeEnv: "production" as const,
});

const LONG_SLUG_HOST = `${"a".repeat(64)}.app.example.com`;

describe("A2.3 parseHostname", () => {
  it("matches subdomain", () => {
    expect(parseHostname("acme.app.example.com", cfg)).toEqual({
      kind: "subdomain",
      slug: "acme",
    });
  });
  it("matches admin exact", () => {
    expect(parseHostname("admin.example.com", cfg)).toEqual({ kind: "admin" });
  });
  it("matches fallback (apex)", () => {
    expect(parseHostname("app.example.com", cfg)).toEqual({ kind: "fallback" });
  });
  it("returns custom for non-suffix host", () => {
    expect(parseHostname("app.acme.com", cfg)).toEqual({
      kind: "custom",
      host: "app.acme.com",
    });
  });
  it("rejects xn-- punycode under the wildcard suffix (operator slugs)", () => {
    expect(parseHostname("xn--acme.app.example.com", cfg)).toEqual({
      kind: "rejected",
      reason: "punycode",
    });
  });
  it("allows xn-- punycode for custom hostnames (IDN apexes)", () => {
    // An IDN custom hostname (`bücher.example` -> `xn--bcher-kva.example`)
    // is legitimate; only the wildcard-suffix path rejects punycode.
    expect(parseHostname("acme.xn--bcher-kva.com", cfg)).toEqual({
      kind: "custom",
      host: "acme.xn--bcher-kva.com",
    });
  });
  it("rejects asterisk", () => {
    expect(parseHostname("*.app.example.com", cfg)).toEqual({
      kind: "rejected",
      reason: "invalid_chars",
    });
  });
  it("rejects whitespace", () => {
    expect(parseHostname("acme .app.example.com", cfg)).toEqual({
      kind: "rejected",
      reason: "invalid_chars",
    });
  });
  it("rejects nested subdomains under suffix", () => {
    expect(parseHostname("a.b.app.example.com", cfg)).toEqual({
      kind: "rejected",
      reason: "nested_subdomain",
    });
  });
  it("rejects slug not matching regex", () => {
    expect(parseHostname("-acme.app.example.com", cfg)).toEqual({
      kind: "rejected",
      reason: "slug_format",
    });
    expect(parseHostname("acme-.app.example.com", cfg)).toEqual({
      kind: "rejected",
      reason: "slug_format",
    });
    expect(parseHostname("ac.me.app.example.com", cfg)).toEqual({
      kind: "rejected",
      reason: "nested_subdomain",
    });
    expect(parseHostname(LONG_SLUG_HOST, cfg)).toEqual({
      kind: "rejected",
      reason: "slug_format",
    });
  });
  it("strips port and trailing dot", () => {
    expect(parseHostname("acme.app.example.com:3000", cfg)).toEqual({
      kind: "subdomain",
      slug: "acme",
    });
    expect(parseHostname("acme.app.example.com.", cfg)).toEqual({
      kind: "subdomain",
      slug: "acme",
    });
  });
  it("NFC-normalizes uppercase", () => {
    expect(parseHostname("ACME.app.example.com", cfg)).toEqual({
      kind: "subdomain",
      slug: "acme",
    });
  });
  it("admin host wins over wildcard match", () => {
    const odd = {
      ...cfg,
      adminHost: "admin.app.example.com",
      wildcardSuffix: ".app.example.com",
    };
    expect(parseHostname("admin.app.example.com", odd)).toEqual({
      kind: "admin",
    });
  });
});
