import { withDrizzleClient } from "@repo/db";
import { auditLogs, globalAdmins } from "@repo/db/schema";
import { AUDIT_EVENTS } from "@repo/shared/audit";
import { and, isNull, lt } from "drizzle-orm";
import type { AdminBindings } from "@/env";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Emits one `global_admin.deactivated` audit row per deactivated admin inside
 * the same transaction so the audit row rolls back if the update fails.
 */
export async function runInactivitySweep(
  env: AdminBindings
): Promise<{ deactivated: number }> {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  return await withDrizzleClient(
    env.HYPERDRIVE.connectionString,
    async (db) =>
      await db.transaction(async (tx) => {
        const deactivatedAt = new Date();
        const updated = await tx
          .update(globalAdmins)
          .set({ deactivatedAt, deactivatedReason: "inactivity_90d" })
          .where(
            and(
              lt(globalAdmins.lastActiveAt, cutoff),
              isNull(globalAdmins.deactivatedAt)
            )
          )
          .returning({
            id: globalAdmins.id,
            email: globalAdmins.email,
            lastActiveAt: globalAdmins.lastActiveAt,
          });

        if (updated.length > 0) {
          await tx.insert(auditLogs).values(
            updated.map((row) => ({
              event: AUDIT_EVENTS.GLOBAL_ADMIN.DEACTIVATED.event,
              actorId: null,
              actorType: "system" as const,
              targetId: row.id,
              targetType: "user" as const,
              metadata: {
                reason: "inactivity_90d",
                lastActiveAt: row.lastActiveAt
                  ? row.lastActiveAt.toISOString()
                  : null,
                email: row.email,
              },
            }))
          );
        }

        return { deactivated: updated.length };
      })
  );
}
