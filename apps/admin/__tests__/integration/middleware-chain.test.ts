import type { GlobalAdmin } from "@repo/db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin middleware chain (integration)", () => {
  it("allows a seeded super_admin to GET /api/admin/tenants in dev mode", async () => {
    const seeded: GlobalAdmin = {
      id: "gad_1",
      email: "dev-operator@example.com",
      cfAccessSub: "local-dev-dev-operator@example.com",
      name: "Dev Operator",
      role: "super_admin",
      enrollmentToken: null,
      enrollmentTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      lastActiveAt: new Date(),
      deactivatedAt: null,
      deactivatedBy: null,
      deactivatedReason: null,
    };

    const fakeDb = {
      query: {
        globalAdmins: {
          findFirst: vi.fn(async () => seeded),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => ({ rowCount: 1 })) })),
      })),
    };

    vi.doMock("@/middlewares/db", async () => {
      const { createMiddleware } = await import("hono/factory");
      return {
        dbMiddleware: createMiddleware(async (c, next) => {
          // boundary: tests inject a partial drizzle stub.
          c.set("db", fakeDb as never);
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
        LOCAL_DEV_ADMIN_EMAIL: "dev-operator@example.com",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(200);
    expect(fakeDb.query.globalAdmins.findFirst).toHaveBeenCalled();
  });
});
