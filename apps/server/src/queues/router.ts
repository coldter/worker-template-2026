import { logger } from "@repo/shared/logger";
import {
  AUDIT_LOG_DLQ_NAME,
  AUDIT_LOG_QUEUE_NAME,
  handleAuditLogDlq,
  handleAuditLogQueue,
} from "@/modules/audit-logs/queue";

type QueueConsumer = (
  batch: MessageBatch,
  env: CloudflareBindings,
  ctx: ExecutionContext
) => Promise<void>;

const QUEUE_CONSUMERS: Record<string, QueueConsumer> = {
  [AUDIT_LOG_QUEUE_NAME]: handleAuditLogQueue,
  [AUDIT_LOG_DLQ_NAME]: handleAuditLogDlq,
};

function recordBatchMetrics(
  batch: MessageBatch,
  env: CloudflareBindings,
  outcome: "ok" | "error",
  durationMs: number
): void {
  try {
    const now = Date.now();
    let oldestLagMs = 0;
    let maxAttempts = 0;
    for (const message of batch.messages) {
      oldestLagMs = Math.max(oldestLagMs, now - message.timestamp.getTime());
      maxAttempts = Math.max(maxAttempts, message.attempts);
    }
    env.ANALYTICS?.writeDataPoint({
      blobs: [
        "queue",
        batch.queue,
        outcome,
        env.CF_VERSION_METADATA?.id ?? null,
      ],
      doubles: [batch.messages.length, durationMs, oldestLagMs, maxAttempts],
      indexes: [batch.queue],
    });
  } catch (err) {
    logger.debug("Queue analytics writeDataPoint failed", {
      error: err,
    });
  }
}

export async function routeQueueBatch(
  batch: MessageBatch,
  env: CloudflareBindings,
  ctx: ExecutionContext
): Promise<void> {
  const consumer = QUEUE_CONSUMERS[batch.queue];

  if (!consumer) {
    logger.warn("No consumer registered for queue; acking batch", {
      messageCount: batch.messages.length,
      queue: batch.queue,
    });
    batch.ackAll();
    return;
  }

  const start = Date.now();
  try {
    await consumer(batch, env, ctx);
    recordBatchMetrics(batch, env, "ok", Date.now() - start);
  } catch (error) {
    recordBatchMetrics(batch, env, "error", Date.now() - start);
    throw error;
  }
}
