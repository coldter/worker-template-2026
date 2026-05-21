import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { type AllowedHostsSnapshot, deriveAllowedHosts } from "../host-config";

const snapshot: AllowedHostsSnapshot = {
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  customHosts: ["acme.example.io"],
  localDevHosts: [],
};

function makeAuth() {
  return betterAuth({
    secret: "a-very-long-secret-for-testing-only-32chars",
    database: memoryAdapter({}),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    baseURL: {
      allowedHosts: deriveAllowedHosts(snapshot) as string[],
      protocol: "https",
    },
    basePath: "/api/auth",
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
        secure: true,
      },
      cookies: {
        session_token: {
          name: "session_token_v1",
          attributes: { httpOnly: true, sameSite: "lax", secure: true },
        },
      },
    },
  });
}

describe("host-only cookie config (config-level assertions)", () => {
  it("session_token cookie has name session_token_v1", () => {
    const auth = makeAuth();
    expect(auth.options.advanced?.cookies?.session_token?.name).toBe(
      "session_token_v1"
    );
  });

  it("session_token cookie attributes: HttpOnly=true", () => {
    const auth = makeAuth();
    const attrs = auth.options.advanced?.cookies?.session_token?.attributes;
    expect(attrs?.httpOnly).toBe(true);
  });

  it("session_token cookie attributes: Secure=true", () => {
    const auth = makeAuth();
    const attrs = auth.options.advanced?.cookies?.session_token?.attributes;
    expect(attrs?.secure).toBe(true);
  });

  it("session_token cookie attributes: SameSite=lax", () => {
    const auth = makeAuth();
    const attrs = auth.options.advanced?.cookies?.session_token?.attributes;
    expect(attrs?.sameSite).toBe("lax");
  });

  it("session_token cookie has no Domain attribute", () => {
    const auth = makeAuth();
    const attrs = auth.options.advanced?.cookies?.session_token?.attributes as
      | Record<string, unknown>
      | undefined;
    // Domain must be absent — browser scopes cookie to host-only.
    expect(attrs?.domain).toBeUndefined();
  });

  it("defaultCookieAttributes: no Domain set", () => {
    const auth = makeAuth();
    const defaults = auth.options.advanced?.defaultCookieAttributes as
      | Record<string, unknown>
      | undefined;
    expect(defaults?.domain).toBeUndefined();
  });

  it("defaultCookieAttributes: HttpOnly, Secure, SameSite=lax", () => {
    const auth = makeAuth();
    const defaults = auth.options.advanced?.defaultCookieAttributes;
    expect(defaults?.httpOnly).toBe(true);
    expect(defaults?.secure).toBe(true);
    expect(defaults?.sameSite).toBe("lax");
  });

  it("useSecureCookies is true", () => {
    const auth = makeAuth();
    expect(auth.options.advanced?.useSecureCookies).toBe(true);
  });

  it("custom hostname config also has no Domain attribute", () => {
    const auth = makeAuth();
    const attrs = auth.options.advanced?.cookies?.session_token?.attributes as
      | Record<string, unknown>
      | undefined;
    expect(attrs?.domain).toBeUndefined();
  });
});
