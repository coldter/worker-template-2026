import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

export const authProxyMiddleware = createMiddleware<AppEnv>(async (c) => {
  const tenant = c.var.tenant;
  if (!tenant) {
    return c.json({ error: "Tenant required for auth routes" }, 400);
  }
  return c.env.AUTH.handleAuthRequest(c.req.raw, tenant);
});
