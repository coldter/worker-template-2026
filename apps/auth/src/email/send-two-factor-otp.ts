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
        email: user.email,
        userId: user.id,
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
        props: {
          expiresIn: `${TWO_FACTOR_CONFIG.twoFactorOtpPeriodMinutes} minutes`,
          ipAddress,
          otp,
          userAgent,
          userName: user.name,
        },
        subject: "Your Two-Factor Authentication Code",
        template: TwoFactorOtpEmail,
        to: user.email,
      }).catch((error) => {
        logger.error("Failed to send 2FA OTP email", {
          email: user.email,
          error,
          userId: user.id,
        });
      })
    );
  };
}
