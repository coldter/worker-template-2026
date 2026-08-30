import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { eq, inArray } from "drizzle-orm";
import { getPushProvider } from "@/lib/firebase";
import { runWithWorkflowMetrics } from "@/lib/workflow-metrics";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

interface PushNotificationParams {
  notificationId: string;
}

export class PushNotificationWorkflow extends WorkflowEntrypoint<
  CloudflareBindings,
  PushNotificationParams
> {
  async run(
    event: WorkflowEvent<PushNotificationParams>,
    step: WorkflowStep
  ): Promise<void> {
    await runWithWorkflowMetrics(this.env, "push-notification", () =>
      this.execute(event, step)
    );
  }

  private async execute(
    event: WorkflowEvent<PushNotificationParams>,
    step: WorkflowStep
  ): Promise<void> {
    const data = await step.do(
      "load-notification-and-tokens",
      { retries: { backoff: "exponential", delay: "2 seconds", limit: 3 } },
      async () =>
        withDrizzleClient(
          this.env.HYPERDRIVE.connectionString,
          async (db) => {
            const notification = await db.query.notifications.findFirst({
              where: { id: { eq: event.payload.notificationId } },
            });

            if (!notification) {
              throw new Error(
                `Notification ${event.payload.notificationId} not found`
              );
            }

            const tokens = await db.query.pushTokens.findMany({
              where: { userId: { eq: notification.userId } },
            });

            return {
              body: notification.body,
              subject: notification.subject,
              tokens: tokens.map((t) => t.token),
            };
          },
          { logger: getDrizzleLogger() }
        )
    );

    if (data.tokens.length === 0) {
      logger.info("No push tokens found for notification", {
        notificationId: event.payload.notificationId,
      });
      return;
    }

    const sendResults = await step.do(
      "send-push",
      { retries: { backoff: "exponential", delay: "5 seconds", limit: 3 } },
      async () => {
        const provider = getPushProvider();
        const results = await Promise.all(
          data.tokens.map(async (token) => {
            const result = await provider.send({
              data: {
                body: data.body ?? "",
                notificationId: event.payload.notificationId,
                title: data.subject ?? "",
                type: "notification",
              },
              token,
            });

            if (!result.success) {
              logger.warn("Push send failed for token", {
                error: result.error,
                invalidToken: result.invalidToken,
                notificationId: event.payload.notificationId,
              });
            }

            return {
              invalidToken: result.invalidToken,
              success: result.success,
              token,
            };
          })
        );

        return results;
      }
    );

    await step.do(
      "update-status",
      { retries: { backoff: "exponential", delay: "2 seconds", limit: 3 } },
      async () => {
        await withDrizzleClient(
          this.env.HYPERDRIVE.connectionString,
          async (db) => {
            const anySuccess = sendResults.some((r) => r.success);
            const allFailed = sendResults.every((r) => !r.success);

            await db
              .update(schema.notifications)
              .set({
                sentAt: anySuccess ? new Date() : undefined,
                status: allFailed ? "failed" : "sent",
              })
              .where(eq(schema.notifications.id, event.payload.notificationId));

            const invalidTokens = sendResults
              .filter((r) => r.invalidToken)
              .map((r) => r.token);

            if (invalidTokens.length > 0) {
              await db
                .delete(schema.pushTokens)
                .where(inArray(schema.pushTokens.token, invalidTokens));

              logger.info("Cleaned up invalid push tokens", {
                count: invalidTokens.length,
                notificationId: event.payload.notificationId,
              });
            }
          },
          { logger: getDrizzleLogger() }
        );
      }
    );
  }
}
