import { createMiddleware } from "hono/factory";
import { resolveDevTenantHeader } from "./dev-header";
import type { ResolveDeps } from "./resolve-tenant";
import { resolveTenant } from "./resolve-tenant";
import type { Tenant } from "./types";

export type TenancyEnv = {
  Variables: {
    tenant: Tenant | null;
  };
};

type Logger = Readonly<{
  info(rec: Record<string, unknown>): void;
  warn(rec: Record<string, unknown>): void;
}>;

type MwDeps = ResolveDeps & Readonly<{ logger: Logger }>;

export function tenantMiddleware(deps: MwDeps) {
  return createMiddleware<TenancyEnv>(async (c, next) => {
    const rawHost = c.req.header("Host");
    if (!rawHost) {
      deps.logger.warn({ event: "tenant.resolve.missing_host" });
      return c.text("Bad Request", 400);
    }
    let resolveHost = rawHost;
    // Fail closed in production: never even read the dev header so an
    // attacker cannot probe for a misconfiguration via response timing.
    // `dev-header.ts` also rejects when `nodeEnv === "production"`, but
    // this gate is the structural fail-safe — if someone removes the
    // nodeEnv check by accident, the production middleware still ignores
    // the header.
    if (deps.config.nodeEnv !== "production") {
      const devSlug = c.req.header("X-Dev-Tenant-Slug");
      if (devSlug !== undefined) {
        const dev = resolveDevTenantHeader(devSlug, deps.config);
        if (dev.kind === "rewrite") {
          resolveHost = dev.host;
        } else {
          deps.logger.info({
            event: "tenant.dev_header.ignored",
            reason: dev.reason,
          });
        }
      }
    }
    const r = await resolveTenant(resolveHost, deps);
    if ("kind" in r && r.kind === "not_found") {
      deps.logger.warn({ event: "tenant.resolve.not_found", host: r.host });
      c.set("tenant", null);
      return c.notFound();
    }
    if ("kind" in r && r.kind === "suspended") {
      deps.logger.warn({
        event: "tenant.resolve.suspended",
        organizationId: r.tenant.organizationId,
        host: r.tenant.host,
      });
      c.set("tenant", null);
      return c.text("Service Unavailable", 503, { "Retry-After": "60" });
    }
    deps.logger.info({
      event: "tenant.resolve.ok",
      organizationId: r.organizationId,
      host: r.host,
      kind: r.kind,
    });
    c.set("tenant", r);
    return next();
  });
}
