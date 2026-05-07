import { OpenAPIHono } from "@hono/zod-openapi";
import type { GlobalAdmin } from "@repo/db/schema";
import { describe, expect, it, vi } from "vitest";
import type { AdminBindings, AdminEnv } from "@/env";
import tenantsHandler from "@/modules/tenants/handler";

type OperatorRole = "super_admin" | "support" | "read_only" | "security";

function buildEnv() {
  const env = {
    API: { suspendTenant: vi.fn() },
    NODE_ENV: "test",
    ADMIN_HOST: "admin.lvh.me",
    CF_ACCESS_AUD: "aud",
    CF_ACCESS_TEAM_DOMAIN: "https://team.example.com",
  } as unknown as AdminBindings;
  return env;
}

function buildAdmin(role: OperatorRole): GlobalAdmin {
  return {
    id: "gad_dev",
    email: "dev-operator@example.com",
    cfAccessSub: "local-dev-dev-operator@example.com",
    name: "Dev Operator",
    role,
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
}

describe("operator audit logger (deny-path)", () => {
  it("inserts an operator.access.denied row when an operator is forbidden", async () => {
    const valuesMock = vi.fn(async (_row: unknown) => undefined);
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    const fakeDb = { insert: insertMock };

    const app = new OpenAPIHono<AdminEnv>();
    app.use("*", async (c, next) => {
      c.set("db", fakeDb as unknown as AdminEnv["Variables"]["db"]);
      c.set("globalAdmin", buildAdmin("read_only"));
      await next();
    });
    app.route("/api/admin/tenants", tenantsHandler);

    const res = await app.request(
      "/api/admin/tenants/org_acme/suspend",
      {
        method: "POST",
        headers: {
          host: "admin.lvh.me",
          origin: "http://admin.lvh.me",
        },
      },
      buildEnv()
    );

    expect(res.status).toBe(403);
    expect(insertMock).toHaveBeenCalledOnce();
    const insertedRaw = valuesMock.mock.calls[0]?.[0];
    if (!insertedRaw) {
      throw new Error("Expected an insert call to have been made");
    }
    const inserted = insertedRaw as unknown as {
      event: string;
      actorType: string;
      actorId?: string;
      metadata: { action: string; reason: string; path: string };
    };
    expect(inserted.event).toBe("operator.access.denied");
    expect(inserted.actorType).toBe("global_admin");
    expect(inserted.actorId).toBe("gad_dev");
    expect(inserted.metadata.action).toBe("tenant.suspend");
    expect(inserted.metadata.reason).toBe("FORBIDDEN");
    expect(inserted.metadata.path).toBe("/api/admin/tenants/org_acme/suspend");
  });

  it("records an UNAUTHENTICATED row when globalAdmin is missing", async () => {
    const valuesMock = vi.fn(async (_row: unknown) => undefined);
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    const fakeDb = { insert: insertMock };

    const app = new OpenAPIHono<AdminEnv>();
    app.use("*", async (c, next) => {
      c.set("db", fakeDb as unknown as AdminEnv["Variables"]["db"]);
      await next();
    });
    app.route("/api/admin/tenants", tenantsHandler);

    const res = await app.request(
      "/api/admin/tenants",
      {
        method: "GET",
        headers: { host: "admin.lvh.me" },
      },
      buildEnv()
    );

    expect(res.status).toBe(401);
    expect(insertMock).toHaveBeenCalledOnce();
    const insertedRaw = valuesMock.mock.calls[0]?.[0];
    if (!insertedRaw) {
      throw new Error("Expected an insert call to have been made");
    }
    const inserted = insertedRaw as unknown as {
      metadata: { reason: string };
    };
    expect(inserted.metadata.reason).toBe("UNAUTHENTICATED");
  });
});
