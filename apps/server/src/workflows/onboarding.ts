import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { createDrizzleClient } from "@repo/db/client";
import * as schema from "@repo/db/schema";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { Client } from "pg";

interface OnboardingParams {
  email: string;
  name: string | null;
  userId: string;
}

export class OnboardingWorkflow extends WorkflowEntrypoint<
  CloudflareBindings,
  OnboardingParams
> {
  async run(
    event: WorkflowEvent<OnboardingParams>,
    step: WorkflowStep
  ): Promise<void> {
    await step.do(
      "write-audit-log",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        const client = new Client({
          connectionString: this.env.HYPERDRIVE.connectionString,
        });
        await client.connect();
        try {
          const db = createDrizzleClient(
            client,
            process.env.NODE_ENV === "development"
              ? new DrizzleLogger()
              : undefined
          );
          await db.insert(schema.auditLogs).values({
            event: "user.created",
            actorId: event.payload.userId,
            actorType: "system",
            targetId: event.payload.userId,
            targetType: "user",
          });
        } finally {
          await client.end();
        }
      }
    );

    await step.do(
      "send-welcome-email",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const { sendEmail, WelcomeEmail } = await import("@repo/email");
        await sendEmail({
          apiKey: this.env.RESEND_API_KEY,
          from: `${this.env.EMAIL_FROM_NAME} <${this.env.EMAIL_FROM}>`,
          to: event.payload.email,
          subject: "Welcome!",
          template: WelcomeEmail,
          props: {
            userName: event.payload.name ?? "there",
            loginUrl: this.env.APP_URL,
          },
        });
      }
    );
  }
}
