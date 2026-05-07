import { tenantCustomHostnames } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { authorize } from "@/auth/middleware";
import { commonErrorResponses } from "@/lib/common-response";
import type { AppEnv } from "@/lib/context";
import { createRouteConfig } from "@/lib/route-config";
import {
  customHostnameParamsSchema,
  listCustomHostnamesResponseSchema,
  removeCustomHostnameResponseSchema,
  requestCustomHostnameBodySchema,
  requestCustomHostnameResponseSchema,
  verifyTxtResponseSchema,
} from "./schema";

async function loadTenantCustomHostnameResource(c: Context<AppEnv>) {
  const tenant = c.get("tenant");
  if (!tenant) {
    return null;
  }
  const id = c.req.param("id");
  if (!id) {
    return { id: tenant.organizationId, organizationId: tenant.organizationId };
  }
  const [row] = await c.var.db
    .select({
      id: tenantCustomHostnames.id,
      organizationId: tenantCustomHostnames.organizationId,
    })
    .from(tenantCustomHostnames)
    .where(
      and(
        eq(tenantCustomHostnames.id, id),
        eq(tenantCustomHostnames.organizationId, tenant.organizationId)
      )
    )
    .limit(1);
  return row ?? null;
}

const customHostnameRoutes = {
  list: createRouteConfig({
    operationId: "listCustomHostnames",
    method: "get",
    path: "/",
    guard: [
      authorize("custom_hostname", "list", {
        loadResource: loadTenantCustomHostnameResource,
      }),
    ],
    tags: ["tenancy", "custom-hostnames"],
    summary: "List custom hostnames for the current tenant",
    responses: {
      200: {
        description: "Custom hostnames",
        content: {
          "application/json": { schema: listCustomHostnamesResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),

  request: createRouteConfig({
    operationId: "requestCustomHostname",
    method: "post",
    path: "/",
    guard: [
      authorize("custom_hostname", "create", {
        loadResource: loadTenantCustomHostnameResource,
      }),
    ],
    tags: ["tenancy", "custom-hostnames"],
    summary: "Request a custom hostname (returns TXT verification token)",
    request: {
      body: {
        content: {
          "application/json": { schema: requestCustomHostnameBodySchema },
        },
      },
    },
    responses: {
      201: {
        description: "Custom hostname requested",
        content: {
          "application/json": { schema: requestCustomHostnameResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),

  verifyTxt: createRouteConfig({
    operationId: "verifyCustomHostnameTxt",
    method: "post",
    path: "/:id/verify-txt",
    guard: [
      authorize("custom_hostname", "verify", {
        loadResource: loadTenantCustomHostnameResource,
      }),
    ],
    tags: ["tenancy", "custom-hostnames"],
    summary:
      "Verify the TXT record and register the hostname with Cloudflare for SaaS",
    request: {
      params: customHostnameParamsSchema,
    },
    responses: {
      200: {
        description: "TXT verified, CF registration in progress",
        content: {
          "application/json": { schema: verifyTxtResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),

  remove: createRouteConfig({
    operationId: "removeCustomHostname",
    method: "delete",
    path: "/:id",
    guard: [
      authorize("custom_hostname", "remove", {
        loadResource: loadTenantCustomHostnameResource,
      }),
    ],
    tags: ["tenancy", "custom-hostnames"],
    summary: "Remove a custom hostname (soft-delete tombstone)",
    request: {
      params: customHostnameParamsSchema,
    },
    responses: {
      200: {
        description: "Custom hostname removed",
        content: {
          "application/json": { schema: removeCustomHostnameResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),
};

export default customHostnameRoutes;
