import { sendEmail, TwoFactorOtpEmail } from "@repo/email";
import { getClientIpFromHeaders } from "@repo/shared/client-ip";
import { logger } from "@repo/shared/logger";
import { TWO_FACTOR_CONFIG } from "../constants";
import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "***";
  }
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const visible = localPart.slice(0, 2);
  return `${visible}***${domain}`;
}

function sanitizeHeaderText(
  value: string | undefined,
  maxLength: number
): string | undefined {
  if (value === undefined) {
    return;
  }
  const stripped = value.replace(/[\r\n<>]/g, "");
  return stripped.slice(0, maxLength);
}

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
    if (env.NODE_ENV === "development") {
      logger.info("2FA OTP generated", {
        email: maskEmail(user.email),
        userId: user.id,
      });
    }
    logger.info(`Sending 2FA OTP to ${maskEmail(user.email)}`);

    const ipAddress = sanitizeHeaderText(
      reqCtx?.headers ? getClientIpFromHeaders(reqCtx.headers) : undefined,
      64
    );
    const userAgent = sanitizeHeaderText(
      reqCtx?.headers?.get("user-agent") ?? undefined,
      200
    );

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
          email: maskEmail(user.email),
          error,
          userId: user.id,
        });
      })
    );
  };
}
