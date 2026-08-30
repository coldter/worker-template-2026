import { logger } from "@repo/shared/logger";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

export const analyticsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  try {
    const { path } = c.req;

    const { cf } = c.req.raw;
    c.env.ANALYTICS?.writeDataPoint({
      blobs: [
        "api",
        c.req.method,
        path,
        typeof cf?.country === "string" ? cf.country : null,
        typeof cf?.colo === "string" ? cf.colo : null,
        c.env.CF_VERSION_METADATA?.id ?? null,
      ],
      doubles: [c.res.status, duration],
      indexes: [path],
    });
  } catch (err) {
    logger.debug("Analytics writeDataPoint failed", {
      error: err,
    });
  }
});
