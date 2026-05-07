import { describe, expect, it } from "vitest";
import { resolveDevTenantHeader } from "../dev-header";

const baseCfg = {
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  fallbackHost: "app.example.com",
  localDevHosts: [],
  allowDevTenantHeader: true,
  nodeEnv: "development" as const,
} as const;

describe("A2.7 dev tenant header", () => {
  it("returns the rewritten host when both gates are open and slug is valid", () => {
    const r = resolveDevTenantHeader("acme", baseCfg);
    expect(r).toEqual({ kind: "rewrite", host: "acme.app.example.com" });
  });
  it("rejects when NODE_ENV is production", () => {
    const r = resolveDevTenantHeader("acme", {
      ...baseCfg,
      nodeEnv: "production",
    });
    expect(r).toEqual({ kind: "ignore", reason: "node_env" });
  });
  it("rejects when ALLOW_DEV_TENANT_HEADER is false", () => {
    const r = resolveDevTenantHeader("acme", {
      ...baseCfg,
      allowDevTenantHeader: false,
    });
    expect(r).toEqual({ kind: "ignore", reason: "secret_missing" });
  });
  it("rejects malformed slug even when gates are open", () => {
    const r = resolveDevTenantHeader("Acme.bad", baseCfg);
    expect(r).toEqual({ kind: "ignore", reason: "slug_format" });
  });
  it("returns ignore for empty header", () => {
    const r = resolveDevTenantHeader("", baseCfg);
    expect(r).toEqual({ kind: "ignore", reason: "empty" });
  });
});
