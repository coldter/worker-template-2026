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
  });
}

// BA throws BetterAuthError when the host is not in allowedHosts (no fallback).
// The Hono/Worker handler converts this to a 400. Tests verify the throw directly.
describe("instance allowedHosts", () => {
  it("throws BetterAuthError for unknown host (no fallback)", async () => {
    const auth = makeAuth();
    const req = new Request(
      "https://attacker.example.com/api/auth/get-session",
      { headers: { Host: "attacker.example.com" } }
    );
    await expect(auth.handler(req)).rejects.toThrow("attacker.example.com");
  });

  it("accepts a tenant subdomain host", async () => {
    const auth = makeAuth();
    const req = new Request("https://acme.app.example.com/api/auth/ok", {
      headers: { Host: "acme.app.example.com" },
    });
    const res = await auth.handler(req);
    expect(res.status).toBe(200);
  });

  it("accepts an active custom hostname", async () => {
    const auth = makeAuth();
    const req = new Request("https://acme.example.io/api/auth/ok", {
      headers: { Host: "acme.example.io" },
    });
    const res = await auth.handler(req);
    expect(res.status).toBe(200);
  });

  it("throws BetterAuthError for admin host (not in allowedHosts)", async () => {
    const auth = makeAuth();
    const req = new Request("https://admin.example.com/api/auth/ok", {
      headers: { Host: "admin.example.com" },
    });
    await expect(auth.handler(req)).rejects.toThrow("admin.example.com");
  });
});
