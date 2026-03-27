import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

export const analyticsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  try {
    c.env.ANALYTICS?.writeDataPoint({
      blobs: ["api", c.req.method, new URL(c.req.url).pathname],
      doubles: [c.res.status, duration],
      indexes: [new URL(c.req.url).pathname],
    });
  } catch {
    // Never let analytics failures affect the response
  }
});
