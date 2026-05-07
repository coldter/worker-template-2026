import { requireOperator } from "@repo/authorization";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("admin guard wires requireOperator (from @repo/authorization)", () => {
  it("403s when global admin lacks the required role for the action", async () => {
    const app = new Hono<{
      Variables: {
        globalAdmin: {
          id: string;
          email: string;
          role: "read_only";
          deactivatedAt: null;
        };
      };
    }>();
    app.use("*", async (c, next) => {
      c.set("globalAdmin", {
        id: "g1",
        email: "a@x",
        role: "read_only",
        deactivatedAt: null,
      });
      await next();
    });
    app.post("/tenants/:id/suspend", requireOperator("tenant.suspend"), (c) =>
      c.json({ ok: true })
    );
    const res = await app.request("/tenants/abc/suspend", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("allows when role matches the action", async () => {
    const app = new Hono<{
      Variables: {
        globalAdmin: {
          id: string;
          email: string;
          role: "super_admin";
          deactivatedAt: null;
        };
      };
    }>();
    app.use("*", async (c, next) => {
      c.set("globalAdmin", {
        id: "g1",
        email: "a@x",
        role: "super_admin",
        deactivatedAt: null,
      });
      await next();
    });
    app.delete("/tenants/:id", requireOperator("tenant.delete"), (c) =>
      c.json({ ok: true })
    );
    const res = await app.request("/tenants/abc", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("401s when global admin var is unset", async () => {
    const app = new Hono();
    app.post("/tenants", requireOperator("tenant.create"), (c) =>
      c.json({ ok: true })
    );
    const res = await app.request("/tenants", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
