import { BUFFERABLE_EVENTS } from "@repo/shared/audit";
import { z } from "zod";

export const auditLogQueueMessageSchema = z.object({
  actorId: z.string().optional(),
  actorType: z.enum(["user", "system", "api"]).default("user"),
  event: z.enum(BUFFERABLE_EVENTS),
  ipAddress: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),

  occurredAt: z.string(),
  targetId: z.string().optional(),
  targetType: z.enum(["user", "role", "session"]).optional(),
  userAgent: z.string().optional(),
});

export type AuditLogQueueMessage = z.infer<typeof auditLogQueueMessageSchema>;

export function parseAuditLogMessage(
  body: unknown
): AuditLogQueueMessage | null {
  const result = auditLogQueueMessageSchema.safeParse(body);
  return result.success ? result.data : null;
}
