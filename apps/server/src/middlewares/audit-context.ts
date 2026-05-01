import { createMiddleware } from "hono/factory";
import { extractAuditContext } from "@/lib/audit-context";
import type { AppEnv } from "@/lib/context";

export const auditContextMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    c.set("auditContext", extractAuditContext(c));
    await next();
  }
);
