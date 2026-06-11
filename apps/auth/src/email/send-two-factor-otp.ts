import { sendEmail, TwoFactorOtpEmail } from "@repo/email";
import { getClientIpFromHeaders } from "@repo/shared/client-ip";
import { logger } from "@repo/shared/logger";
import { TWO_FACTOR_CONFIG } from "../constants";
import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";

export function createSendTwoFactorOTP(
  env: AuthBindings,
  ctx: MinimalExecutionContext,
  brand: { appName: string }
) {
  return async (
    {
      user,
      otp,
    }: { user: { id: string; email: string; name: string }; otp: string },
    reqCtx?: { headers?: Headers }
  ) => {
    // Never log the OTP value; only record that one was generated.
    if (env.NODE_ENV === "development") {
      logger.info("2FA OTP generated", {
        userId: user.id,
        email: user.email,
      });
    }
    logger.info(`Sending 2FA OTP to ${user.email}`);

    const ipAddress = reqCtx?.headers
      ? getClientIpFromHeaders(reqCtx.headers)
      : undefined;
    const userAgent = reqCtx?.headers?.get("user-agent") ?? undefined;

    // Async send prevents timing attacks.
    ctx.waitUntil(
      sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: `${brand.appName} <${env.EMAIL_FROM}>`,
        to: user.email,
        subject: "Your Two-Factor Authentication Code",
        template: TwoFactorOtpEmail,
        props: {
          userName: user.name,
          otp,
          expiresIn: `${TWO_FACTOR_CONFIG.twoFactorOtpPeriodMinutes} minutes`,
          ipAddress,
          userAgent,
        },
      }).catch((error) => {
        logger.error("Failed to send 2FA OTP email", {
          userId: user.id,
          email: user.email,
          error,
        });
      })
    );
  };
}
