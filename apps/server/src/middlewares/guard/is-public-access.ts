import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { Env } from "@/lib/context";

/**
 * @lintignore
 * Required no-op placeholder middleware for routes accessible by anyone.
 *
 * @param _ - Request context (unused here, but required by Hono middleware signature).
 */
export const isPublicAccess: MiddlewareHandler<Env> = createMiddleware<Env>(
  async (_, next): Promise<void> => {
    await next();
  }
);
