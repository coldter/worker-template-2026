import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "@/lib/context";
import { defaultHook } from "@/utils/default-hook";
import {
  customHostnameLifecycle,
  type LifecycleEnv,
  LifecycleError,
  TenancyConstraintError,
} from "../lifecycle";
import { TenancyRateLimitError } from "../rate-limits";
import customHostnameRoutes from "./routes";

const app = new OpenAPIHono<AppEnv>({ defaultHook });

function requireUser(c: Context<AppEnv>) {
  const user = c.get("user");
  const session = c.get("session");
  if (!(user && session?.activeOrganizationId)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return {
    id: user.id,
    organizationId: session.activeOrganizationId,
  };
}

function lifecycleEnv(c: Context<AppEnv>): LifecycleEnv {
  return {
    CLOUDFLARE_API_TOKEN: c.env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ZONE_ID: c.env.CLOUDFLARE_ZONE_ID,
    CUSTOM_HOST_CNAME_TARGET: c.env.CUSTOM_HOST_CNAME_TARGET,
    CUSTOM_HOST_VERIFICATION_LABEL: c.env.CUSTOM_HOST_VERIFICATION_LABEL,
  };
}

function mapLifecycleError(err: LifecycleError): HTTPException {
  switch (err.code) {
    case "duplicate_hostname":
      return new HTTPException(409, { message: err.message });
    case "reserved":
    case "invalid_hostname":
      return new HTTPException(422, { message: err.message });
    case "not_found":
      return new HTTPException(404, { message: err.message });
    case "txt_verification_failed":
      return new HTTPException(422, { message: err.message });
    case "txt_resolver_error":
      return new HTTPException(503, { message: err.message });
    case "cf_create_failed":
      return new HTTPException(502, { message: err.message });
    case "service_guard":
      return new HTTPException(422, { message: err.message });
    default:
      return new HTTPException(500, { message: err.message });
  }
}

const customHostnamesHandler = app
  .openapi(customHostnameRoutes.list, async (c) => {
    const actor = requireUser(c);
    const rows = await customHostnameLifecycle.list(
      c.var.db,
      actor.organizationId
    );
    return c.json(
      {
        hostnames: rows.map((r) => ({
          id: r.id,
          hostname: r.hostname,
          lifecycleStatus: r.lifecycleStatus,
          cfStatus: r.cfStatus,
          cfSslStatus: r.cfSslStatus,
          verificationVerifiedAt: r.verificationVerifiedAt
            ? r.verificationVerifiedAt.toISOString()
            : null,
          lastReconciledAt: r.lastReconciledAt
            ? r.lastReconciledAt.toISOString()
            : null,
          verificationErrors: r.verificationErrors,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      200
    );
  })

  .openapi(customHostnameRoutes.request, async (c) => {
    const actor = requireUser(c);
    const body = c.req.valid("json");
    try {
      const result = await customHostnameLifecycle.request(
        c.var.db,
        lifecycleEnv(c),
        body.hostname,
        actor
      );
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof TenancyRateLimitError) {
        throw new HTTPException(429, { message: err.message });
      }
      if (err instanceof LifecycleError) {
        throw mapLifecycleError(err);
      }
      throw err;
    }
  })

  .openapi(customHostnameRoutes.verifyTxt, async (c) => {
    const actor = requireUser(c);
    const { id } = c.req.valid("param");
    try {
      const result = await customHostnameLifecycle.verifyTxt(
        c.var.db,
        lifecycleEnv(c),
        id,
        actor
      );
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof LifecycleError) {
        throw mapLifecycleError(err);
      }
      throw err;
    }
  })

  .openapi(customHostnameRoutes.remove, async (c) => {
    const actor = requireUser(c);
    const { id } = c.req.valid("param");
    try {
      const result = await customHostnameLifecycle.remove(
        c.var.db,
        lifecycleEnv(c),
        id,
        actor,
        { invalidator: c.var.invalidator, cache: c.env.CACHE }
      );
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof TenancyConstraintError) {
        throw new HTTPException(409, { message: err.message });
      }
      if (err instanceof LifecycleError) {
        throw mapLifecycleError(err);
      }
      throw err;
    }
  });

export default customHostnamesHandler;
