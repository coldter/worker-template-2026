import { logger } from "@repo/shared/logger";
import { loadHostConfigOnce, tenantMiddleware } from "@repo/tenancy";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

const tenancyLogger = {
  info: (rec: Record<string, unknown>) =>
    logger.info(String(rec.event ?? "tenant.event"), rec),
  warn: (rec: Record<string, unknown>) =>
    logger.warn(String(rec.event ?? "tenant.event"), rec),
};

// boundary: vendor-SDK generic variance — Cloudflare Workers exposes `caches.default`
// at runtime, but the DOM CacheStorage typing doesn't model it. Safe in Workers only.
const tenancyCache = (caches as unknown as { default: Cache }).default;

export const tenancyMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const config = loadHostConfigOnce(c.env);
  const mw = tenantMiddleware({
    db: c.var.db,
    cache: {
      match: (req) => tenancyCache.match(req),
      put: (req, res) => tenancyCache.put(req, res),
    },
    kv: c.env.CACHE,
    config,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
    logger: tenancyLogger,
  });
  // boundary: vendor-SDK generic variance — Hono's Context generic is invariant in
  // its env type; AppEnv.Variables is a structural superset of TenancyEnv.Variables,
  // so passing the AppEnv-typed context to a TenancyEnv-typed middleware is safe.
  return mw(c as unknown as Parameters<typeof mw>[0], next);
});
