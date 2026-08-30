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
      columns: { name: true },
      where: { email: { eq: email } },
    });

    const typeLabels: Record<EmailOTPType, string> = {
      "change-email": "email change",
      "email-verification": "email verification",
      "forget-password": "password reset",
      "sign-in": "sign-in",
    };

    const subjectByType: Record<EmailOTPType, string> = {
      "change-email": "Confirm Email Change",
      "email-verification": "Verify Your Email",
      "forget-password": "Reset Your Password",
      "sign-in": "Sign In Verification",
    };

    logger.info(`Sending ${typeLabels[type]} OTP to ${email}`);

    const templateType = type === "change-email" ? "email-verification" : type;

    // Async send prevents timing attacks.
    ctx.waitUntil(
      sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: `${brand.appName} <${env.EMAIL_FROM}>`,
        props: {
          expiresIn: `${Math.floor(TWO_FACTOR_CONFIG.emailOtpExpiresIn / 60)} minutes`,
          otp,
          type: templateType,
          userName: user?.name ?? "User",
        },
        subject: subjectByType[type],
        template: VerificationOtpEmail,
        to: email,
      }).catch((error) => {
        logger.error("Failed to send verification OTP email", {
          email,
          error,
          type,
        });
      })
    );
  };
}
