import { withDrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import type { AuditLogQueueMessage } from "@/modules/audit-logs/types";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

export async function processAuditLogBatch(
  batch: MessageBatch<AuditLogQueueMessage>,
  env: CloudflareBindings
): Promise<void> {
  try {
    await withDrizzleClient(
      env.HYPERDRIVE.connectionString,
      async (db) => {
        await db.insert(schema.auditLogs).values(
          batch.messages.map((msg) => ({
            event: msg.body.event,
            actorId: msg.body.actorId,
            actorType: msg.body.actorType ?? "user",
            targetId: msg.body.targetId,
            targetType: msg.body.targetType,
            ipAddress: msg.body.ipAddress,
            userAgent: msg.body.userAgent,
            metadata: msg.body.metadata,
            createdAt: new Date(msg.body.timestamp),
          }))
        );
        logger.debug(
          `Audit log batch processed: ${batch.messages.length} entries`
        );
      },
      { logger: getDrizzleLogger() }
    );
  } catch (error) {
    logger.error("Audit log batch insert failed", {
      batchSize: batch.messages.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
