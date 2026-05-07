import { describe, expect, it } from "vitest";
import { KV_VERSION_KEY, tenantCacheKey } from "../cache-key";

const RE_LOWERCASE = /lowercase/;
const RE_PORT = /port/;

describe("A2.4 tenantCacheKey", () => {
  it("formats key with version and host", () => {
    expect(tenantCacheKey("v3", "acme.app.example.com")).toBe(
      "cache:tenant:v3:acme.app.example.com"
    );
  });
  it("uses 'v0' default when version is empty", () => {
    expect(tenantCacheKey("", "acme.app.example.com")).toBe(
      "cache:tenant:v0:acme.app.example.com"
    );
  });
  it("rejects non-normalized host", () => {
    expect(() => tenantCacheKey("v1", "ACME.example.com")).toThrow(
      RE_LOWERCASE
    );
    expect(() => tenantCacheKey("v1", "acme.example.com:3000")).toThrow(
      RE_PORT
    );
  });
  it("KV_VERSION_KEY locked", () => {
    expect(KV_VERSION_KEY).toBe("cache:tenant:version");
  });
});
