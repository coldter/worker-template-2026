/**
 * C6.2 — admin worker tenant suspend/restore/delete routes.
 *
 * The legacy server worker exposed `POST /api/admin/tenants/:id/suspend|restore`
 * directly under apps/server. C6 collapses every operator-led tenant mutation
 * onto the admin worker, where `requireOperator` already gates by global-admin
 * role and the `AdminApiEntrypoint` RPC handles the transactional flow.
 *
 * These tests pin the new route surface:
 *   POST   /api/admin/tenants/:id/suspend  -> 204 (super_admin / support)
 *   POST   /api/admin/tenants/:id/restore  -> 204 (super_admin / support)
 *   DELETE /api/admin/tenants/:id          -> 204 (super_admin only)
 *
 * Each handler must:
 *   1. Run requireOperator with the matching action.
 *   2. Forward operator identity (id/email/role) + optional reason via the
 *      service binding to AdminApiEntrypoint.
 *   3. Return 204 on success, propagate role gate as 403.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import type { GlobalAdmin } from "@repo/db/schema";
import { describe, expect, it, vi } from "vitest";
import type { AdminBindings, AdminEnv } from "@/env";
import tenantsHandler from "@/modules/tenants/handler";

type OperatorRole = "super_admin" | "support" | "read_only" | "security";

type StubRpc = {
  createTenantOnBehalfOf?: ReturnType<typeof vi.fn>;
  suspendTenant?: ReturnType<typeof vi.fn>;
  restoreTenant?: ReturnType<typeof vi.fn>;
  deleteTenant?: ReturnType<typeof vi.fn>;
};

function buildApp(opts: { role?: OperatorRole; rpc?: StubRpc } = {}) {
  const role: OperatorRole = opts.role ?? "super_admin";
  const seeded: GlobalAdmin = {
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
  const app = new OpenAPIHono<AdminEnv>();
  app.use("*", async (c, next) => {
    c.set("globalAdmin", seeded);
    await next();
  });
  app.route("/api/admin/tenants", tenantsHandler);

  const rpc: StubRpc = {
    createTenantOnBehalfOf:
      opts.rpc?.createTenantOnBehalfOf ??
      vi.fn(async () => ({ orgId: "org_1", invitationId: "inv_1" })),
    suspendTenant: opts.rpc?.suspendTenant ?? vi.fn(async () => undefined),
    restoreTenant: opts.rpc?.restoreTenant ?? vi.fn(async () => undefined),
    deleteTenant: opts.rpc?.deleteTenant ?? vi.fn(async () => undefined),
  };

  // boundary: tests inject a partial admin bindings object — only API.* and
  // a couple of NODE_ENV-shaped keys are read by the handler.
  const env = {
    API: rpc,
    NODE_ENV: "test",
    ADMIN_HOST: "admin.lvh.me",
    CF_ACCESS_AUD: "aud",
    CF_ACCESS_TEAM_DOMAIN: "https://team.example.com",
  } as unknown as AdminBindings;

  return { app, env, rpc, seeded };
}

describe("POST /api/admin/tenants/:id/suspend", () => {
  it("returns 204 and forwards operator identity + reason via API.suspendTenant", async () => {
    const { app, env, rpc } = buildApp({});
    const res = await app.request(
      "/api/admin/tenants/org_acme/suspend",
      {
        method: "POST",
        headers: {
          host: "admin.lvh.me",
          "content-type": "application/json",
          origin: "http://admin.lvh.me",
        },
        body: JSON.stringify({ reason: "TOS violation" }),
      },
      env
    );
    expect(res.status).toBe(204);
    expect(rpc.suspendTenant).toHaveBeenCalledWith(
      "org_acme",
      expect.objectContaining({
        id: "gad_dev",
        email: "dev-operator@example.com",
        role: "super_admin",
      }),
      "TOS violation"
    );
  });

  it("returns 204 with no body (reason optional)", async () => {
    const { app, env, rpc } = buildApp({});
    const res = await app.request(
      "/api/admin/tenants/org_acme/suspend",
      {
        method: "POST",
        headers: {
          host: "admin.lvh.me",
          origin: "http://admin.lvh.me",
        },
      },
      env
    );
    expect(res.status).toBe(204);
    expect(rpc.suspendTenant).toHaveBeenCalledWith(
      "org_acme",
      expect.objectContaining({ id: "gad_dev" }),
      undefined
    );
  });

  it("rejects when the operator role lacks tenant.suspend (read_only)", async () => {
    const { app, env, rpc } = buildApp({ role: "read_only" });
    const res = await app.request(
      "/api/admin/tenants/org_acme/suspend",
      {
        method: "POST",
        headers: { host: "admin.lvh.me" },
      },
      env
    );
    expect(res.status).toBe(403);
    expect(rpc.suspendTenant).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/tenants/:id/restore", () => {
  it("returns 204 and forwards operator identity via API.restoreTenant", async () => {
    const { app, env, rpc } = buildApp({});
    const res = await app.request(
      "/api/admin/tenants/org_acme/restore",
      {
        method: "POST",
        headers: { host: "admin.lvh.me", origin: "http://admin.lvh.me" },
      },
      env
    );
    expect(res.status).toBe(204);
    expect(rpc.restoreTenant).toHaveBeenCalledWith(
      "org_acme",
      expect.objectContaining({
        id: "gad_dev",
        email: "dev-operator@example.com",
        role: "super_admin",
      })
    );
  });

  it("rejects when the operator role lacks tenant.restore (read_only)", async () => {
    const { app, env, rpc } = buildApp({ role: "read_only" });
    const res = await app.request(
      "/api/admin/tenants/org_acme/restore",
      {
        method: "POST",
        headers: { host: "admin.lvh.me" },
      },
      env
    );
    expect(res.status).toBe(403);
    expect(rpc.restoreTenant).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/tenants/:id", () => {
  it("returns 204 and forwards operator identity + reason via API.deleteTenant", async () => {
    const { app, env, rpc } = buildApp({});
    const res = await app.request(
      "/api/admin/tenants/org_acme",
      {
        method: "DELETE",
        headers: {
          host: "admin.lvh.me",
          "content-type": "application/json",
          origin: "http://admin.lvh.me",
        },
        body: JSON.stringify({ reason: "GDPR right-to-erasure" }),
      },
      env
    );
    expect(res.status).toBe(204);
    expect(rpc.deleteTenant).toHaveBeenCalledWith(
      "org_acme",
      expect.objectContaining({
        id: "gad_dev",
        email: "dev-operator@example.com",
        role: "super_admin",
      }),
      "GDPR right-to-erasure"
    );
  });

  it("rejects when the operator role lacks tenant.delete (support)", async () => {
    const { app, env, rpc } = buildApp({ role: "support" });
    const res = await app.request(
      "/api/admin/tenants/org_acme",
      {
        method: "DELETE",
        headers: { host: "admin.lvh.me" },
      },
      env
    );
    expect(res.status).toBe(403);
    expect(rpc.deleteTenant).not.toHaveBeenCalled();
  });
});
