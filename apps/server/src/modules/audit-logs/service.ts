import { env } from "cloudflare:workers";
import type { DrizzleClient, Executor } from "@repo/db";
import { auditLogs } from "@repo/db/schema";
import { logger, redact } from "@repo/shared/logger";
import { and, count, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "@/lib/context";
import type {
  AuditLogMetadata,
  AuditLogQueueMessage,
  BufferableAuditLogInput,
  CriticalAuditLogInput,
  FindAuditLogsQuery,
} from "@/modules/audit-logs/types";
import {
  buildOrderBy,
  createPaginatedResponse,
  getPaginationParams,
} from "@/utils/pagination";

const ALLOWED_SORT_COLUMNS = {
  event: auditLogs.event,
  actorType: auditLogs.actorType,
  targetType: auditLogs.targetType,
  ipAddress: auditLogs.ipAddress,
  createdAt: auditLogs.createdAt,
} as const;

/**
 * Run the shared logger redactor over audit metadata before persisting it.
 * Audit rows are read by humans during incident response, so the same
 * sensitive-key list applies (passwords, secrets, api keys, etc.). We only
 * redact when metadata is present and is a plain object — otherwise the
 * value passes through untouched.
 */
function redactMetadata(
  metadata: AuditLogMetadata | undefined
): AuditLogMetadata | undefined {
  if (metadata === undefined) {
    return;
  }
  // boundary: structured-log redaction — `redact` walks plain {k:v} shapes
  // and rebuilds a sanitized record; the AuditLogMetadata alias is a
  // structural superset.
  return redact(metadata) as AuditLogMetadata;
}

export const auditLogService = {
  async create(input: CriticalAuditLogInput, executor: Executor) {
    const [log] = await executor
      .insert(auditLogs)
      .values({
        event: input.event,
        actorId: input.actorId,
        actorType: input.actorType ?? "user",
        organizationId: input.organizationId,
        targetId: input.targetId,
        targetType: input.targetType,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: redactMetadata(input.metadata),
      })
      .returning();
    return log;
  },

  /**
   * D25 — dual-scope CRITICAL audit. Writes two rows for an operator-driven
   * mutation against a tenant: one global-scope row (organizationId = NULL)
   * for the operator-attribution feed in apps/admin, and one tenant-scope row
   * (organizationId = input.organizationId) so the tenant's own audit log
   * shows the operator's action. Both rows share event, actor, and target so
   * the pair is searchable end-to-end. Both inserts run on the same executor
   * (typically the surrounding transaction) so they roll back atomically with
   * the underlying mutation.
   */
  async createDualScope(input: CriticalAuditLogInput, executor: Executor) {
    if (!input.organizationId) {
      throw new Error(
        "createDualScope requires organizationId for the tenant-scope row"
      );
    }
    const globalRow = await this.create(
      { ...input, organizationId: undefined },
      executor
    );
    const tenantRow = await this.create(input, executor);
    return { globalRow, tenantRow };
  },

  /**
   * Enqueue a bufferable audit event onto the AUDIT_LOG_QUEUE.
   *
   * When called with the request `Context`, the queue `send` is registered
   * with `c.executionCtx.waitUntil` so the response can flush before the
   * cross-worker queue write completes AND so the runtime keeps the
   * isolate alive long enough for the send to settle (otherwise the
   * promise can be cancelled after the response returns).
   *
   * The single-argument form remains supported for callers that don't have
   * a Context handy (e.g., service-level code invoked from workflows /
   * cron / other queue consumers); they pay the floated-promise hazard
   * but the surface remains backwards compatible.
   */
  enqueue(
    inputOrCtx: BufferableAuditLogInput | Context<AppEnv>,
    maybeInput?: BufferableAuditLogInput
  ): void {
    const ctx =
      maybeInput === undefined ? null : (inputOrCtx as Context<AppEnv>);
    const input =
      maybeInput === undefined
        ? (inputOrCtx as BufferableAuditLogInput)
        : maybeInput;

    const message: AuditLogQueueMessage = {
      ...input,
      metadata: redactMetadata(input.metadata),
      timestamp: new Date().toISOString(),
    };
    const sendPromise = env.AUDIT_LOG_QUEUE.send(message).catch((error) => {
      logger.error("Failed to enqueue audit log", {
        event: message.event,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    if (ctx) {
      ctx.executionCtx.waitUntil(sendPromise);
    }
  },

  async find(
    db: DrizzleClient,
    query: FindAuditLogsQuery,
    scope?: { organizationId: string }
  ) {
    const { event, actorId, targetId, targetType, startDate, endDate } = query;
    const { perPage, offset, sort, order } = getPaginationParams(query);

    const conditions: SQL[] = [];

    if (scope) {
      conditions.push(eq(auditLogs.organizationId, scope.organizationId));
    }

    if (event) {
      if (event.endsWith(".*")) {
        const prefix = event.slice(0, -1);
        conditions.push(sql`${auditLogs.event} LIKE ${`${prefix}%`}`);
      } else {
        conditions.push(sql`${auditLogs.event} = ${event}`);
      }
    }

    if (actorId) {
      conditions.push(eq(auditLogs.actorId, actorId));
    }

    if (targetId) {
      conditions.push(eq(auditLogs.targetId, targetId));
    }

    if (targetType) {
      conditions.push(eq(auditLogs.targetType, targetType));
    }

    if (startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(auditLogs.createdAt, new Date(endDate)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, [countResult]] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(
          buildOrderBy(ALLOWED_SORT_COLUMNS, sort, order, auditLogs.createdAt)
        )
        .limit(perPage)
        .offset(offset),
      db.select({ total: count() }).from(auditLogs).where(where),
    ]);

    return createPaginatedResponse({
      data,
      total: countResult?.total ?? 0,
      query,
    });
  },
};
