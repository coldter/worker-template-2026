import { safeWaitUntil } from "@repo/shared/safe-wait-until";
import type { AdminBindings } from "@/env";
import { runInactivitySweep } from "@/scheduled/inactivity-sweep";
import app from "@/server";

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledController,
    env: AdminBindings,
    ctx: ExecutionContext
  ) {
    // Audit-fix #6 — surface sweep outcome in worker logs.
    safeWaitUntil(
      ctx,
      runInactivitySweep(env).then(
        (result) => {
          console.info(
            JSON.stringify({
              event: "admin.inactivity_sweep",
              deactivated: result.deactivated,
            })
          );
        },
        (err: unknown) => {
          console.error("admin.inactivity_sweep failed", err);
        }
      )
    );
  },
} satisfies ExportedHandler<AdminBindings>;
