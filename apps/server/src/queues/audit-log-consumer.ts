import { z } from "@hono/zod-openapi";
import { withDrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import {
  ACTOR_TYPE_VALUES,
  AUDIT_EVENT_KEYS,
  TARGET_TYPE_VALUES,
} from "@/modules/audit-logs/constants";
import type { AuditLogQueueMessage } from "@/modules/audit-logs/types";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

/**
 * Boundary schema for queue messages. Better Auth / publisher-side types are
 * trusted at compile time, but a single schema migration or drift between
 * producer/consumer versions could deliver a malformed payload that poisons
 * the entire batch insert. Validate per-message and route bad payloads to
 * `message.retry()` so the queue / DLQ can capture them individually.
 */
const queueMessageSchema = z.object({
  event: z.enum(AUDIT_EVENT_KEYS),
  actorId: z.string().optional(),
  actorType: z.enum(ACTOR_TYPE_VALUES).optional(),
  organizationId: z.string().optional(),
  targetId: z.string().optional(),
  targetType: z.enum(TARGET_TYPE_VALUES).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
});

export async function processAuditLogBatch(
  batch: MessageBatch<AuditLogQueueMessage>,
  env: CloudflareBindings
): Promise<void> {
  // Per-message processing: a single bad payload no longer poisons the batch.
  // Each successful insert acks; each failure (validation or DB) calls
  // `message.retry()` so the queue can selectively retry without rolling
  // back the rest of the batch. We do NOT throw — the consumer returns
  // normally so the queue records individual outcomes.
  await withDrizzleClient(
    env.HYPERDRIVE.connectionString,
    async (db) => {
      for (const message of batch.messages) {
        const parsed = queueMessageSchema.safeParse(message.body);
        if (!parsed.success) {
          logger.error("Audit log message rejected: invalid payload", {
            id: message.id,
            issues: parsed.error.issues,
          });
          message.retry();
          continue;
        }
        const body = parsed.data;
        try {
          await db.insert(schema.auditLogs).values({
            event: body.event,
            actorId: body.actorId,
            actorType: body.actorType ?? "user",
            organizationId: body.organizationId,
            targetId: body.targetId,
            targetType: body.targetType,
            ipAddress: body.ipAddress,
            userAgent: body.userAgent,
            metadata: body.metadata,
            createdAt: new Date(body.timestamp),
          });
          message.ack();
        } catch (error) {
          logger.error("Audit log insert failed", {
            id: message.id,
            event: body.event,
            error: error instanceof Error ? error.message : String(error),
          });
          message.retry();
        }
      }
      logger.debug(
        `Audit log batch processed: ${batch.messages.length} entries`
      );
    },
    { logger: getDrizzleLogger() }
  );
}
