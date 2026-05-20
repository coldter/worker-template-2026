import { describe, expect, it } from "vitest";
import { loadHostConfigOnce } from "../host-config";

const fakeEnv = {
  WILDCARD_SUFFIX: ".app.example.com",
  ADMIN_HOST: "admin.example.com",
  FALLBACK_HOST: "fallback.example.com",
  LOCAL_DEV_HOSTS: "",
  NODE_ENV: "production" as const,
  ALLOW_DEV_TENANT_HEADER: undefined,
};

const RE_COLLIDE = /collide/;
const RE_LEADING_DOT = /leading dot/;
const RE_LOWERCASE = /lowercase/;

describe("A2.2 loadHostConfigOnce", () => {
  it("freezes and caches", () => {
    const a = loadHostConfigOnce(fakeEnv);
    const b = loadHostConfigOnce(fakeEnv);
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });
  it("rejects when WILDCARD_SUFFIX collides with ADMIN_HOST", () => {
    expect(() =>
      loadHostConfigOnce({ ...fakeEnv, WILDCARD_SUFFIX: ".admin.example.com" })
    ).toThrow(RE_COLLIDE);
  });
  it("requires WILDCARD_SUFFIX to start with a dot", () => {
    expect(() =>
      loadHostConfigOnce({ ...fakeEnv, WILDCARD_SUFFIX: "app.example.com" })
    ).toThrow(RE_LEADING_DOT);
  });
  it("requires ADMIN_HOST to be NFC + lowercase", () => {
    expect(() =>
      loadHostConfigOnce({ ...fakeEnv, ADMIN_HOST: "Admin.example.com" })
    ).toThrow(RE_LOWERCASE);
  });
  it("requires FALLBACK_HOST to be lowercase NFC", () => {
    expect(() =>
      loadHostConfigOnce({ ...fakeEnv, FALLBACK_HOST: "App.example.com" })
    ).toThrow(RE_LOWERCASE);
  });
  it("rejects when FALLBACK_HOST equals ADMIN_HOST", () => {
    expect(() =>
      loadHostConfigOnce({ ...fakeEnv, FALLBACK_HOST: "admin.example.com" })
    ).toThrow(RE_COLLIDE);
  });
  it("rejects when FALLBACK_HOST equals the wildcard base", () => {
    expect(() =>
      loadHostConfigOnce({
        ...fakeEnv,
        WILDCARD_SUFFIX: ".tenant.example.com",
        FALLBACK_HOST: "tenant.example.com",
      })
    ).toThrow(RE_COLLIDE);
  });
  it("rejects when FALLBACK_HOST sits under the wildcard suffix", () => {
    expect(() =>
      loadHostConfigOnce({
        ...fakeEnv,
        WILDCARD_SUFFIX: ".tenant.example.com",
        FALLBACK_HOST: "fallback.tenant.example.com",
      })
    ).toThrow(RE_COLLIDE);
  });
  it("rejects mixed-case LOCAL_DEV_HOSTS entries", () => {
    expect(() =>
      loadHostConfigOnce({
        ...fakeEnv,
        LOCAL_DEV_HOSTS: "localhost:3001,LOCALHOST:3002",
      })
    ).toThrow(RE_LOWERCASE);
  });
  it("accepts lowercase NFC LOCAL_DEV_HOSTS entries", () => {
    const cfg = loadHostConfigOnce({
      ...fakeEnv,
      LOCAL_DEV_HOSTS: "localhost:3001,localhost:3002",
    });
    expect(cfg.localDevHosts).toEqual(["localhost:3001", "localhost:3002"]);
  });
});
