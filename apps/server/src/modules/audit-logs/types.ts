import type { z } from "@hono/zod-openapi";
import type {
  ActorType,
  AuditLogMetadata,
  CriticalAuditEvent,
  TargetType,
} from "@repo/shared/audit";

import type { listAuditLogsQuerySchema } from "./schema";

export type {
  ActorType,
  AuditEventKey,
  AuditLogMetadata,
  CriticalAuditEvent,
  FieldChange,
  TargetType,
} from "@repo/shared/audit";

export interface CriticalAuditLogInput {
  actorId?: string;
  actorType?: ActorType;
  event: CriticalAuditEvent;
  ipAddress?: string;
  metadata?: AuditLogMetadata;
  targetId?: string;
  targetType?: TargetType;
  userAgent?: string;
}

export type FindAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
