import type { Context } from "hono";

export function extractAuditContext(c: Context): {
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  return {
    ipAddress:
      c.req.header("CF-Connecting-IP") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      undefined,
    userAgent: c.req.header("user-agent") ?? undefined,
  };
}
