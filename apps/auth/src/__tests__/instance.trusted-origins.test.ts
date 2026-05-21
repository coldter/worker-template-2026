import type { HostConfig } from "@repo/tenancy";
import { parseHostname } from "@repo/tenancy";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { type AllowedHostsSnapshot, deriveAllowedHosts } from "../host-config";

const snapshot: AllowedHostsSnapshot = {
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  customHosts: ["acme.example.io"],
  localDevHosts: ["localhost:3000"],
};

const hostConfig: HostConfig = {
  wildcardSuffix: snapshot.wildcardSuffix,
  adminHost: snapshot.adminHost,
  fallbackHost: "app.example.com",
  localDevHosts: [...snapshot.localDevHosts],
  allowDevTenantHeader: false,
  nodeEnv: "test",
};

function makeAuth(extraTrustedOrigins: readonly string[] = []) {
  const localDevOrigins = snapshot.localDevHosts.map((h) => `http://${h}`);
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
    // BA auto-merges allowedHosts into trustedOrigins; this callback adds the
    // per-tenant origin explicitly for discovery-origin extension and to
    // make audit reading obvious. Do NOT echo req.headers.get("Host") — that
    // re-opens the trustedOrigins echo abuse.
    trustedOrigins: async (req) => {
      if (!req) {
        return [...localDevOrigins, ...extraTrustedOrigins];
      }
      const host = new URL(req.url).host;
      const parsed = parseHostname(host, hostConfig);
      const tenantOrigin =
        parsed.kind === "subdomain" || parsed.kind === "custom"
          ? [`https://${host}`]
          : [];
      return [...tenantOrigin, ...localDevOrigins, ...extraTrustedOrigins];
    },
  });
}

describe("dynamic trustedOrigins(req)", () => {
  it("includes per-tenant origin for valid subdomain host", async () => {
    const auth = makeAuth();
    const origins = await (
      auth.options.trustedOrigins as (
        req?: Request
      ) => Promise<(string | null | undefined)[]>
    )(
      new Request("https://acme.app.example.com/api/auth/ok", {
        headers: { Host: "acme.app.example.com" },
      })
    );
    expect(origins).toContain("https://acme.app.example.com");
  });

  it("includes per-tenant origin for custom hostname", async () => {
    const auth = makeAuth();
    const origins = await (
      auth.options.trustedOrigins as (
        req?: Request
      ) => Promise<(string | null | undefined)[]>
    )(
      new Request("https://acme.example.io/api/auth/ok", {
        headers: { Host: "acme.example.io" },
      })
    );
    expect(origins).toContain("https://acme.example.io");
  });

  it("excludes per-tenant origin for admin host", async () => {
    const auth = makeAuth();
    const origins = await (
      auth.options.trustedOrigins as (
        req?: Request
      ) => Promise<(string | null | undefined)[]>
    )(
      new Request("https://admin.example.com/api/auth/ok", {
        headers: { Host: "admin.example.com" },
      })
    );
    expect(origins).not.toContain("https://admin.example.com");
  });

  it("includes localDev origins", async () => {
    const auth = makeAuth();
    const origins = await (
      auth.options.trustedOrigins as (
        req?: Request
      ) => Promise<(string | null | undefined)[]>
    )(
      new Request("https://acme.app.example.com/api/auth/ok", {
        headers: { Host: "acme.app.example.com" },
      })
    );
    expect(origins).toContain("http://localhost:3000");
  });

  it("includes extraTrustedOrigins (discovery origins)", async () => {
    const auth = makeAuth(["https://discovery.sso.example.com"]);
    const origins = await (
      auth.options.trustedOrigins as (
        req?: Request
      ) => Promise<(string | null | undefined)[]>
    )(
      new Request("https://acme.app.example.com/api/auth/ok", {
        headers: { Host: "acme.app.example.com" },
      })
    );
    expect(origins).toContain("https://discovery.sso.example.com");
  });

  it("does not include a wildcard per-tenant origin", async () => {
    const auth = makeAuth();
    const origins = await (
      auth.options.trustedOrigins as (
        req?: Request
      ) => Promise<(string | null | undefined)[]>
    )(
      new Request("https://acme.app.example.com/api/auth/ok", {
        headers: { Host: "acme.app.example.com" },
      })
    );
    const hasWildcard = origins.some(
      (o) => typeof o === "string" && o.includes("*")
    );
    expect(hasWildcard).toBe(false);
  });
});
