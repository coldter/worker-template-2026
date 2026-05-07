import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  // dbMiddleware now mounts before cfAccessMiddleware so the perimeter can
  // resolve `global_admins` rows. These SPA-fallback tests don't go through
  // the perimeter (or fail it intentionally), so we stub the db attach so
  // requests don't hit a real Hyperdrive binding.
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

describe("apps/admin SPA fallback (D63)", () => {
  it("forwards non-/api/* GET requests to ADMIN_UI.fetch", async () => {
    const { default: app } = await import("@/server");
    const fetchMock = vi.fn(
      async () =>
        new Response("<!doctype html><html><body>admin-ui</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    // boundary: tests inject a minimal Fetcher-compatible stub for the
    // ADMIN_UI binding; production wires a real assets binding via wrangler.
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
      // boundary: see above; ADMIN_UI must not be invoked on /api/* paths.
      ADMIN_UI: { fetch: fetchMock } as unknown as Fetcher,
    };

    const res = await app.request(
      "/api/admin/unknown",
      { headers: { host: "admin.example.com" } },
      env
    );

    // Without a CF Access token the request 403s before the fallback runs;
    // either way ADMIN_UI must not be invoked.
    expect(fetchMock).not.toHaveBeenCalled();
    expect([403, 404]).toContain(res.status);
  });

  it("rejects non-admin host before any SPA forwarding", async () => {
    const { default: app } = await import("@/server");
    const fetchMock = vi.fn();
    const env = {
      ...baseEnv,
      // boundary: same Fetcher stub pattern; host guard runs first.
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
