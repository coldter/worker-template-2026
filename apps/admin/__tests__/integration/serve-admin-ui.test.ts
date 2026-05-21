import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/middlewares/db", async () => {
    const { createMiddleware } = await import("hono/factory");
    return {
      dbMiddleware: createMiddleware(async (_c, next) => {
        await next();
      }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseEnv = {
  ADMIN_HOST: "admin.example.com",
  NODE_ENV: "production",
  CF_ACCESS_AUD: "aud",
  CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
};

describe("apps/admin SPA fallback", () => {
  it("forwards non-/api/* GET requests to ADMIN_UI.fetch", async () => {
    const { default: app } = await import("@/server");
    const fetchMock = vi.fn(
      async () =>
        new Response("<!doctype html><html><body>admin-ui</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    // boundary: tests inject a minimal Fetcher-compatible stub for ADMIN_UI.
    const env = {
      ...baseEnv,
      ADMIN_UI: { fetch: fetchMock } as unknown as Fetcher,
    };

    const res = await app.request(
      "/tenants",
      { headers: { host: "admin.example.com" } },
      env
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not forward /api/* requests to ADMIN_UI", async () => {
    const { default: app } = await import("@/server");
    const fetchMock = vi.fn();
    const env = {
      ...baseEnv,
      // boundary: see above.
      ADMIN_UI: { fetch: fetchMock } as unknown as Fetcher,
    };

    const res = await app.request(
      "/api/admin/unknown",
      { headers: { host: "admin.example.com" } },
      env
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect([403, 404]).toContain(res.status);
  });

  it("rejects non-admin host before any SPA forwarding", async () => {
    const { default: app } = await import("@/server");
    const fetchMock = vi.fn();
    const env = {
      ...baseEnv,
      // boundary: same Fetcher stub pattern.
      ADMIN_UI: { fetch: fetchMock } as unknown as Fetcher,
    };

    const res = await app.request(
      "/tenants",
      { headers: { host: "admin.workers.dev" } },
      env
    );

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
