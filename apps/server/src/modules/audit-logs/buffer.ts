import type {
  ActorType,
  AuditLogMetadata,
  BufferableAuditEvent,
  TargetType,
} from "@repo/shared/audit";
import { logger } from "@repo/shared/logger";
import type { Context } from "hono";
import type { AppEnv } from "@/lib/context";
import type { AuditLogQueueMessage } from "./queue-message";
import { auditLogService } from "./service";

type BufferableAuditInput = {
  event: BufferableAuditEvent;
  actorId?: string;
  actorType?: ActorType;
  targetId?: string;
  targetType?: TargetType;
  metadata?: AuditLogMetadata;
};

/**
 * Record a bufferable (non-mutating) audit event without blocking the response.
 * The event is timestamped, enriched with the request's IP/user-agent, and
 * enqueued to the AUDIT_LOG_QUEUE via `waitUntil`, so a queue outage can never
 * affect the user-facing request. Use this for reads/list views; critical
 * events that accompany a write must use `auditLogService.create` inside the
 * transaction instead.
 */
export function recordBufferableAuditEvent(
  c: Context<AppEnv>,
  input: BufferableAuditInput
): void {
  const message: AuditLogQueueMessage = {
    actorId: input.actorId,
    actorType: input.actorType ?? "user",
    event: input.event,
    ipAddress: c.var.auditContext.ipAddress,
    metadata: input.metadata,
    occurredAt: new Date().toISOString(),
    targetId: input.targetId,
    targetType: input.targetType,
    userAgent: c.var.auditContext.userAgent,
  };

  c.executionCtx.waitUntil(
    auditLogService.enqueue(c.env.AUDIT_LOG_QUEUE, [message]).catch((error) => {
      logger.error("Failed to enqueue bufferable audit event", {
        error,
        event: input.event,
      });
    })
  );
}
