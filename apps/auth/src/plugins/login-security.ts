import {
  clearUserLockout,
  type DrizzleClient,
  resetFailedLoginAttemptsByEmail,
  setUserFailedAttempts,
  setUserLocked,
} from "@repo/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import {
  calculateLockoutExpiry,
  isLockoutExpired,
  LOCKOUT_CONFIG,
} from "../constants";
import { userStatusSchema } from "./user-status";

// createAuthMiddleware does not propagate endpoint body types; re-validate the field we need.
const emailBodySchema = z
  .object({
    email: z.string().email().optional(),
  })
  .passthrough();

function readEmailFromBody(body: unknown): string | undefined {
  const parsed = emailBodySchema.safeParse(body ?? {});
  return parsed.success ? parsed.data.email : undefined;
}

// 2FA users get `{ twoFactorRedirect: true }` -- not yet fully authenticated, so don't clear failed-attempt counters.
const twoFactorRedirectSchema = z
  .object({
    twoFactorRedirect: z.boolean().optional(),
  })
  .passthrough();

function isTwoFactorRedirect(returned: unknown): boolean {
  const parsed = twoFactorRedirectSchema.safeParse(returned);
  return parsed.success && parsed.data.twoFactorRedirect === true;
}

const twoFactorVerifySuccessSchema = z
  .object({
    user: z
      .object({
        email: z.string().email().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function readEmailFromTwoFactorVerifyResponse(
  returned: unknown
): string | undefined {
  const parsed = twoFactorVerifySuccessSchema.safeParse(returned);
  return parsed.success ? parsed.data.user?.email : undefined;
}

export const AUTH_ERROR_CODES = {
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
} as const;

export const loginSecurityPlugin = (db: DrizzleClient) => {
  return {
    hooks: {
      after: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const email = readEmailFromBody(ctx.body);
            if (!email) {
              return;
            }

            const { returned } = ctx.context;
            const isFailure = returned instanceof APIError;

            if (isFailure) {
              const user = await db.query.users.findFirst({
                where: { email: { eq: email } },
              });

              if (!user) {
                return;
              }

              const newFailedAttempts = (user.failedLoginAttempts ?? 0) + 1;
              const shouldLock =
                newFailedAttempts >= LOCKOUT_CONFIG.maxFailedAttempts;

              if (shouldLock) {
                await setUserLocked(
                  db,
                  user.id,
                  calculateLockoutExpiry(),
                  newFailedAttempts
                );
                throw new APIError("TOO_MANY_REQUESTS", {
                  code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
                  message: `Account locked after ${LOCKOUT_CONFIG.maxFailedAttempts} failed attempts. Try again in ${LOCKOUT_CONFIG.lockoutDurationMinutes} minutes.`,
                });
              }

              await setUserFailedAttempts(db, user.id, newFailedAttempts);

              throw new APIError("UNAUTHORIZED", {
                code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
                message: "Invalid credentials",
              });
            }

            // Hold counter open across 2FA redirect; reset happens in the /two-factor/verify-otp after-hook.
            if (isTwoFactorRedirect(ctx.context.returned)) {
              return;
            }

            await resetFailedLoginAttemptsByEmail(db, email);
          }),
          matcher: (context) => context.path === "/sign-in/email",
        },
        {
          handler: createAuthMiddleware(async (ctx) => {
            const { returned } = ctx.context;
            if (returned instanceof APIError) {
              return;
            }

            const email = readEmailFromTwoFactorVerifyResponse(returned);
            if (!email) {
              return;
            }

            await resetFailedLoginAttemptsByEmail(db, email);
          }),
          matcher: (context) => context.path === "/two-factor/verify-otp",
        },
      ],
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const email = readEmailFromBody(ctx.body);
            if (!email) {
              return;
            }

            const existingUser = await db.query.users.findFirst({
              columns: { id: true },
              where: { email: { eq: email } },
            });

            if (existingUser) {
              throw new APIError("BAD_REQUEST", {
                message: "Unable to create account with this email",
              });
            }
          }),
          matcher: (context) => context.path === "/sign-up/email",
        },
        {
          handler: createAuthMiddleware(async (ctx) => {
            const email = readEmailFromBody(ctx.body);
            if (!email) {
              return;
            }

            const user = await db.query.users.findFirst({
              where: { email: { eq: email } },
            });

            if (!user) {
              return;
            }

            const statusResult = userStatusSchema.safeParse(user.status);
            const status = statusResult.success ? statusResult.data : "active";

            if (status === "deleted") {
              throw new APIError("FORBIDDEN", {
                code: AUTH_ERROR_CODES.ACCOUNT_DELETED,
                message: "This account has been deleted",
              });
            }

            if (status === "inactive") {
              throw new APIError("FORBIDDEN", {
                code: AUTH_ERROR_CODES.ACCOUNT_INACTIVE,
                message:
                  "This account has been deactivated. Please contact support.",
              });
            }

            if (status === "locked") {
              if (!isLockoutExpired(user.lockedUntil)) {
                const remainingMinutes = user.lockedUntil
                  ? Math.ceil(
                      (user.lockedUntil.getTime() - Date.now()) / 60_000
                    )
                  : LOCKOUT_CONFIG.lockoutDurationMinutes;

                throw new APIError("TOO_MANY_REQUESTS", {
                  code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
                  message: `Account is locked. Please try again in ${remainingMinutes} minute(s) or reset your password.`,
                });
              }

              await clearUserLockout(db, user.id);
            }
          }),
          matcher: (context) => context.path === "/sign-in/email",
        },
      ],
    },
    id: "login-security",
  } satisfies BetterAuthPlugin;
};
