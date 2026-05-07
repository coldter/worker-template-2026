import type { OperatorAuditLogger } from "@repo/authorization";
import { auditLogs } from "@repo/db/schema";
import { AUDIT_EVENTS } from "@repo/shared/audit";
import type { Context } from "hono";
import type { AdminEnv } from "@/env";

/**
 * Build a worker-scoped `OperatorAuditLogger` for the apps/admin perimeter.
 *
 * `requireOperator` invokes this on every deny path (401 unauthenticated /
 * 403 forbidden). The admin worker has no AUDIT_LOG_QUEUE binding (only
 * apps/server consumes the queue), so the bufferable
 * `operator.access.denied` event is written directly via the per-request
 * Drizzle client. The insert is registered against `executionCtx.waitUntil`
 * so the response can flush before the audit-log write completes while the
 * runtime keeps the isolate alive long enough for the row to settle.
 *
 * Failure is swallowed: an audit insert that throws must NOT mask the deny
 * response. The caller already has a 401/403 in flight.
 */
export const adminOperatorAuditLogger: OperatorAuditLogger = {
  recordOperatorAccessDenied(c, detail) {
    // boundary: Hono middleware adapter generic variance. The authorization
    // adapter passes `Context` without our concrete AdminEnv, but this callback
    // is only mounted in the admin Hono pipeline.
    const ctx = c as unknown as Context<AdminEnv>;
    const db = ctx.var.db;
    if (!db) {
      return;
    }
    const requestId = ctx.req.header("cf-request-id") ?? null;
    const path = ctx.req.path;
    const ipAddress =
      ctx.req.header("cf-connecting-ip") ?? ctx.req.header("x-real-ip");
    const userAgent = ctx.req.header("user-agent");

    const insert = Promise.resolve(
      db.insert(auditLogs).values({
        event: AUDIT_EVENTS.OPERATOR.ACCESS_DENIED.event,
        actorId: detail.actorId,
        actorType: "global_admin",
        ipAddress,
        userAgent,
        metadata: {
          action: detail.action,
          reason: detail.reason,
          requestId,
          path,
        },
      })
    ).catch(() => {
      // Best-effort. Audit-log write failure must not corrupt the deny path.
    });

    try {
      ctx.executionCtx.waitUntil(insert);
    } catch {
      // No execution ctx (tests / scheduled handlers); foreground the insert
      // by letting the promise settle on its own.
    }
  },
};
