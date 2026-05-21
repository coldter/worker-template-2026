import { normalizeHostHeader } from "@repo/tenancy";
import { createMiddleware } from "hono/factory";
import type { AdminEnv } from "@/env";

/**
 * Must run before any auth code so workers.dev / preview-host probes are
 * answered with 404 without ever touching DB / JWKS.
 */
export const hostGuardMiddleware = createMiddleware<AdminEnv>(
  async (c, next) => {
    const host = normalizeHostHeader(c.req.header("host") ?? "");
    if (host !== c.env.ADMIN_HOST.toLowerCase()) {
      return c.text("Not Found", 404);
    }
    return next();
  }
);
