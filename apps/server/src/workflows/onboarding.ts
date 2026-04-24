import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { getBrandConfig } from "@repo/shared/brand";

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
      "send-welcome-email",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const { sendEmail, WelcomeEmail } = await import("@repo/email");
        // boundary: workerd env bindings are typed via wrangler codegen; cast
        // to a plain record for the brand helper.
        const brand = getBrandConfig(
          this.env as unknown as Record<string, string | undefined>
        );
        await sendEmail({
          apiKey: this.env.RESEND_API_KEY,
          from: `${brand.appName} <${this.env.EMAIL_FROM}>`,
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
