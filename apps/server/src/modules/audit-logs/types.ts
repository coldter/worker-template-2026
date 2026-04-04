import type { z } from "@hono/zod-openapi";

import type { listAuditLogsQuerySchema } from "./schema";

export type {
  ActorType,
  AuditEventKey,
  AuditLogMetadata,
  BufferableAuditEvent,
  CriticalAuditEvent,
  FieldChange,
  TargetType,
} from "@repo/shared/audit";

export interface CriticalAuditLogInput {
  actorId?: string;
  actorType?: import("@repo/shared/audit").ActorType;
  event: import("@repo/shared/audit").CriticalAuditEvent;
  ipAddress?: string;
  metadata?: import("@repo/shared/audit").AuditLogMetadata;
  targetId?: string;
  targetType?: import("@repo/shared/audit").TargetType;
  userAgent?: string;
}

export interface BufferableAuditLogInput {
  actorId?: string;
  actorType?: import("@repo/shared/audit").ActorType;
  event: import("@repo/shared/audit").BufferableAuditEvent;
  ipAddress?: string;
  metadata?: import("@repo/shared/audit").AuditLogMetadata;
  targetId?: string;
  targetType?: import("@repo/shared/audit").TargetType;
  userAgent?: string;
}

export interface AuditLogQueueMessage {
  actorId?: string;
  actorType?: import("@repo/shared/audit").ActorType;
  event: import("@repo/shared/audit").BufferableAuditEvent;
  ipAddress?: string;
  metadata?: import("@repo/shared/audit").AuditLogMetadata;
  targetId?: string;
  targetType?: import("@repo/shared/audit").TargetType;
  timestamp: string;
  userAgent?: string;
}

export type FindAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
