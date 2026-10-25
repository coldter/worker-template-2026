import { getClientIpFromHeaders } from "@repo/shared/client-ip";
import type { Context } from "hono";

export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

export const getClientIp = (c: Context): string | undefined =>
  getClientIpFromHeaders(c.req.raw.headers);

export const extractAuditContext = (c: Context): AuditContext => ({
  ipAddress: getClientIp(c),
  userAgent: c.req.header("user-agent") ?? undefined,
});
