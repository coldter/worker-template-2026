import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.doUnmock("better-auth/client");
  vi.doUnmock("better-auth/client/plugins");
  vi.doUnmock("@better-auth/sso/client");
});

describe("auth-client", () => {
  it("uses window.location.origin (not a build-time env var) for baseURL", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://acme.app.example.com" },
    });
    type CreatedOpts = {
      baseURL: string;
      basePath: string;
      plugins: Array<{ id: string }>;
    };
    const created: CreatedOpts[] = [];
    vi.doMock("better-auth/client", () => ({
      createAuthClient: (opts: CreatedOpts) => {
        created.push(opts);
        return { _opts: opts };
      },
    }));
    vi.doMock("better-auth/client/plugins", () => ({
      organizationClient: () => ({ id: "organization" }),
      twoFactorClient: () => ({ id: "twoFactor" }),
    }));
    vi.doMock("@better-auth/sso/client", () => ({
      ssoClient: () => ({ id: "sso" }),
    }));
    await import("@/lib/auth-client");
    expect(created[0]).toMatchObject({
      baseURL: "https://acme.app.example.com",
      basePath: "/api/auth",
      plugins: [{ id: "organization" }, { id: "twoFactor" }, { id: "sso" }],
    });
  });
});
