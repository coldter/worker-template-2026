import type { DrizzleClient, Executor } from "@repo/db";
import { auditLogs } from "@repo/db/schema";
import { and, count, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import type {
  CriticalAuditLogInput,
  FindAuditLogsQuery,
} from "@/modules/audit-logs/types";
import {
  buildOrderBy,
  createPaginatedResponse,
  getPaginationParams,
} from "@/utils/pagination";
import type { AuditLogQueueMessage } from "./queue-message";

function toInsertValues(
  input: CriticalAuditLogInput
): typeof auditLogs.$inferInsert {
  return {
    event: input.event,
    actorId: input.actorId,
    actorType: input.actorType ?? "user",
    targetId: input.targetId,
    targetType: input.targetType,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: input.metadata,
  };
}

const ALLOWED_SORT_COLUMNS = {
  event: auditLogs.event,
  actorType: auditLogs.actorType,
  targetType: auditLogs.targetType,
  ipAddress: auditLogs.ipAddress,
  createdAt: auditLogs.createdAt,
} as const;

export const auditLogService = {
  async create(input: CriticalAuditLogInput, executor: Executor) {
    const [log] = await executor
      .insert(auditLogs)
      .values(toInsertValues(input))
      .returning();
    return log;
  },

  /**
   * Insert multiple critical audit entries in a single statement. Used to flush
   * all entries recorded during a transaction at once instead of issuing one
   * round-trip per entry.
   */
  async createMany(inputs: CriticalAuditLogInput[], executor: Executor) {
    if (inputs.length === 0) {
      return;
    }
    await executor.insert(auditLogs).values(inputs.map(toInsertValues));
  },

  /**
   * Send bufferable (non-mutating) audit events to the queue for batched,
   * off-the-hot-path persistence. Critical events must use {@link create}
   * inside the originating transaction instead. Sends are chunked to stay under
   * Cloudflare's per-call sendBatch limit so a future bulk caller is safe.
   */
  async enqueue(queue: Queue, messages: AuditLogQueueMessage[]) {
    const MAX_MESSAGES_PER_BATCH = 100;
    for (let i = 0; i < messages.length; i += MAX_MESSAGES_PER_BATCH) {
      const chunk = messages.slice(i, i + MAX_MESSAGES_PER_BATCH);
      await queue.sendBatch(chunk.map((body) => ({ body })));
    }
  },

  async find(db: DrizzleClient, query: FindAuditLogsQuery) {
    const { event, actorId, targetId, targetType, startDate, endDate } = query;
    const { perPage, offset, sort, order } = getPaginationParams(query);

    const conditions: SQL[] = [];

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
