import { createDrizzleClient } from "@repo/db/client";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { Client } from "pg";
import type { AuditLogQueueMessage } from "@/modules/audit-logs/types";

export async function processAuditLogBatch(
  batch: MessageBatch<AuditLogQueueMessage>,
  env: CloudflareBindings
): Promise<void> {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });
  await client.connect();
  try {
    const db = createDrizzleClient(
      client,
      process.env.NODE_ENV === "development" ? new DrizzleLogger() : undefined
    );
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
    logger.debug(`Audit log batch processed: ${batch.messages.length} entries`);
  } catch (error) {
    logger.error("Audit log batch insert failed", {
      batchSize: batch.messages.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await client.end();
  }
}
