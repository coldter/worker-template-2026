import type { DrizzleClient, Executor } from "@repo/db";
import type {
  ActorType,
  CriticalAuditEvent,
  TargetType,
} from "@repo/shared/audit";
import type { AuditContext } from "@/lib/audit-context";
import { auditLogService } from "./service";
import type { AuditLogMetadata } from "./types";

export type { AuditContext };

export type AuditLogEntry = {
  event: CriticalAuditEvent;
  actorId: string;
  actorType?: ActorType;
  organizationId?: string;
  targetId: string;
  targetType?: TargetType;
  metadata?: AuditLogMetadata;
};

export type AuditBuffer = {
  record: (entry: AuditLogEntry) => void;
};

/**
 * Run a callback inside a database transaction and automatically flush any
 * recorded audit entries to {@link auditLogService.create} before commit.
 *
 * This concentrates the cross-cutting concern of "critical events must be
 * logged in the same transaction as the action they describe" in one place.
 * Callers use `audit.record(...)` instead of manually calling the service.
 */
export async function auditTransaction<T>(
  db: DrizzleClient,
  auditContext: AuditContext,
  callback: (tx: Executor, audit: AuditBuffer) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const entries: AuditLogEntry[] = [];

    const audit: AuditBuffer = {
      record: (entry) => {
        entries.push(entry);
      },
    };

    const result = await callback(tx, audit);

    for (const entry of entries) {
      await auditLogService.create(
        {
          event: entry.event,
          actorId: entry.actorId,
          actorType: entry.actorType ?? "user",
          organizationId: entry.organizationId,
          targetId: entry.targetId,
          targetType: entry.targetType,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          metadata: entry.metadata,
        },
        tx
      );
    }

    return result;
  });
}
