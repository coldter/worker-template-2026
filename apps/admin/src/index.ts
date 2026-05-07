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
    ctx.waitUntil(runInactivitySweep(env));
  },
} satisfies ExportedHandler<AdminBindings>;
