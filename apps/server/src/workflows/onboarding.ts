import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { getBrandConfig } from "@repo/shared/brand";
import { runWithWorkflowMetrics } from "@/lib/workflow-metrics";

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
    await runWithWorkflowMetrics(this.env, "onboarding", () =>
      this.execute(event, step)
    );
  }

  private async execute(
    event: WorkflowEvent<OnboardingParams>,
    step: WorkflowStep
  ): Promise<void> {
    await step.do(
      "send-welcome-email",
      { retries: { backoff: "exponential", delay: "5 seconds", limit: 3 } },
      async () => {
        const { sendEmail, WelcomeEmail } = await import("@repo/email");

        const brand = getBrandConfig(
          this.env as unknown as Record<string, string | undefined>
        );
        await sendEmail({
          apiKey: this.env.RESEND_API_KEY,
          from: `${brand.appName} <${this.env.EMAIL_FROM}>`,
          props: {
            loginUrl: this.env.APP_URL,
            userName: event.payload.name ?? "there",
          },
          subject: "Welcome!",
          template: WelcomeEmail,
          to: event.payload.email,
        });
      }
    );
  }
}
