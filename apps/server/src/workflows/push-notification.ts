import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { relations, schema } from "@/db";
import { getPushProvider } from "@/lib/firebase";
import { logger } from "@/lib/logger";

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
    // Step 1: Load notification and push tokens
    const data = await step.do(
      "load-notification-and-tokens",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        const client = new Client({
          connectionString: this.env.HYPERDRIVE.connectionString,
        });
        await client.connect();
        try {
          const db = drizzle({
            client,
            schema,
            relations,
            casing: "snake_case",
          });

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
        } finally {
          await client.end();
        }
      }
    );

    if (data.tokens.length === 0) {
      logger.info("No push tokens found for notification", {
        notificationId: event.payload.notificationId,
      });
      return;
    }

    // Step 2: Send push notifications via FCM
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

    // Step 3: Update notification status and clean up invalid tokens
    await step.do(
      "update-status",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        const client = new Client({
          connectionString: this.env.HYPERDRIVE.connectionString,
        });
        await client.connect();
        try {
          const db = drizzle({
            client,
            schema,
            relations,
            casing: "snake_case",
          });

          const anySuccess = sendResults.some((r) => r.success);
          const allFailed = sendResults.every((r) => !r.success);

          await db
            .update(schema.notifications)
            .set({
              status: allFailed ? "failed" : "sent",
              sentAt: anySuccess ? new Date() : undefined,
            })
            .where(eq(schema.notifications.id, event.payload.notificationId));

          // Remove invalid tokens so future sends skip them
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
        } finally {
          await client.end();
        }
      }
    );
  }
}
