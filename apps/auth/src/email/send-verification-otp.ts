import type { DrizzleClient } from "@repo/db";
import { sendEmail, VerificationOtpEmail } from "@repo/email";
import { logger } from "@repo/shared/logger";
import { TWO_FACTOR_CONFIG } from "../constants";
import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";

type EmailOTPType =
  | "sign-in"
  | "email-verification"
  | "forget-password"
  | "change-email";

export function createSendVerificationOTP(
  db: DrizzleClient,
  env: AuthBindings,
  ctx: MinimalExecutionContext,
  brand: { appName: string }
) {
  return async ({
    email,
    otp,
    type,
  }: {
    email: string;
    otp: string;
    type: EmailOTPType;
  }) => {
    const user = await db.query.users.findFirst({
      where: { email: { eq: email } },
      columns: { name: true },
    });

    const typeLabels: Record<EmailOTPType, string> = {
      "sign-in": "sign-in",
      "email-verification": "email verification",
      "forget-password": "password reset",
      "change-email": "email change",
    };

    const subjectByType: Record<EmailOTPType, string> = {
      "forget-password": "Reset Your Password",
      "email-verification": "Verify Your Email",
      "sign-in": "Sign In Verification",
      "change-email": "Confirm Email Change",
    };

    logger.info(`Sending ${typeLabels[type]} OTP to ${email}`);

    const templateType = type === "change-email" ? "email-verification" : type;

    // Async send prevents timing attacks.
    ctx.waitUntil(
      sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: `${brand.appName} <${env.EMAIL_FROM}>`,
        to: email,
        subject: subjectByType[type],
        template: VerificationOtpEmail,
        props: {
          userName: user?.name ?? "User",
          otp,
          type: templateType,
          expiresIn: `${Math.floor(TWO_FACTOR_CONFIG.emailOtpExpiresIn / 60)} minutes`,
        },
      }).catch((error) => {
        logger.error("Failed to send verification OTP email", {
          email,
          type,
          error,
        });
      })
    );
  };
}
