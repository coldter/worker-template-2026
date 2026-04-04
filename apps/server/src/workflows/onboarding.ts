import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

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
