import { BUFFERABLE_EVENTS } from "@repo/shared/audit";
import { z } from "zod";

/**
 * Canonical shape of a message on the AUDIT_LOG_QUEUE. Bufferable audit events
 * (reads, list views) are serialized to this shape by the producer and
 * re-validated by the consumer before they are written to the database, so a
 * schema drift across deploys results in a dropped message rather than a bad
 * insert. Re-validation is also what lets the single worker-level `queue`
 * handler stay safe as more queues are added: each consumer trusts only its
 * own validated payload, never the raw queue body type.
 */
export const auditLogQueueMessageSchema = z.object({
  event: z.enum(BUFFERABLE_EVENTS),
  actorId: z.string().optional(),
  actorType: z.enum(["user", "system", "api"]).default("user"),
  targetId: z.string().optional(),
  targetType: z.enum(["user", "role", "session"]).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // ISO-8601 timestamp captured when the event occurred, so the persisted
  // createdAt reflects event time rather than the later batch-flush time.
  occurredAt: z.string(),
});

export type AuditLogQueueMessage = z.infer<typeof auditLogQueueMessageSchema>;

/**
 * Validate a single raw queue message body. Returns the parsed message or
 * `null` if it is malformed. The consumer validates per-message (rather than
 * per-batch) so it can ack a poison message individually instead of failing
 * the whole batch.
 */
export function parseAuditLogMessage(
  body: unknown
): AuditLogQueueMessage | null {
  const result = auditLogQueueMessageSchema.safeParse(body);
  return result.success ? result.data : null;
}
