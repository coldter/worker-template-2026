import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { extractAuditContext } from "@/lib/audit-context";
import type { AppEnv } from "@/lib/context";
import { requireCurrentUser, requireTenant } from "@/lib/guards";
import { defaultHook } from "@/utils/default-hook";
import ssoProviderRoutes from "./routes";
import {
  createSsoProvider,
  deleteSsoProvider,
  listSsoProviders,
  rotateSecret,
  type SsoProviderRow,
  updateSsoProvider,
} from "./service";

const app = new OpenAPIHono<AppEnv>({ defaultHook });

const requireUser = requireCurrentUser;

function toResponse(provider: SsoProviderRow) {
  return {
    id: provider.id,
    issuer: provider.issuer,
    domain: provider.domain,
    providerId: provider.providerId,
    organizationId: provider.organizationId,
    domainVerified: provider.domainVerified,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

const ssoProviderHandler = app
  .openapi(ssoProviderRoutes.listProviders, async (c) => {
    const tenant = requireTenant(c);
    const providers = await listSsoProviders(c.var.db, tenant);
    return c.json({ providers: providers.map(toResponse) }, 200);
  })

  .openapi(ssoProviderRoutes.createProvider, async (c) => {
    const tenant = requireTenant(c);
    const user = requireUser(c);
    const body = c.req.valid("json");
    const auditCtx = extractAuditContext(c);
    const provider = await createSsoProvider(
      c.var.db,
      c.env,
      tenant,
      body,
      user.id,
      auditCtx
    );
    return c.json({ provider: toResponse(provider) }, 201);
  })

  .openapi(ssoProviderRoutes.updateProvider, async (c) => {
    const tenant = requireTenant(c);
    const user = requireUser(c);
    const { providerId } = c.req.valid("param");
    const body = c.req.valid("json");
    const auditCtx = extractAuditContext(c);
    const updated = await updateSsoProvider(
      c.var.db,
      c.env,
      tenant,
      providerId,
      body,
      user.id,
      auditCtx
    );
    if (!updated) {
      throw new HTTPException(404, { message: "SSO provider not found" });
    }
    return c.json({ provider: toResponse(updated) }, 200);
  })

  .openapi(ssoProviderRoutes.deleteProvider, async (c) => {
    const tenant = requireTenant(c);
    const user = requireUser(c);
    const { providerId } = c.req.valid("param");
    const auditCtx = extractAuditContext(c);
    const deleted = await deleteSsoProvider(
      c.var.db,
      tenant,
      providerId,
      user.id,
      auditCtx
    );
    if (!deleted) {
      throw new HTTPException(404, { message: "SSO provider not found" });
    }
    return c.json({ success: true }, 200);
  })

  .openapi(ssoProviderRoutes.rotateSecret, async (c) => {
    const tenant = requireTenant(c);
    const user = requireUser(c);
    const { providerId } = c.req.valid("param");
    const body = c.req.valid("json");
    const auditCtx = extractAuditContext(c);
    // A4.5 — pass the FanOutInvalidator so the service can bump caches after
    // the rotation tx commits. The middleware-bound invalidator is the
    // canonical entrypoint (apps/server/src/middlewares/invalidator.ts).
    const rotated = await rotateSecret(
      c.var.db,
      c.env,
      tenant,
      providerId,
      body.clientSecret,
      user.id,
      auditCtx,
      c.var.invalidator
    );
    if (!rotated) {
      throw new HTTPException(404, { message: "SSO provider not found" });
    }
    return c.json({ success: true }, 200);
  });

export default ssoProviderHandler;
