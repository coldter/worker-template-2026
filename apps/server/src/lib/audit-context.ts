import { getClientIpFromHeaders } from "@repo/shared/client-ip";
import type { Context } from "hono";

export type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

export function getClientIp(c: Context): string | undefined {
  return getClientIpFromHeaders(c.req.raw.headers);
}

export function extractAuditContext(c: Context): AuditContext {
  return {
    ipAddress: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? undefined,
  };
}
