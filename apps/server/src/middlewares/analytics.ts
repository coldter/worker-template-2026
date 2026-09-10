import { logger } from "@repo/shared/logger";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppEnv } from "@/lib/context";

const cfPropertiesSchema = z.object({
  colo: z.string().optional().catch(undefined),
  country: z.string().optional().catch(undefined),
});

export const analyticsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  try {
    const { path } = c.req;

    const cf = cfPropertiesSchema.safeParse(c.req.raw.cf);
    c.env.ANALYTICS?.writeDataPoint({
      blobs: [
        "api",
        c.req.method,
        path,
        cf.data?.country ?? null,
        cf.data?.colo ?? null,
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
