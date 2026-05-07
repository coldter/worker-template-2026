import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apps/admin server composition", () => {
  it("requires CF Access JWT before reaching any handler", async () => {
    // dbMiddleware now mounts before cfAccessMiddleware so the perimeter can
    // resolve `global_admins` rows in either the production CF Access path
    // or the dev-mode email path. This smoke test stubs the db attach so it
    // can exercise the missing-JWT contract without a Hyperdrive binding.
    vi.doMock("@/middlewares/db", async () => {
      const { createMiddleware } = await import("hono/factory");
      return {
        dbMiddleware: createMiddleware(async (_c, next) => {
          await next();
        }),
      };
    });
    const { default: app } = await import("@/server");
    const res = await app.request(
      "/api/admin/tenants",
      { headers: { host: "admin.example.com" } },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "production",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ACCESS_TOKEN_REQUIRED");
  });

  it("returns 404 for non-admin host (workers.dev bypass closed)", async () => {
    const { default: app } = await import("@/server");
    const res = await app.request(
      "/api/admin/tenants",
      { headers: { host: "admin.workers.dev" } },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "production",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(404);
  });
});
