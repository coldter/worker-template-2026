import { logger } from "@repo/shared/logger";
import {
  AUDIT_LOG_QUEUE_NAME,
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
};

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

  await consumer(batch, env, ctx);
}
