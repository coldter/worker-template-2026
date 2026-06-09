import { logger } from "@repo/shared/logger";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

export const analyticsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  try {
    const pathname = c.req.path;
    c.env.ANALYTICS?.writeDataPoint({
      blobs: ["api", c.req.method, pathname],
      doubles: [c.res.status, duration],
      indexes: [pathname],
    });
  } catch (err) {
    logger.debug("Analytics writeDataPoint failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
