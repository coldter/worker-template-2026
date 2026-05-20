import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";
import { requireTenant } from "@/lib/guards";

export const authProxyMiddleware = createMiddleware<AppEnv>(async (c) => {
  const tenant = requireTenant(c);
  return c.env.AUTH.handleAuthRequest(c.req.raw, tenant);
});
