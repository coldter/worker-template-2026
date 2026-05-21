import { OpenAPIHono } from "@hono/zod-openapi";
import type { GlobalAdmin } from "@repo/db/schema";
import type {
  AdminApiCreateTenantPayload,
  AdminApiCreateTenantResult,
  AdminApiOperatorIdentity,
} from "@repo/shared/api-binding";
import { describe, expect, it, vi } from "vitest";

type DualScopeInput = {
  event: string;
  actorType: string;
  actorId?: string;
  organizationId: string;
  targetType: string;
  targetId: string;
};
const auditCalls = vi.hoisted(() => ({
  createDualScope: vi.fn(
    async (_input: {
      event: string;
      actorType: string;
      actorId?: string;
      organizationId: string;
      targetType: string;
      targetId: string;
    }) => ({ globalRow: {}, tenantRow: {} })
  ),
}));

import type { AdminBindings, AdminEnv } from "@/env";
import tenantsHandler from "@/modules/tenants/handler";

type Insert = { index: number; values: Record<string, unknown> };

function makeFakeServerBinding() {
  const inserts: Insert[] = [];

  const createTenantOnBehalfOf = vi.fn(
    async (
      operator: AdminApiOperatorIdentity,
      payload: AdminApiCreateTenantPayload
    ): Promise<AdminApiCreateTenantResult> => {
      const orgId = `org_${Math.random().toString(16).slice(2, 10)}`;
      const invitationId = `inv_${Math.random().toString(16).slice(2, 10)}`;
      const email = payload.primaryAdminEmail.toLowerCase().trim();
      inserts.push({
        index: 0,
        values: { id: orgId, slug: payload.slug, name: payload.name },
      });
      inserts.push({
        index: 1,
        values: {
          id: invitationId,
          email,
          inviterId: null,
          organizationId: orgId,
          role: "owner",
          status: "pending",
        },
      });
      await auditCalls.createDualScope({
        event: "tenant.created",
        actorType: "global_admin",
        actorId: operator.id,
        targetType: "tenant",
        targetId: orgId,
        organizationId: orgId,
      });
      return { orgId, invitationId };
    }
  );

  return { createTenantOnBehalfOf, inserts };
}

function buildAdminApp() {
  const seeded: GlobalAdmin = {
    id: "gad_dev",
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
  const app = new OpenAPIHono<AdminEnv>();
  app.use("*", async (c, next) => {
    c.set("globalAdmin", seeded);
    await next();
  });
  app.route("/api/admin/tenants", tenantsHandler);

  const { createTenantOnBehalfOf, inserts } = makeFakeServerBinding();
  const env = {
    API: { createTenantOnBehalfOf },
    NODE_ENV: "test",
    ADMIN_HOST: "admin.lvh.me",
    CF_ACCESS_AUD: "aud",
    CF_ACCESS_TEAM_DOMAIN: "https://team.example.com",
  } as unknown as AdminBindings;

  return { app, env, createTenantOnBehalfOf, inserts };
}

describe("operator-led onboarding (integration)", () => {
  it("operator -> POST /api/admin/tenants -> server inserts org + invitation + dual-scope audit", async () => {
    auditCalls.createDualScope.mockClear();
    const { app, env, createTenantOnBehalfOf, inserts } = buildAdminApp();

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
          name: "Acme Co",
          primaryAdminEmail: "owner@acme.com",
        }),
      },
      env
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      orgId: string;
      invitationId: string;
    };
    expect(body.orgId.startsWith("org_")).toBe(true);
    expect(body.invitationId.startsWith("inv_")).toBe(true);

    expect(createTenantOnBehalfOf).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "gad_dev",
        email: "dev-operator@example.com",
        role: "super_admin",
      }),
      {
        slug: "acme",
        name: "Acme Co",
        primaryAdminEmail: "owner@acme.com",
      }
    );

    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.values.slug).toBe("acme");
    expect(inserts[1]?.values.role).toBe("owner");
    expect(inserts[1]?.values.status).toBe("pending");

    expect(auditCalls.createDualScope).toHaveBeenCalledTimes(1);
    const call = auditCalls.createDualScope.mock.calls[0];
    if (!call) {
      throw new Error("expected dual-scope audit call");
    }
    const auditInput = call[0] as DualScopeInput;
    expect(auditInput.event).toBe("tenant.created");
    expect(auditInput.actorType).toBe("global_admin");
    expect(auditInput.actorId).toBe("gad_dev");
    expect(auditInput.targetType).toBe("tenant");
    expect(auditInput.targetId).toBe(body.orgId);
    expect(auditInput.organizationId).toBe(body.orgId);
  });
});
