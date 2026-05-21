import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { eq } from "drizzle-orm";
import { getPushProvider } from "@/lib/firebase";

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
    const data = await step.do(
      "load-notification-and-tokens",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
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
              subject: notification.subject,
              body: notification.body,
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
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const provider = getPushProvider();
        const results: Array<{
          token: string;
          success: boolean;
          invalidToken?: boolean;
        }> = [];

        for (const token of data.tokens) {
          const result = await provider.send({
            token,
            data: {
              type: "notification",
              notificationId: event.payload.notificationId,
              title: data.subject ?? "",
              body: data.body ?? "",
            },
          });

          results.push({
            token,
            success: result.success,
            invalidToken: result.invalidToken,
          });

          if (!result.success) {
            logger.warn("Push send failed for token", {
              notificationId: event.payload.notificationId,
              error: result.error,
              invalidToken: result.invalidToken,
            });
          }
        }

        return results;
      }
    );

    await step.do(
      "update-status",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        await withDrizzleClient(
          this.env.HYPERDRIVE.connectionString,
          async (db) => {
            const anySuccess = sendResults.some((r) => r.success);
            const allFailed = sendResults.every((r) => !r.success);

            await db
              .update(schema.notifications)
              .set({
                status: allFailed ? "failed" : "sent",
                sentAt: anySuccess ? new Date() : undefined,
              })
              .where(eq(schema.notifications.id, event.payload.notificationId));

            const invalidTokens = sendResults
              .filter((r) => r.invalidToken)
              .map((r) => r.token);

            for (const token of invalidTokens) {
              await db
                .delete(schema.pushTokens)
                .where(eq(schema.pushTokens.token, token));
            }

            if (invalidTokens.length > 0) {
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
