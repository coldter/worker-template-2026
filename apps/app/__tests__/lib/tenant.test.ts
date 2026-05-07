import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTenant } from "@/lib/tenant";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveTenant", () => {
  it("calls /api/tenancy/current at the current origin with credentials: include", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        organizationId: "org_1",
        slug: "acme",
        enforceSSO: false,
        providers: [],
        branding: { appName: "Acme" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: { origin: "https://acme.app.example.com" },
    });

    const tenant = await resolveTenant();
    expect(tenant?.slug).toBe("acme");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://acme.app.example.com/api/tenancy/current",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("returns null when the API returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 }))
    );
    vi.stubGlobal("window", {
      location: { origin: "https://nope.app.example.com" },
    });
    expect(await resolveTenant()).toBeNull();
  });

  it("injects x-dev-tenant-slug from VITE_DEV_TENANT_SLUG when in dev mode", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        organizationId: "org_1",
        slug: "acme",
        enforceSSO: false,
        providers: [],
        branding: { appName: "Acme" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3000" },
    });
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_DEV_TENANT_SLUG", "acme");

    await resolveTenant();
    const call = fetchMock.mock.calls.at(0);
    if (!call) {
      throw new Error("expected fetch call");
    }
    const init = call[1];
    if (!init) {
      throw new Error("expected fetch init");
    }
    expect(init.headers).toMatchObject({ "x-dev-tenant-slug": "acme" });
  });
});
