// Hono adapter for the operator matrix. Kept separate from operator.ts so
// the matrix + canOperator stay framework-agnostic.
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { canOperator, type GlobalAdmin, type OperatorAction } from "./operator";

type RequireOperatorEnv = {
  Variables: { globalAdmin?: GlobalAdmin };
};

/**
 * Minimal audit hook accepted by `requireOperator`. The `apps/server` and
 * `apps/admin` workers wire this to `auditLogService.enqueue(c, ...)` so
 * `operator.access.denied` events land on `AUDIT_LOG_QUEUE`. The shape is
 * intentionally narrow -- we depend only on what the deny path needs and
 * keep this package free of any worker-specific binding type.
 */
export interface OperatorAuditLogger {
  /**
   * Emit a bufferable `operator.access.denied` audit event. The hook
   * receives the Hono context so the consumer can register the queue
   * `send` against `c.executionCtx.waitUntil`.
   */
  recordOperatorAccessDenied(
    c: Context<RequireOperatorEnv>,
    detail: {
      action: OperatorAction;
      actorId?: string;
      reason: "UNAUTHENTICATED" | "FORBIDDEN";
    }
  ): void;
}

// Build the HTTPException for any deny path in this adapter. Mirrors the
// uniform body shape produced by `denyResponse` in `./hono.ts`: 401 carries
// `code:"UNAUTHORIZED"`, 403 carries `code:"FORBIDDEN"`. The wire body
// intentionally hides the deny reason -- including the action name and the
// principal's role -- to match S-3 in `hono.ts`.
function operatorDeny(reason: "UNAUTHENTICATED" | "FORBIDDEN"): HTTPException {
  const status = reason === "UNAUTHENTICATED" ? 401 : 403;
  const message = status === 401 ? "Unauthorized" : "Forbidden";
  const code = status === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
  return new HTTPException(status, {
    message,
    res: new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  });
}

export interface RequireOperatorOptions {
  /**
   * Optional audit logger. When supplied, every deny path emits a
   * bufferable `operator.access.denied` event with the actor, action, and
   * the underlying reason. The package keeps the dependency optional so
   * test harnesses and non-worker consumers can omit it.
   */
  audit?: OperatorAuditLogger;
}

/**
 * D55 — Hono middleware factory: `requireOperator(action) => middleware`. Pulls
 * the operator row off `c.var.globalAdmin` (set by `cfAccessMiddleware`) and
 * rejects with 401 if the row is missing or 403 if the operator lacks the
 * action.
 *
 * Deny shape matches `createAuthorize`: a single uniform body
 * `{ error: { code, message } }` with no action- or role-leaking strings.
 */
export const requireOperator = (
  action: OperatorAction,
  options: RequireOperatorOptions = {}
) =>
  createMiddleware<RequireOperatorEnv>(async (c, next) => {
    const admin = c.get("globalAdmin");
    if (!admin) {
      options.audit?.recordOperatorAccessDenied(c, {
        action,
        reason: "UNAUTHENTICATED",
      });
      throw operatorDeny("UNAUTHENTICATED");
    }
    if (!canOperator(admin, action)) {
      options.audit?.recordOperatorAccessDenied(c, {
        action,
        actorId: admin.id,
        reason: "FORBIDDEN",
      });
      throw operatorDeny("FORBIDDEN");
    }
    return await next();
  });
