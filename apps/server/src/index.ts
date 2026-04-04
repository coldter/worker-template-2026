import type { AuditLogQueueMessage } from "@/modules/audit-logs/types";
import { processAuditLogBatch } from "@/queues/audit-log-consumer";
import app from "./server";

// Re-export Durable Objects (required by Wrangler)
export { RateLimiter } from "./durable-objects/rate-limiter";
export { ApiEntrypoint } from "./entrypoint";
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
} satisfies ExportedHandler<CloudflareBindings, AuditLogQueueMessage>;
