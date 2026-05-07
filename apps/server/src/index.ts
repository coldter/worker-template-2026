import { reconcileHostnamesScheduled } from "@/cron/reconcile-hostnames";
import type { AuditLogQueueMessage } from "@/modules/audit-logs/types";
import { processAuditLogBatch } from "@/queues/audit-log-consumer";
import app from "./server";

// Re-export Durable Objects (required by Wrangler)
export { RateLimiter } from "./durable-objects/rate-limiter";
export { AdminApiEntrypoint, ApiEntrypoint } from "./entrypoint";
export { EmailNotificationWorkflow } from "./workflows/email-notification";
// Re-export Workflows (required by Wrangler)
export { OnboardingWorkflow } from "./workflows/onboarding";
export { PushNotificationWorkflow } from "./workflows/push-notification";

export default {
  fetch: app.fetch,
  async queue(
    batch: MessageBatch<AuditLogQueueMessage>,
    env: CloudflareBindings
  ): Promise<void> {
    await processAuditLogBatch(batch, env);
  },
  async scheduled(
    controller: ScheduledController,
    env: CloudflareBindings,
    ctx: ExecutionContext
  ): Promise<void> {
    // A5 / D9 — 60s reconciler for non-terminal custom hostnames.
    await reconcileHostnamesScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<CloudflareBindings, AuditLogQueueMessage>;
