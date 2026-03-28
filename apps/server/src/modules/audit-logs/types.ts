import type { z } from "@hono/zod-openapi";

import type { AUDIT_EVENTS } from "./constants";
import type { listAuditLogsQuerySchema } from "./schema";

export type {
  ActorType,
  AuditEventKey,
  AuditLogMetadata,
  FieldChange,
  TargetType,
} from "@repo/shared/audit";

export type AuditEventObject = {
  [K in keyof typeof AUDIT_EVENTS]: {
    [E in keyof (typeof AUDIT_EVENTS)[K]]: (typeof AUDIT_EVENTS)[K][E];
  }[keyof (typeof AUDIT_EVENTS)[K]];
}[keyof typeof AUDIT_EVENTS];

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
