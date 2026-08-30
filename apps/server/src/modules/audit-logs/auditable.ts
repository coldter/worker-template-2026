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
  targetId: string;
  targetType?: TargetType;
  metadata?: AuditLogMetadata;
};

export type AuditBuffer = {
  record: (entry: AuditLogEntry) => void;
};

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

    await auditLogService.createMany(
      entries.map((entry) => ({
        actorId: entry.actorId,
        actorType: entry.actorType ?? "user",
        event: entry.event,
        ipAddress: auditContext.ipAddress,
        metadata: entry.metadata,
        targetId: entry.targetId,
        targetType: entry.targetType,
        userAgent: auditContext.userAgent,
      })),
      tx
    );

    return result;
  });
}
