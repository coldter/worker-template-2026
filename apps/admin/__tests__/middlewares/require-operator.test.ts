import {
  type OperatorAction,
  type OperatorGlobalAdmin,
  requireOperator,
} from "@repo/authorization";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

type AdminEnv = { Variables: { globalAdmin: OperatorGlobalAdmin } };

const buildApp = (action: OperatorAction) => {
  const app = new Hono<AdminEnv>();
  app.use("*", async (c, next) => {
    const role = (c.req.header("x-test-role") ??
      "support") as OperatorGlobalAdmin["role"];
    const id = c.req.header("x-test-admin-id") ?? "gad_1";
    c.set("globalAdmin", {
      id,
      email: "test@example.com",
      role,
      deactivatedAt: null,
    });
    await next();
  });
  app.use("*", requireOperator(action));
  app.get("/x", (c) => c.text("ok"));
  return app;
};

describe("requireOperator (typed matrix from @repo/authorization)", () => {
  it("allows super_admin for tenant.create", async () => {
    const app = buildApp("tenant.create");
    const res = await app.request("/x", {
      headers: { "x-test-role": "super_admin" },
    });
    expect(res.status).toBe(200);
  });

  it("allows support for tenant.create", async () => {
    const app = buildApp("tenant.create");
    const res = await app.request("/x", {
      headers: { "x-test-role": "support" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects support for tenant.delete", async () => {
    const app = buildApp("tenant.delete");
    const res = await app.request("/x", {
      headers: { "x-test-role": "support" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects read_only for any mutation", async () => {
    const app = buildApp("tenant.invite_admin");
    const res = await app.request("/x", {
      headers: { "x-test-role": "read_only" },
    });
    expect(res.status).toBe(403);
  });

  it("only super_admin can manage_global_admins", async () => {
    const app = buildApp("platform.manage_global_admins");
    expect(
      (
        await app.request("/x", {
          headers: { "x-test-role": "super_admin" },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await app.request("/x", {
          headers: { "x-test-role": "support" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await app.request("/x", {
          headers: { "x-test-role": "security" },
        })
      ).status
    ).toBe(403);
  });

  it("security and support both have read access to view_audit_logs_global", async () => {
    const app = buildApp("platform.view_audit_logs_global");
    expect(
      (
        await app.request("/x", {
          headers: { "x-test-role": "security" },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await app.request("/x", {
          headers: { "x-test-role": "support" },
        })
      ).status
    ).toBe(200);
  });
});
