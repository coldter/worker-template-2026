import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apps/admin server composition", () => {
  it("requires CF Access JWT before reaching any handler", async () => {
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

  it("fails closed when dev-auth flag is set but ADMIN_HOST is not a dev pattern", async () => {
    const { default: app } = await import("@/server");
    const res = await app.request(
      "/api/admin/tenants",
      { headers: { host: "admin.example.com" } },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "development",
        ALLOW_DEV_ADMIN_AUTH: "true",
        LOCAL_DEV_ADMIN_EMAIL: "dev@example.com",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MISCONFIGURED");
  });

  it("allows dev-auth flag when ADMIN_HOST matches a dev pattern (.lvh.me)", async () => {
    vi.doMock("@/middlewares/db", async () => {
      const { createMiddleware } = await import("hono/factory");
      return {
        dbMiddleware: createMiddleware(async (_c, next) => {
          await next();
        }),
      };
    });
    vi.doMock("@/middlewares/cf-access", async () => {
      const { createMiddleware } = await import("hono/factory");
      return {
        cfAccessMiddleware: createMiddleware(async (_c, next) => {
          await next();
        }),
      };
    });
    const { default: app } = await import("@/server");
    const res = await app.request(
      "/api/admin/tenants",
      { headers: { host: "admin.lvh.me" } },
      {
        ADMIN_HOST: "admin.lvh.me",
        NODE_ENV: "development",
        ALLOW_DEV_ADMIN_AUTH: "true",
        LOCAL_DEV_ADMIN_EMAIL: "dev@example.com",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    if (res.status === 500) {
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).not.toBe("MISCONFIGURED");
    }
  });
});
