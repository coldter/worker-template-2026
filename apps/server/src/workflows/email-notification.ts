import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { getBrandConfig } from "@repo/shared/brand";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { eq } from "drizzle-orm";
import { runWithWorkflowMetrics } from "@/lib/workflow-metrics";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

interface EmailNotificationParams {
  notificationId: string;
}

export class EmailNotificationWorkflow extends WorkflowEntrypoint<
  CloudflareBindings,
  EmailNotificationParams
> {
  async run(
    event: WorkflowEvent<EmailNotificationParams>,
    step: WorkflowStep
  ): Promise<void> {
    await runWithWorkflowMetrics(this.env, "email-notification", () =>
      this.execute(event, step)
    );
  }

  private async execute(
    event: WorkflowEvent<EmailNotificationParams>,
    step: WorkflowStep
  ): Promise<void> {
    // Step 1: Load notification and resolve email
    const notificationData = await step.do(
      "load-notification",
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

            const user = await db.query.users.findFirst({
              columns: { email: true, name: true },
              where: { id: { eq: notification.userId } },
            });

            return {
              body: notification.body,
              email: user?.email,
              subject: notification.subject,
              userName: user?.name,
            };
          },
          { logger: getDrizzleLogger() }
        )
    );

    if (!notificationData.email) {
      logger.warn("No email found for notification", {
        notificationId: event.payload.notificationId,
      });
      return;
    }

    const recipientEmail = notificationData.email;

    // Step 2: Send email via Resend
    await step.do(
      "send-email",
      { retries: { backoff: "exponential", delay: "5 seconds", limit: 3 } },
      async () => {
        const { sendEmail, NotificationEmail } = await import("@repo/email");
        // boundary: workerd env bindings are typed via wrangler codegen; cast
        // to a plain record for the brand helper.
        const brand = getBrandConfig(
          this.env as unknown as Record<string, string | undefined>
        );
        await sendEmail({
          apiKey: this.env.RESEND_API_KEY,
          from: `${brand.appName} <${this.env.EMAIL_FROM}>`,
          props: {
            body: notificationData.body ?? "",
            subject: notificationData.subject ?? "",
          },
          subject: notificationData.subject ?? "",
          template: NotificationEmail,
          to: recipientEmail,
        });
      }
    );

    // Step 3: Update notification status
    await step.do(
      "update-status",
      { retries: { backoff: "exponential", delay: "2 seconds", limit: 3 } },
      async () => {
        await withDrizzleClient(
          this.env.HYPERDRIVE.connectionString,
          async (db) => {
            await db
              .update(schema.notifications)
              .set({ sentAt: new Date(), status: "sent" })
              .where(eq(schema.notifications.id, event.payload.notificationId));
          },
          { logger: getDrizzleLogger() }
        );
      }
    );
  }
}
