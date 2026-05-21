import { OpenAPIHono } from "@hono/zod-openapi";
import type { GlobalAdmin } from "@repo/db/schema";
import type {
  AdminApiCreateTenantPayload,
  AdminApiCreateTenantResult,
  AdminApiOperatorIdentity,
} from "@repo/shared/api-binding";
import { describe, expect, it, vi } from "vitest";
import type { AdminBindings, AdminEnv } from "@/env";
import tenantsHandler from "@/modules/tenants/handler";

type CreateTenantFn = (
  operator: AdminApiOperatorIdentity,
  payload: AdminApiCreateTenantPayload
) => Promise<AdminApiCreateTenantResult>;

type OperatorRole = "super_admin" | "support" | "read_only" | "security";

function buildApp(opts: {
  role?: OperatorRole;
  createTenantOnBehalfOf?: CreateTenantFn;
}) {
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

  const createTenantOnBehalfOf =
    opts.createTenantOnBehalfOf ??
    vi.fn(async () => ({ orgId: "org_1", invitationId: "inv_1" }));

  // boundary: tests inject a partial admin bindings object.
  const env = {
    API: { createTenantOnBehalfOf },
    NODE_ENV: "test",
    ADMIN_HOST: "admin.lvh.me",
    CF_ACCESS_AUD: "aud",
    CF_ACCESS_TEAM_DOMAIN: "https://team.example.com",
  } as unknown as AdminBindings;

  return { app, env, createTenantOnBehalfOf };
}

describe("POST /api/admin/tenants", () => {
  it("forwards the operator id and validated body to API.createTenantOnBehalfOf", async () => {
    const { app, env, createTenantOnBehalfOf } = buildApp({});
    const res = await app.request(
      "/api/admin/tenants",
      {
        method: "POST",
        headers: {
          host: "admin.lvh.me",
          "content-type": "application/json",
          origin: "http://admin.lvh.me",
        },
        body: JSON.stringify({
          slug: "acme",
          name: "Acme",
          primaryAdminEmail: "ADMIN@acme.com",
        }),
      },
      env
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      orgId: string;
      invitationId: string;
    };
    expect(body.orgId).toBe("org_1");
    expect(body.invitationId).toBe("inv_1");
    expect(createTenantOnBehalfOf).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "gad_dev",
        email: "dev-operator@example.com",
        role: "super_admin",
      }),
      {
        slug: "acme",
        name: "Acme",
        primaryAdminEmail: "admin@acme.com",
      }
    );
  });

  it("rejects when the operator role lacks tenant.create", async () => {
    const { app, env } = buildApp({ role: "read_only" });
    const res = await app.request(
      "/api/admin/tenants",
      {
        method: "POST",
        headers: {
          host: "admin.lvh.me",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "acme",
          name: "Acme",
          primaryAdminEmail: "admin@acme.com",
        }),
      },
      env
    );
    expect(res.status).toBe(403);
  });

  it("rejects reserved slugs ('admin') with 400", async () => {
    const { app, env, createTenantOnBehalfOf } = buildApp({});
    const res = await app.request(
      "/api/admin/tenants",
      {
        method: "POST",
        headers: {
          host: "admin.lvh.me",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "admin",
          name: "x",
          primaryAdminEmail: "x@y.com",
        }),
      },
      env
    );
    expect(res.status).toBe(400);
    expect(createTenantOnBehalfOf).not.toHaveBeenCalled();
  });

  it("rejects malformed slug ('ACME!') with 400", async () => {
    const { app, env } = buildApp({});
    const res = await app.request(
      "/api/admin/tenants",
      {
        method: "POST",
        headers: {
          host: "admin.lvh.me",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "ACME!",
          name: "x",
          primaryAdminEmail: "x@y.com",
        }),
      },
      env
    );
    expect(res.status).toBe(400);
  });
});
