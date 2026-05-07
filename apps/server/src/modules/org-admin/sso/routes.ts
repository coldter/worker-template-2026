import type { Context } from "hono";
import { authorize } from "@/auth/middleware";
import { commonErrorResponses } from "@/lib/common-response";
import type { AppEnv } from "@/lib/context";
import { createRouteConfig } from "@/lib/route-config";
import {
  createSsoProviderBodySchema,
  createSsoProviderResponseSchema,
  listSsoProvidersResponseSchema,
  rotateSecretBodySchema,
  ssoProviderParamsSchema,
  successResponseSchema,
  updateSsoProviderBodySchema,
} from "./schema";

const loadTenantSsoProviderResource = async (c: Context<AppEnv>) => {
  const tenant = c.get("tenant");
  if (!tenant) {
    return null;
  }
  return {
    id: c.req.param("providerId") || tenant.organizationId,
    organizationId: tenant.organizationId,
  };
};

const ssoProviderRoutes = {
  listProviders: createRouteConfig({
    operationId: "listSsoProviders",
    method: "get",
    path: "/",
    guard: [
      authorize("sso_provider", "read", {
        loadResource: loadTenantSsoProviderResource,
      }),
    ],
    tags: ["org-admin", "sso"],
    summary: "List SSO providers for the current tenant",
    responses: {
      200: {
        description: "SSO providers",
        content: {
          "application/json": { schema: listSsoProvidersResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),

  createProvider: createRouteConfig({
    operationId: "createSsoProvider",
    method: "post",
    path: "/",
    guard: [
      authorize("sso_provider", "create", {
        loadResource: loadTenantSsoProviderResource,
      }),
    ],
    tags: ["org-admin", "sso"],
    summary: "Register a new SSO provider for the current tenant",
    request: {
      body: {
        content: {
          "application/json": { schema: createSsoProviderBodySchema },
        },
      },
    },
    responses: {
      201: {
        description: "SSO provider created",
        content: {
          "application/json": { schema: createSsoProviderResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),

  updateProvider: createRouteConfig({
    operationId: "updateSsoProvider",
    method: "put",
    path: "/:providerId",
    guard: [
      authorize("sso_provider", "update", {
        loadResource: loadTenantSsoProviderResource,
      }),
    ],
    tags: ["org-admin", "sso"],
    summary: "Update SSO provider metadata (issuer/domain only)",
    request: {
      params: ssoProviderParamsSchema,
      body: {
        content: {
          "application/json": { schema: updateSsoProviderBodySchema },
        },
      },
    },
    responses: {
      200: {
        description: "SSO provider updated",
        content: {
          "application/json": { schema: createSsoProviderResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),

  deleteProvider: createRouteConfig({
    operationId: "deleteSsoProvider",
    method: "delete",
    path: "/:providerId",
    guard: [
      authorize("sso_provider", "delete", {
        loadResource: loadTenantSsoProviderResource,
      }),
    ],
    tags: ["org-admin", "sso"],
    summary: "Delete an SSO provider",
    request: {
      params: ssoProviderParamsSchema,
    },
    responses: {
      200: {
        description: "SSO provider deleted",
        content: {
          "application/json": { schema: successResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),

  rotateSecret: createRouteConfig({
    operationId: "rotateSsoProviderSecret",
    method: "post",
    path: "/:providerId/rotate-secret",
    guard: [
      authorize("sso_provider", "rotate_secret", {
        loadResource: loadTenantSsoProviderResource,
      }),
    ],
    tags: ["org-admin", "sso"],
    summary: "Rotate SSO provider client secret (revokes all org sessions)",
    request: {
      params: ssoProviderParamsSchema,
      body: {
        content: {
          "application/json": { schema: rotateSecretBodySchema },
        },
      },
    },
    responses: {
      200: {
        description: "Secret rotated, sessions revoked",
        content: {
          "application/json": { schema: successResponseSchema },
        },
      },
      ...commonErrorResponses,
    },
  }),
};

export default ssoProviderRoutes;
