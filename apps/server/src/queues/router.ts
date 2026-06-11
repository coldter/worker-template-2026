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

/**
 * Registry of queue consumers keyed by queue name. The worker exposes a single
 * `queue` handler (Cloudflare delivers every queue's batches to it), so this
 * map is what keeps batches from different queues isolated. Adding a new queue
 * is: write its consumer in the owning module, then register it here and add the
 * producer/consumer entries to wrangler.jsonc.
 */
const QUEUE_CONSUMERS: Record<string, QueueConsumer> = {
  [AUDIT_LOG_QUEUE_NAME]: handleAuditLogQueue,
  [AUDIT_LOG_DLQ_NAME]: handleAuditLogDlq,
};

// Queue batches never pass the HTTP analytics middleware, so consumer health
// (throughput, processing time, delivery lag, retry pressure) gets its own
// unsampled data points. Lag spiking while counts stay flat means the consumer
// is falling behind; rising attempts means poison messages or DB trouble.
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

/**
 * Dispatch a queue batch to the consumer registered for its queue. An
 * unregistered queue is acked (not retried) to avoid an infinite redelivery
 * loop, and logged loudly so the misconfiguration is visible.
 */
export async function routeQueueBatch(
  batch: MessageBatch,
  env: CloudflareBindings,
  ctx: ExecutionContext
): Promise<void> {
  const consumer = QUEUE_CONSUMERS[batch.queue];

  if (!consumer) {
    logger.warn("No consumer registered for queue; acking batch", {
      queue: batch.queue,
      messageCount: batch.messages.length,
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
