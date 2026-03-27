import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { relations, schema } from "@/db";
import { logger } from "@/lib/logger";

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
    // Step 1: Load notification and resolve email
    const notificationData = await step.do(
      "load-notification",
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

          const user = await db.query.users.findFirst({
            where: { id: { eq: notification.userId } },
            columns: { email: true, name: true },
          });

          return {
            subject: notification.subject,
            body: notification.body,
            email: user?.email,
            userName: user?.name,
          };
        } finally {
          await client.end();
        }
      }
    );

    if (!notificationData.email) {
      logger.warn("No email found for notification", {
        notificationId: event.payload.notificationId,
      });
      return;
    }

    // Step 2: Send email via Resend
    await step.do(
      "send-email",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const { sendEmail, NotificationEmail } = await import("@repo/email");
        await sendEmail({
          apiKey: this.env.RESEND_API_KEY,
          from: `${this.env.EMAIL_FROM_NAME} <${this.env.EMAIL_FROM}>`,
          to: notificationData.email as string,
          subject: notificationData.subject ?? "",
          template: NotificationEmail,
          props: {
            subject: notificationData.subject ?? "",
            body: notificationData.body ?? "",
          },
        });
      }
    );

    // Step 3: Update notification status
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
          await db
            .update(schema.notifications)
            .set({ sentAt: new Date(), status: "sent" })
            .where(eq(schema.notifications.id, event.payload.notificationId));
        } finally {
          await client.end();
        }
      }
    );
  }
}
