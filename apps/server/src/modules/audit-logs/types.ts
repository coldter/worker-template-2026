import type { z } from "@hono/zod-openapi";

import type { listAuditLogsQuerySchema } from "./schema";

export type {
  ActorType,
  AuditEventKey,
  AuditLogMetadata,
  FieldChange,
  TargetType,
} from "@repo/shared/audit";

export interface CreateAuditLogInput {
  actorId?: string;
  actorType?: import("@repo/shared/audit").ActorType;
  event: import("@repo/shared/audit").AuditEventKey;
  ipAddress?: string;
  metadata?: import("@repo/shared/audit").AuditLogMetadata;
  targetId?: string;
  targetType?: import("@repo/shared/audit").TargetType;
  userAgent?: string;
}

export type FindAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
