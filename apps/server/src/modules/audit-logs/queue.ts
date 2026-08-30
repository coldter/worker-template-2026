import { type DrizzleClient, withDrizzleClient } from "@repo/db";
import { auditLogs } from "@repo/db/schema";
import type { AuditLogMetadata } from "@repo/shared/audit";
import { logger } from "@repo/shared/logger";
import {
  type AuditLogQueueMessage,
  parseAuditLogMessage,
} from "./queue-message";

export const AUDIT_LOG_QUEUE_NAME = "audit-log-queue";
export const AUDIT_LOG_DLQ_NAME = "audit-log-dlq";

/**
 * Consume the audit-log dead-letter queue. These messages exhausted their
 * retries and the audit row was never written; without a consumer they would
 * expire unseen. Each one is logged at error level (identifying fields only,
 * not the full body, which carries ip/user-agent) and acked - alerting on the
 * log message is the recovery signal, the log line the forensic record.
 */
export function handleAuditLogDlq(
  batch: MessageBatch,
  _env: CloudflareBindings,
  _ctx: ExecutionContext
): Promise<void> {
  for (const message of batch.messages) {
    const data = parseAuditLogMessage(message.body);
    logger.error("Audit log message dead-lettered", {
      actorId: data?.actorId,
      attempts: message.attempts,
      enqueuedAt: message.timestamp.toISOString(),
      event: data?.event,
      messageId: message.id,
      occurredAt: data?.occurredAt,
      targetId: data?.targetId,
      targetType: data?.targetType,
    });
  }
  batch.ackAll();
  return Promise.resolve();
}

type PendingAuditRow = {
  message: MessageBatch["messages"][number];
  row: typeof auditLogs.$inferInsert;
};

function toInsertRow(
  message: AuditLogQueueMessage
): typeof auditLogs.$inferInsert {
  return {
    actorId: message.actorId,
    actorType: message.actorType,
    createdAt: new Date(message.occurredAt),
    event: message.event,
    ipAddress: message.ipAddress,
    // boundary: validated by auditLogQueueMessageSchema on dequeue; the jsonb
    // column is typed as AuditLogMetadata which the record satisfies.
    metadata: message.metadata as AuditLogMetadata | undefined,
    targetId: message.targetId,
    targetType: message.targetType,
    userAgent: message.userAgent,
  };
}

async function flushAuditRows(
  db: DrizzleClient,
  pending: PendingAuditRow[]
): Promise<void> {
  try {
    // Fast path: a single multi-row insert for the whole batch.
    await db.insert(auditLogs).values(pending.map((entry) => entry.row));
    for (const { message } of pending) {
      message.ack();
    }
  } catch (batchError) {
    // The batch insert failed. Usually transient (and the whole batch should
    // retry), but it can also be a single poison row. Fall back to per-row
    // inserts so healthy rows still land and only the failing rows are retried
    // (and eventually dead-lettered) in isolation, rather than the whole batch.
    logger.warn("Audit log batch insert failed; falling back to per-row", {
      count: pending.length,
      error: batchError,
    });
    await Promise.all(
      pending.map(async ({ message, row }) => {
        try {
          await db.insert(auditLogs).values(row);
          message.ack();
        } catch (rowError) {
          logger.error("Audit log row insert failed; will retry", {
            error: rowError,
            event: row.event,
          });
          message.retry();
        }
      })
    );
  }
}

/**
 * Consume a batch from the AUDIT_LOG_QUEUE and flush it to the database.
 * Malformed messages are dropped (acked) with a warning; well-formed messages
 * are batch-inserted, with a per-row fallback on failure. If the database
 * cannot be reached at all, the whole batch is retried so nothing is lost (and
 * eventually dead-lettered after the configured max retries).
 */
export async function handleAuditLogQueue(
  batch: MessageBatch,
  env: CloudflareBindings,
  ctx: ExecutionContext
): Promise<void> {
  const pending: PendingAuditRow[] = [];
  let malformed = 0;

  for (const message of batch.messages) {
    const data = parseAuditLogMessage(message.body);
    if (data) {
      pending.push({ message, row: toInsertRow(data) });
    } else {
      // A message that fails validation will never parse on retry: drop it.
      message.ack();
      malformed += 1;
    }
  }

  if (malformed > 0) {
    logger.warn("Dropped malformed audit log queue messages", {
      count: malformed,
    });
  }

  if (pending.length === 0) {
    return;
  }

  try {
    await withDrizzleClient(
      env.HYPERDRIVE.connectionString,
      (db) => flushAuditRows(db, pending),
      { waitUntil: (promise) => ctx.waitUntil(promise) }
    );
  } catch (error) {
    // Could not acquire the connection at all (the callback never ran, so
    // nothing was acked): retry the whole batch.
    logger.error("Audit log flush could not acquire DB; retrying batch", {
      count: pending.length,
      error,
    });
    for (const { message } of pending) {
      message.retry();
    }
  }
}
