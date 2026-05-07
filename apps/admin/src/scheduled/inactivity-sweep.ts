import { withDrizzleClient } from "@repo/db";
import { auditLogs, globalAdmins } from "@repo/db/schema";
import { AUDIT_EVENTS } from "@repo/shared/audit";
import { and, isNull, lt } from "drizzle-orm";
import type { AdminBindings } from "@/env";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 90-day inactivity sweep. Deactivates any global_admins row whose
 * `lastActiveAt` is older than 90 days and whose `deactivatedAt` is null.
 * Runs from `apps/admin/src/index.ts` `scheduled()` (cron: `0 12 * * *`).
 *
 * Audit-fix #4 — emits one critical `global_admin.deactivated` row per
 * deactivated admin inside the same transaction so the audit row rolls back
 * with the update. The actor is "system"; metadata captures the reason and
 * the row's `lastActiveAt` at sweep time.
 *
 * Returns `{ deactivated: number }` for log lines / contract tests.
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
