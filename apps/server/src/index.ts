import { routeQueueBatch } from "./queues/router";
import app from "./server";

export { RateLimiter } from "./durable-objects/rate-limiter";
export { ApiEntrypoint } from "./entrypoint";
export { EmailNotificationWorkflow } from "./workflows/email-notification";
export { OnboardingWorkflow } from "./workflows/onboarding";
export { PushNotificationWorkflow } from "./workflows/push-notification";

export default {
  fetch: app.fetch,
  async queue(batch, env, ctx) {
    await routeQueueBatch(batch, env, ctx);
  },
} satisfies ExportedHandler<CloudflareBindings>;
