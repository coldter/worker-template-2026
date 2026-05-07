import type { Context } from "hono";
import type { AppEnv } from "@/lib/context";

export type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Read the request-scoped audit context. The audit-context middleware
 * (`apps/server/src/middlewares/audit-context.ts`) populates `c.var.auditContext`
 * once per request, so handlers and services that already ran behind that
 * middleware get a free no-op lookup. The header-derived fallback is
 * preserved for callers that run outside the middleware stack (rare,
 * primarily test helpers).
 */
export function extractAuditContext(c: Context<AppEnv>): AuditContext {
  const fromVar = c.var.auditContext;
  if (fromVar) {
    return fromVar;
  }
  return {
    ipAddress:
      c.req.header("CF-Connecting-IP") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      undefined,
    userAgent: c.req.header("user-agent") ?? undefined,
  };
}
