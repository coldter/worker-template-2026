import type { Context } from "hono";

export type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

export function extractAuditContext(c: Context): AuditContext {
  return {
    ipAddress:
      c.req.header("CF-Connecting-IP") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      undefined,
    userAgent: c.req.header("user-agent") ?? undefined,
  };
}
